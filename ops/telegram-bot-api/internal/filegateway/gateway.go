package filegateway

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	tokenPattern = regexp.MustCompile(`^[0-9]{5,}:[A-Za-z0-9_-]+$`)
	botIDPattern = regexp.MustCompile(`^[0-9]{5,}$`)
)

type Config struct {
	StateRoot string
	Logger    *slog.Logger
}

type handler struct {
	stateRoot string
	logger    *slog.Logger
}

func NewHandler(config Config) (http.Handler, error) {
	stateRoot, err := filepath.EvalSymlinks(config.StateRoot)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(stateRoot)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrNotExist
	}

	logger := config.Logger
	if logger == nil {
		logger = slog.Default()
	}

	return &handler{stateRoot: stateRoot, logger: logger}, nil
}

func (h *handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	response := &responseRecorder{ResponseWriter: writer}
	botID := ""
	defer func() {
		h.logger.Info("file gateway request", "bot_id", botID, "status", response.statusCode(), "bytes", response.bytes)
	}()

	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", http.MethodGet+", "+http.MethodHead)
		response.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	const routePrefix = "/file/bot"
	if !strings.HasPrefix(request.URL.Path, routePrefix) {
		response.WriteHeader(http.StatusNotFound)
		return
	}

	token := strings.TrimPrefix(request.URL.Path, routePrefix)
	botID = safeBotID(token)
	if !tokenPattern.MatchString(token) {
		response.WriteHeader(http.StatusBadRequest)
		return
	}

	requestedPath := request.URL.Query().Get("path")
	if requestedPath == "" || !filepath.IsAbs(requestedPath) {
		response.WriteHeader(http.StatusBadRequest)
		return
	}

	tokenRoot, err := filepath.EvalSymlinks(filepath.Join(h.stateRoot, token))
	if err != nil || !isWithin(h.stateRoot, tokenRoot) {
		response.WriteHeader(http.StatusNotFound)
		return
	}

	tokenInfo, err := os.Stat(tokenRoot)
	if err != nil || !tokenInfo.IsDir() {
		response.WriteHeader(http.StatusNotFound)
		return
	}

	if strings.HasSuffix(filepath.Base(requestedPath), ".part") {
		response.WriteHeader(http.StatusNotFound)
		return
	}

	filePath, err := filepath.EvalSymlinks(requestedPath)
	if err != nil {
		response.WriteHeader(http.StatusNotFound)
		return
	}
	if !isWithin(tokenRoot, filePath) {
		response.WriteHeader(http.StatusForbidden)
		return
	}
	fileName, err := filepath.Rel(tokenRoot, filePath)
	if err != nil {
		response.WriteHeader(http.StatusNotFound)
		return
	}
	if strings.HasSuffix(filepath.Base(filePath), ".part") {
		response.WriteHeader(http.StatusNotFound)
		return
	}

	file, err := openValidatedTokenFile(tokenRoot, tokenInfo, fileName)
	if err != nil {
		response.WriteHeader(http.StatusNotFound)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		response.WriteHeader(http.StatusNotFound)
		return
	}

	http.ServeContent(response, request, filepath.Base(filePath), info.ModTime(), file)
}

func openValidatedTokenFile(tokenRoot string, tokenInfo os.FileInfo, fileName string) (*os.File, error) {
	root, err := os.OpenRoot(tokenRoot)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	rootInfo, err := root.Stat(".")
	if err != nil {
		return nil, err
	}
	if !os.SameFile(tokenInfo, rootInfo) {
		return nil, os.ErrNotExist
	}

	return root.Open(fileName)
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *responseRecorder) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseRecorder) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(data)
	w.bytes += int64(n)
	return n, err
}

func (w *responseRecorder) statusCode() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}

func safeBotID(token string) string {
	botID, _, found := strings.Cut(token, ":")
	if !found || !botIDPattern.MatchString(botID) {
		return ""
	}
	return botID
}

func isWithin(root, path string) bool {
	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relativePath != "." && relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator))
}
