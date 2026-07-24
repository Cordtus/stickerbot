package cachecleaner

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testToken = "123456:secret_token"

func TestCleanerRemovesExpiredTemporaryFiles(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	expired := writeFile(t, tempRoot, "downloads/expired.part", 3, now.Add(-6*time.Hour-time.Nanosecond))
	fresh := writeFile(t, tempRoot, "downloads/fresh.part", 2, now.Add(-6*time.Hour))

	report, err := Clean(context.Background(), testPolicy(stateRoot, tempRoot), now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	assertMissing(t, expired)
	assertExists(t, fresh)
	if got, want := report.Removed, 1; got != want {
		t.Fatalf("Removed = %d, want %d", got, want)
	}
	if got, want := report.Reclaimed, int64(3); got != want {
		t.Fatalf("Reclaimed = %d, want %d", got, want)
	}
}

func TestCleanerRemovesOnlyAllowlistedExpiredMedia(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	expiredMedia := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "old.mp4"), 4, now.Add(-24*time.Hour-time.Nanosecond))
	unknown := writeFile(t, stateRoot, filepath.Join(testToken, "private-cache", "old.bin"), 5, now.Add(-48*time.Hour))

	_, err := Clean(context.Background(), testPolicy(stateRoot, tempRoot), now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	assertMissing(t, expiredMedia)
	assertExists(t, unknown)
}

func TestCleanerRecognizesTelegramMediaDirectories(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	telegramMediaDirectories := []string{
		"animations",
		"documents",
		"music",
		"notification_sounds",
		"photos",
		"profile_photos",
		"stickers",
		"stories",
		"thumbnails",
		"video_notes",
		"videos",
		"voice",
		"wallpapers",
	}
	var expired []string
	for _, directory := range telegramMediaDirectories {
		expired = append(expired, writeFile(
			t,
			stateRoot,
			filepath.Join(testToken, directory, "old-media"),
			1,
			now.Add(-25*time.Hour),
		))
	}

	_, err := Clean(context.Background(), testPolicy(stateRoot, tempRoot), now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	for _, path := range expired {
		assertMissing(t, path)
	}
}

func TestCleanerPreservesTDLibStateAndUnknownFiles(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	old := now.Add(-48 * time.Hour)
	preserved := []string{
		writeFile(t, stateRoot, filepath.Join(testToken, "td.binlog"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "td.db"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "config.json"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "log.txt"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "unknown.bin"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "videos", "td.binlog"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "videos", "config"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "videos", "database"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "videos", "log"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "videos", "download.part"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "secret", "old.bin"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "secret_thumbnails", "old.bin"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "passport", "old.bin"), 2, old),
		writeFile(t, stateRoot, filepath.Join(testToken, "temp", "old.bin"), 2, old),
	}
	symlinkTarget := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "target.mp4"), 2, now.Add(-time.Hour))
	symlink := filepath.Join(stateRoot, testToken, "videos", "old-link.mp4")
	if err := os.Symlink(symlinkTarget, symlink); err != nil {
		t.Fatalf("create symlink: %v", err)
	}
	nonRegular := filepath.Join(stateRoot, testToken, "videos", "old-directory")
	if err := os.Mkdir(nonRegular, 0o700); err != nil {
		t.Fatalf("create directory: %v", err)
	}

	_, err := Clean(context.Background(), testPolicy(stateRoot, tempRoot), now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	for _, path := range preserved {
		assertExists(t, path)
	}
	assertExists(t, symlink)
	assertExists(t, nonRegular)
}

func TestCleanerPrunesOldestEligibleMediaToLowWatermark(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	oldest := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "oldest.mp4"), 4, now.Add(-5*time.Hour))
	newer := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "newer.mp4"), 3, now.Add(-4*time.Hour))
	newest := writeFile(t, stateRoot, filepath.Join(testToken, "documents", "newest.bin"), 3, now.Add(-3*time.Hour))
	policy := testPolicy(stateRoot, tempRoot)
	policy.HighWaterBytes = 10
	policy.LowWaterBytes = 6

	report, err := Clean(context.Background(), policy, now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	assertMissing(t, oldest)
	assertExists(t, newer)
	assertExists(t, newest)
	if got, want := report.BeforeBytes, int64(10); got != want {
		t.Fatalf("BeforeBytes = %d, want %d", got, want)
	}
	if got, want := report.AfterBytes, int64(6); got != want {
		t.Fatalf("AfterBytes = %d, want %d", got, want)
	}
}

func TestCleanerReachesLowWatermarkWhenExpiryDropsUsageBelowHighWatermark(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	expired := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "expired.mp4"), 3, now.Add(-25*time.Hour))
	oldestEligible := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "eligible.mp4"), 2, now.Add(-3*time.Hour))
	protected := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "protected.mp4"), 7, now.Add(-time.Hour))
	policy := testPolicy(stateRoot, tempRoot)
	policy.HighWaterBytes = 12
	policy.LowWaterBytes = 8

	report, err := Clean(context.Background(), policy, now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	assertMissing(t, expired)
	assertMissing(t, oldestEligible)
	assertExists(t, protected)
	if got, want := report.AfterBytes, int64(7); got != want {
		t.Fatalf("AfterBytes = %d, want <= low-water result %d", got, want)
	}
}

