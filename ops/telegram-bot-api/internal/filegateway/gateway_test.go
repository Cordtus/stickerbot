package filegateway

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	ownerToken = "123456:owner_secret"
	otherToken = "654321:other_secret"
)

func TestGatewayServesFileOwnedByToken(t *testing.T) {
	stateRoot := t.TempDir()
	ownedFile := writeStateFile(t, stateRoot, ownerToken, "videos/file_0.mp4", []byte("owned media"))
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(io.Discard, nil)))

	request := httptest.NewRequest(http.MethodGet, fileURL(ownerToken, ownedFile), nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d", response.Code, http.StatusOK)
	}
	if got, want := response.Body.String(), "owned media"; got != want {
		t.Fatalf("GET body = %q, want %q", got, want)
	}

	headRequest := httptest.NewRequest(http.MethodHead, fileURL(ownerToken, ownedFile), nil)
	headResponse := httptest.NewRecorder()
	handler.ServeHTTP(headResponse, headRequest)

	if headResponse.Code != http.StatusOK {
		t.Fatalf("HEAD status = %d, want %d", headResponse.Code, http.StatusOK)
	}
	if headResponse.Body.Len() != 0 {
		t.Fatalf("HEAD body = %q, want empty", headResponse.Body.String())
	}
}

func TestGatewaySupportsByteRanges(t *testing.T) {
	stateRoot := t.TempDir()
	ownedFile := writeStateFile(t, stateRoot, ownerToken, "documents/range.bin", []byte("0123456789"))
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(io.Discard, nil)))

	request := httptest.NewRequest(http.MethodGet, fileURL(ownerToken, ownedFile), nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want %d", response.Code, http.StatusPartialContent)
	}
	if got, want := response.Header().Get("Content-Range"), "bytes 2-5/10"; got != want {
		t.Fatalf("Content-Range = %q, want %q", got, want)
	}
	if got, want := response.Body.String(), "2345"; got != want {
		t.Fatalf("range body = %q, want %q", got, want)
	}
}

func TestGatewayRejectsAnotherBotsFile(t *testing.T) {
	stateRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(stateRoot, ownerToken), 0o700); err != nil {
		t.Fatalf("create owner root: %v", err)
	}
	otherFile := writeStateFile(t, stateRoot, otherToken, "videos/other.mp4", []byte("other media"))
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(io.Discard, nil)))

	response := requestGateway(handler, http.MethodGet, ownerToken, otherFile)

	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-bot status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestGatewayRejectsTraversalAndSymlinkEscape(t *testing.T) {
	stateRoot := t.TempDir()
	ownerRoot := filepath.Join(stateRoot, ownerToken)
	otherFile := writeStateFile(t, stateRoot, otherToken, "videos/other.mp4", []byte("other media"))
	writeStateFile(t, stateRoot, ownerToken, "videos/owned.mp4", []byte("owned media"))
	if err := os.Symlink(otherFile, filepath.Join(ownerRoot, "videos", "escaped.mp4")); err != nil {
		t.Fatalf("create escape symlink: %v", err)
	}
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(io.Discard, nil)))

	traversal := ownerRoot + string(filepath.Separator) + "videos" + string(filepath.Separator) + ".." + string(filepath.Separator) + ".." + string(filepath.Separator) + otherToken + string(filepath.Separator) + "videos" + string(filepath.Separator) + "other.mp4"
	for name, requestedPath := range map[string]string{
		"traversal":      traversal,
		"symlink escape": filepath.Join(ownerRoot, "videos", "escaped.mp4"),
	} {
		t.Run(name, func(t *testing.T) {
			response := requestGateway(handler, http.MethodGet, ownerToken, requestedPath)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
		})
	}
}

func TestOpenValidatedTokenFileRejectsEscapes(t *testing.T) {
	stateRoot := t.TempDir()
	ownerRoot := filepath.Join(stateRoot, ownerToken)
	otherFile := writeStateFile(t, stateRoot, otherToken, "videos/other.mp4", []byte("other media"))
	if err := os.MkdirAll(filepath.Join(ownerRoot, "videos"), 0o700); err != nil {
		t.Fatalf("create owner videos directory: %v", err)
	}
	if err := os.Symlink(otherFile, filepath.Join(ownerRoot, "videos", "escaped.mp4")); err != nil {
		t.Fatalf("create escaping symlink: %v", err)
	}

	tokenInfo, err := os.Stat(ownerRoot)
	if err != nil {
		t.Fatalf("stat owner root: %v", err)
	}

	file, err := openValidatedTokenFile(ownerRoot, tokenInfo, "videos/escaped.mp4")
	if file != nil {
		file.Close()
		t.Fatal("open escaping symlink succeeded")
	}
	if err == nil {
		t.Fatal("open escaping symlink error = nil, want error")
	}
}

