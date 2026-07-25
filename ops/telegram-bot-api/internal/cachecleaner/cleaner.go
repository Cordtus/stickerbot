// Package cachecleaner applies conservative retention rules to Telegram Bot API
// temporary files and token-scoped downloaded media.
package cachecleaner

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	tokenDirectoryPattern = regexp.MustCompile(`^[0-9]{5,}:[A-Za-z0-9_-]+$`)
	mediaDirectories      = map[string]struct{}{
		"animations":          {},
		"documents":           {},
		"music":               {},
		"notification_sounds": {},
		"photos":              {},
		"profile_photos":      {},
		"stickers":            {},
		"stories":             {},
		"thumbnails":          {},
		"video_notes":         {},
		"videos":              {},
		"voice":               {},
		"wallpapers":          {},
	}
	protectedExtensions = map[string]struct{}{
		".binlog":  {},
		".conf":    {},
		".config":  {},
		".db":      {},
		".json":    {},
		".log":     {},
		".part":    {},
		".sqlite":  {},
		".sqlite3": {},
	}
	protectedBaseNames = map[string]struct{}{
		"config":        {},
		"configuration": {},
		"database":      {},
		"db":            {},
		"log":           {},
	}
)

// Policy configures the conservative cache-retention rules.
type Policy struct {
	StateRoot       string
	TempRoot        string
	MediaMaxAge     time.Duration
	TempMaxAge      time.Duration
	MinimumMediaAge time.Duration
	HighWaterBytes  int64
	LowWaterBytes   int64
	DryRun          bool
}

// Report describes current cache usage and the removals performed (or planned
// when DryRun is true). AfterBytes is the post-cleanup or projected post-cleanup
// managed cache size. ByBotID contains only numeric bot IDs and their remaining
// token-scoped media usage.
type Report struct {
	BeforeBytes int64
	AfterBytes  int64
	Removed     int
	Reclaimed   int64
	ByBotID     map[string]int64
}

type candidateKind uint8

const (
	temporaryFile candidateKind = iota
	mediaFile
)

type candidate struct {
	path         string
	rootPath     string
	relativePath string
	rootInfo     os.FileInfo
	botID        string
	size         int64
	modifiedAt   time.Time
	kind         candidateKind
}

// Clean removes only regular files from the configured temporary root and
// allowlisted token-scoped media directories. It never follows symlinks and
// treats unknown state-tree layout as out of scope.
func Clean(ctx context.Context, policy Policy, now time.Time) (Report, error) {
	report := Report{ByBotID: make(map[string]int64)}
	if err := validatePolicy(policy); err != nil {
		return report, err
	}
	if err := contextErr(ctx); err != nil {
		return report, err
	}

	temporary, err := scanTemporary(ctx, policy.TempRoot)
	if err != nil {
		return report, err
	}
	media, err := scanMedia(ctx, policy.StateRoot)
	if err != nil {
		return report, err
	}

	all := append(append([]candidate{}, temporary...), media...)
	for _, file := range all {
		report.BeforeBytes += file.size
	}
	for _, file := range media {
		report.ByBotID[file.botID] += file.size
	}

	selected := selectExpired(temporary, media, policy, now)
	selected = appendCapacityCandidates(selected, media, policy, now)
	selected = uniqueCandidates(selected)

	if err := preflightCandidates(ctx, selected); err != nil {
		return report, err
	}
	for _, file := range selected {
		if err := contextErr(ctx); err != nil {
			return report, err
		}
		if !policy.DryRun {
			if err := removeCandidate(file); err != nil {
				return report, err
			}
		}
		report.Removed++
		report.Reclaimed += file.size
		if file.kind == mediaFile {
			report.ByBotID[file.botID] -= file.size
		}
	}
	report.AfterBytes = report.BeforeBytes - report.Reclaimed
	return report, nil
}

func validatePolicy(policy Policy) error {
	if policy.StateRoot == "" || policy.TempRoot == "" {
		return fmt.Errorf("state and temporary roots are required")
	}
	if policy.MediaMaxAge < 0 || policy.TempMaxAge < 0 || policy.MinimumMediaAge < 0 {
		return fmt.Errorf("retention ages cannot be negative")
	}
	if policy.HighWaterBytes < 0 || policy.LowWaterBytes < 0 || policy.LowWaterBytes > policy.HighWaterBytes {
		return fmt.Errorf("watermarks must satisfy 0 <= low <= high")
	}
	if err := validateRoot(policy.StateRoot); err != nil {
		return fmt.Errorf("state root: %w", err)
	}
	if err := validateRoot(policy.TempRoot); err != nil {
		return fmt.Errorf("temporary root: %w", err)
	}
	return nil
}