func TestCleanerProtectsFilesYoungerThanMinimumAge(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	protected := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "recent.mp4"), 12, now.Add(-time.Hour))
	policy := testPolicy(stateRoot, tempRoot)
	policy.HighWaterBytes = 10
	policy.LowWaterBytes = 6

	report, err := Clean(context.Background(), policy, now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	assertExists(t, protected)
	if got, want := report.Removed, 0; got != want {
		t.Fatalf("Removed = %d, want %d", got, want)
	}
	if got, want := report.AfterBytes, int64(12); got != want {
		t.Fatalf("AfterBytes = %d, want %d", got, want)
	}
}

func TestCleanerDryRunReportsWithoutDeleting(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	expired := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "old.mp4"), 7, now.Add(-48*time.Hour))
	policy := testPolicy(stateRoot, tempRoot)
	policy.DryRun = true

	report, err := Clean(context.Background(), policy, now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	assertExists(t, expired)
	if got, want := report.Removed, 1; got != want {
		t.Fatalf("Removed = %d, want %d", got, want)
	}
	if got, want := report.Reclaimed, int64(7); got != want {
		t.Fatalf("Reclaimed = %d, want %d", got, want)
	}
	if got, want := report.AfterBytes, int64(0); got != want {
		t.Fatalf("AfterBytes = %d, want projected %d", got, want)
	}
}

func TestCleanerReportsUsageBySanitizedBotID(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	writeFile(t, stateRoot, filepath.Join(testToken, "videos", "recent.mp4"), 5, now.Add(-time.Hour))
	writeFile(t, stateRoot, filepath.Join(testToken, "documents", "recent.bin"), 3, now.Add(-time.Hour))

	report, err := Clean(context.Background(), testPolicy(stateRoot, tempRoot), now)
	if err != nil {
		t.Fatalf("Clean() error = %v", err)
	}
	if got, want := report.ByBotID["123456"], int64(8); got != want {
		t.Fatalf("ByBotID[123456] = %d, want %d", got, want)
	}
	if _, found := report.ByBotID[testToken]; found {
		t.Fatalf("ByBotID leaked token key %q", testToken)
	}
}

func TestCleanerStopsBeforeDeletionWhenContextIsCancelled(t *testing.T) {
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	stateRoot, tempRoot := newRoots(t)
	expired := writeFile(t, stateRoot, filepath.Join(testToken, "videos", "old.mp4"), 1, now.Add(-48*time.Hour))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := Clean(ctx, testPolicy(stateRoot, tempRoot), now)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Clean() error = %v, want context.Canceled", err)
	}
	assertExists(t, expired)
}

func TestCleanerErrorsDoNotLeakBotTokensOrPaths(t *testing.T) {
	stateRoot := t.TempDir()
	sensitiveRoot := filepath.Join(stateRoot, testToken)

	_, err := scanTokenMedia(context.Background(), sensitiveRoot, "123456")
	if err == nil {
		t.Fatal("scanTokenMedia() error = nil, want missing-directory error")
	}
	message := err.Error()
	if strings.Contains(message, testToken) || strings.Contains(message, stateRoot) {
		t.Fatalf("error leaked token or absolute path: %q", message)
	}
	if !strings.Contains(message, "bot 123456") {
		t.Fatalf("error = %q, want sanitized bot ID", message)
	}
}

func newRoots(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	stateRoot := filepath.Join(root, "state")
	tempRoot := filepath.Join(root, "tmp")
	if err := os.MkdirAll(stateRoot, 0o700); err != nil {
		t.Fatalf("create state root: %v", err)
	}
	if err := os.MkdirAll(tempRoot, 0o700); err != nil {
		t.Fatalf("create temp root: %v", err)
	}
	return stateRoot, tempRoot
}

func testPolicy(stateRoot, tempRoot string) Policy {
	return Policy{
		StateRoot:       stateRoot,
		TempRoot:        tempRoot,
		MediaMaxAge:     24 * time.Hour,
		TempMaxAge:      6 * time.Hour,
		MinimumMediaAge: 2 * time.Hour,
		HighWaterBytes:  1 << 30,
		LowWaterBytes:   1 << 29,
	}
}

func writeFile(t *testing.T, root, relativePath string, size int, modifiedAt time.Time) string {
	t.Helper()
	path := filepath.Join(root, relativePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if err := os.Chtimes(path, modifiedAt, modifiedAt); err != nil {
		t.Fatalf("set mtime for %s: %v", path, err)
	}
	return path
}

func assertExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); err != nil {
		t.Fatalf("expected %s to exist: %v", path, err)
	}
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected %s to be removed, stat error = %v", path, err)
	}
}