func TestOpenValidatedTokenFileRejectsReplacedTokenRoot(t *testing.T) {
	stateRoot := t.TempDir()
	ownerRoot := filepath.Join(stateRoot, ownerToken)
	writeStateFile(t, stateRoot, ownerToken, "videos/owned.mp4", []byte("owned media"))
	writeStateFile(t, stateRoot, otherToken, "videos/other.mp4", []byte("other media"))

	tokenInfo, err := os.Stat(ownerRoot)
	if err != nil {
		t.Fatalf("stat owner root: %v", err)
	}
	if err := os.Rename(ownerRoot, ownerRoot+"-original"); err != nil {
		t.Fatalf("move owner root: %v", err)
	}
	if err := os.Symlink(filepath.Join(stateRoot, otherToken), ownerRoot); err != nil {
		t.Fatalf("replace owner root with symlink: %v", err)
	}

	file, err := openValidatedTokenFile(ownerRoot, tokenInfo, "videos/other.mp4")
	if file != nil {
		file.Close()
		t.Fatal("open through replaced token root succeeded")
	}
	if err == nil {
		t.Fatal("open through replaced token root error = nil, want error")
	}
}

func TestGatewayRejectsDirectoriesAndIncompleteFiles(t *testing.T) {
	stateRoot := t.TempDir()
	ownerRoot := filepath.Join(stateRoot, ownerToken)
	directory := filepath.Join(ownerRoot, "videos")
	incomplete := writeStateFile(t, stateRoot, ownerToken, "videos/upload.mp4.part", []byte("partial media"))
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(io.Discard, nil)))

	for name, requestedPath := range map[string]string{
		"directory": directory,
		"part file": incomplete,
	} {
		t.Run(name, func(t *testing.T) {
			response := requestGateway(handler, http.MethodGet, ownerToken, requestedPath)
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

func TestGatewayRejectsBadTokenMethodAndPath(t *testing.T) {
	stateRoot := t.TempDir()
	ownedFile := writeStateFile(t, stateRoot, ownerToken, "videos/owned.mp4", []byte("owned media"))
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(io.Discard, nil)))

	for name, testCase := range map[string]struct {
		request *http.Request
		status  int
	}{
		"bad token": {
			request: httptest.NewRequest(http.MethodGet, fileURL("not-a-token", ownedFile), nil),
			status:  http.StatusBadRequest,
		},
		"bad method": {
			request: httptest.NewRequest(http.MethodPost, fileURL(ownerToken, ownedFile), nil),
			status:  http.StatusMethodNotAllowed,
		},
		"missing path": {
			request: httptest.NewRequest(http.MethodGet, "/file/bot"+ownerToken, nil),
			status:  http.StatusBadRequest,
		},
		"relative path": {
			request: httptest.NewRequest(http.MethodGet, "/file/bot"+ownerToken+"?path=videos%2Fowned.mp4", nil),
			status:  http.StatusBadRequest,
		},
		"wrong route": {
			request: httptest.NewRequest(http.MethodGet, "/other", nil),
			status:  http.StatusNotFound,
		},
	} {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, testCase.request)
			if response.Code != testCase.status {
				t.Fatalf("status = %d, want %d", response.Code, testCase.status)
			}
		})
	}
}

func TestGatewayNeverLogsTokenOrAbsolutePath(t *testing.T) {
	stateRoot := t.TempDir()
	ownedFile := writeStateFile(t, stateRoot, ownerToken, "videos/private.mp4", []byte("private media"))
	var logs bytes.Buffer
	handler := newHandler(t, stateRoot, slog.New(slog.NewTextHandler(&logs, nil)))

	response := requestGateway(handler, http.MethodGet, ownerToken, ownedFile)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}

	output := logs.String()
	if strings.Contains(output, ownerToken) {
		t.Fatalf("logs contain token: %q", output)
	}
	if strings.Contains(output, ownedFile) || strings.Contains(output, stateRoot) {
		t.Fatalf("logs contain absolute path: %q", output)
	}
	if !strings.Contains(output, "bot_id=123456") || !strings.Contains(output, "status=200") || !strings.Contains(output, "bytes=13") {
		t.Fatalf("logs = %q, want sanitized bot ID, status, and byte count", output)
	}
}

func newHandler(t *testing.T, stateRoot string, logger *slog.Logger) http.Handler {
	t.Helper()
	handler, err := NewHandler(Config{StateRoot: stateRoot, Logger: logger})
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	return handler
}

func requestGateway(handler http.Handler, method, token, requestedPath string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, fileURL(token, requestedPath), nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func fileURL(token, requestedPath string) string {
	return "/file/bot" + token + "?" + url.Values{"path": {requestedPath}}.Encode()
}

func writeStateFile(t *testing.T, stateRoot, token, relativePath string, contents []byte) string {
	t.Helper()
	path := filepath.Join(stateRoot, token, relativePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("create parent directory: %v", err)
	}
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}
	return path
}