func validateRoot(root string) error {
	info, err := os.Lstat(root)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("must be a non-symlink directory")
	}
	return nil
}

func scanTemporary(ctx context.Context, root string) ([]candidate, error) {
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("scan temporary root: %w", filesystemCause(err))
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, fmt.Errorf("temporary root changed during scan")
	}
	files := make([]candidate, 0)
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := contextErr(ctx); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		if path == root || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		relativePath, err := candidateRelativePath(root, path)
		if err != nil {
			return err
		}
		files = append(files, candidate{
			path:         path,
			rootPath:     root,
			relativePath: relativePath,
			rootInfo:     rootInfo,
			size:         info.Size(),
			modifiedAt:   info.ModTime(),
			kind:         temporaryFile,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("scan temporary root: %w", err)
	}
	return files, nil
}

func scanMedia(ctx context.Context, root string) ([]candidate, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read state root: %w", err)
	}
	files := make([]candidate, 0)
	for _, tokenEntry := range entries {
		if err := contextErr(ctx); err != nil {
			return nil, err
		}
		if tokenEntry.Type()&os.ModeSymlink != 0 || !tokenEntry.IsDir() || !tokenDirectoryPattern.MatchString(tokenEntry.Name()) {
			continue
		}
		botID, _, _ := strings.Cut(tokenEntry.Name(), ":")
		tokenRoot := filepath.Join(root, tokenEntry.Name())
		tokenFiles, err := scanTokenMedia(ctx, tokenRoot, botID)
		if err != nil {
			return nil, err
		}
		files = append(files, tokenFiles...)
	}
	return files, nil
}

func scanTokenMedia(ctx context.Context, tokenRoot, botID string) ([]candidate, error) {
	tokenInfo, err := os.Lstat(tokenRoot)
	if err != nil {
		return nil, fmt.Errorf("read state for bot %s: %w", botID, filesystemCause(err))
	}
	if tokenInfo.Mode()&os.ModeSymlink != 0 || !tokenInfo.IsDir() {
		return nil, fmt.Errorf("read state for bot %s: not a directory", botID)
	}
	entries, err := os.ReadDir(tokenRoot)
	if err != nil {
		return nil, fmt.Errorf("read state for bot %s: %w", botID, filesystemCause(err))
	}
	files := make([]candidate, 0)
	for _, entry := range entries {
		if err := contextErr(ctx); err != nil {
			return nil, err
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() {
			continue
		}
		if _, allowed := mediaDirectories[entry.Name()]; !allowed {
			continue
		}
		mediaRoot := filepath.Join(tokenRoot, entry.Name())
		mediaInfo, err := os.Lstat(mediaRoot)
		if err != nil {
			return nil, fmt.Errorf("inspect media for bot %s: %w", botID, filesystemCause(err))
		}
		if mediaInfo.Mode()&os.ModeSymlink != 0 || !mediaInfo.IsDir() {
			return nil, fmt.Errorf("media root changed for bot %s", botID)
		}
		err = filepath.WalkDir(mediaRoot, func(path string, child fs.DirEntry, walkErr error) error {
			if err := contextErr(ctx); err != nil {
				return err
			}
			if walkErr != nil {
				return walkErr
			}
			if path == mediaRoot || child.IsDir() || child.Type()&os.ModeSymlink != 0 || isProtectedName(child.Name()) {
				return nil
			}
			info, err := child.Info()
			if err != nil {
				return err
			}
			if !info.Mode().IsRegular() {
				return nil
			}
			relativePath, err := candidateRelativePath(mediaRoot, path)
			if err != nil {
				return err
			}
			files = append(files, candidate{
				path:         path,
				rootPath:     mediaRoot,
				relativePath: relativePath,
				rootInfo:     mediaInfo,
				botID:        botID,
				size:         info.Size(),
				modifiedAt:   info.ModTime(),
				kind:         mediaFile,
			})
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("scan media for bot %s: %w", botID, filesystemCause(err))
		}
	}
	return files, nil
}

func isProtectedName(name string) bool {
	if _, protected := protectedBaseNames[strings.ToLower(name)]; protected {
		return true
	}
	_, protected := protectedExtensions[strings.ToLower(filepath.Ext(name))]
	return protected
}

func selectExpired(temporary, media []candidate, policy Policy, now time.Time) []candidate {
	selected := make([]candidate, 0)
	for _, file := range temporary {
		if now.Sub(file.modifiedAt) > policy.TempMaxAge {
			selected = append(selected, file)
		}
	}
	for _, file := range media {
		if now.Sub(file.modifiedAt) > policy.MediaMaxAge {
			selected = append(selected, file)
		}
	}
	return selected
}

func appendCapacityCandidates(selected, media []candidate, policy Policy, now time.Time) []candidate {
	selectedPaths := make(map[string]struct{}, len(selected))
	total := int64(0)
	for _, file := range media {
		total += file.size
	}
	if total < policy.HighWaterBytes {
		return selected
	}

	remaining := total
	for _, file := range selected {
		if file.kind == mediaFile {
			selectedPaths[file.path] = struct{}{}
			remaining -= file.size
		}
	}

	eligible := make([]candidate, 0)
	for _, file := range media {
		if _, alreadySelected := selectedPaths[file.path]; alreadySelected {
			continue
		}
		if now.Sub(file.modifiedAt) >= policy.MinimumMediaAge {
			eligible = append(eligible, file)
		}
	}
	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].modifiedAt.Equal(eligible[j].modifiedAt) {
			return eligible[i].path < eligible[j].path
		}
		return eligible[i].modifiedAt.Before(eligible[j].modifiedAt)
	})
	for _, file := range eligible {
		if remaining <= policy.LowWaterBytes {
			break
		}
		selected = append(selected, file)
		remaining -= file.size
	}
	return selected
}

func uniqueCandidates(candidates []candidate) []candidate {
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].path < candidates[j].path })
	unique := candidates[:0]
	for _, file := range candidates {
		if len(unique) == 0 || unique[len(unique)-1].path != file.path {
			unique = append(unique, file)
		}
	}
	return unique
}

func preflightCandidates(ctx context.Context, candidates []candidate) error {
	for _, file := range candidates {
		if err := contextErr(ctx); err != nil {
			return err
		}
		root, err := openCandidateRoot(file)
		if err != nil {
			return fmt.Errorf("recheck %s cache candidate: %w", candidateScope(file), filesystemCause(err))
		}
		err = recheckCandidate(root, file)
		closeErr := root.Close()
		if err != nil {
			return fmt.Errorf("recheck %s cache candidate: %w", candidateScope(file), filesystemCause(err))
		}
		if closeErr != nil {
			return fmt.Errorf("recheck %s cache candidate: %w", candidateScope(file), filesystemCause(closeErr))
		}
	}
	return nil
}

func removeCandidate(file candidate) error {
	root, err := openCandidateRoot(file)
	if err != nil {
		return fmt.Errorf("remove %s cache candidate: %w", candidateScope(file), filesystemCause(err))
	}
	defer root.Close()

	if err := recheckCandidate(root, file); err != nil {
		return fmt.Errorf("remove %s cache candidate: %w", candidateScope(file), filesystemCause(err))
	}
	if err := root.Remove(file.relativePath); err != nil {
		return fmt.Errorf("remove %s cache candidate: %w", candidateScope(file), filesystemCause(err))
	}
	return nil
}

func openCandidateRoot(file candidate) (*os.Root, error) {
	if file.rootInfo == nil || !filepath.IsLocal(file.relativePath) || file.relativePath == "." {
		return nil, errors.New("invalid cache candidate root")
	}
	root, err := os.OpenRoot(file.rootPath)
	if err != nil {
		return nil, err
	}
	rootInfo, err := root.Stat(".")
	if err != nil {
		root.Close()
		return nil, err
	}
	if !os.SameFile(file.rootInfo, rootInfo) {
		root.Close()
		return nil, errors.New("cache candidate root changed during scan")
	}
	return root, nil
}

func recheckCandidate(root *os.Root, file candidate) error {
	info, err := root.Lstat(file.relativePath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != file.size || !info.ModTime().Equal(file.modifiedAt) {
		return errors.New("cache candidate changed during scan")
	}
	return nil
}

func candidateRelativePath(root, path string) (string, error) {
	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		return "", err
	}
	if relativePath == "." || !filepath.IsLocal(relativePath) {
		return "", fmt.Errorf("cache candidate is outside its root")
	}
	return relativePath, nil
}

func contextErr(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func candidateScope(file candidate) string {
	if file.botID != "" {
		return "bot " + file.botID
	}
	return "temporary"
}

func filesystemCause(err error) error {
	var pathError *fs.PathError
	if errors.As(err, &pathError) {
		return pathError.Err
	}
	return err
}
