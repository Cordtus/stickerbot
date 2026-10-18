package packaging

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestInstallStagesBinariesUnitsAndPreservesCredentials(t *testing.T) {
	moduleRoot, err := filepath.Abs("../..")
	if err != nil {
		t.Fatalf("resolve module root: %v", err)
	}
	stagingRoot := t.TempDir()
	credentialsPath := filepath.Join(stagingRoot, "etc", "telegram-bot-api", "telegram-bot-api.env")
	if err := os.MkdirAll(filepath.Dir(credentialsPath), 0o700); err != nil {
		t.Fatalf("create credential directory: %v", err)
	}
	credentials := []byte("TELEGRAM_API_ID=unchanged\nTELEGRAM_API_HASH=unchanged\n")
	if err := os.WriteFile(credentialsPath, credentials, 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	command := exec.Command("bash", "install.sh")
	command.Dir = moduleRoot
	command.Env = append(os.Environ(), "INSTALL_ROOT="+stagingRoot)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("install.sh error = %v\n%s", err, output)
	}

	for path, wantMode := range map[string]os.FileMode{
		"usr/local/libexec/telegram-bot-api/file-gateway":           0o750,
		"usr/local/libexec/telegram-bot-api/cache-cleaner":          0o750,
		"etc/systemd/system/telegram-bot-api.service":               0,
		"etc/systemd/system/telegram-bot-api-file-gateway.service":  0,
		"etc/systemd/system/telegram-bot-api-cache-cleaner.service": 0,
		"etc/systemd/system/telegram-bot-api-cache-cleaner.timer":   0,
	} {
		info, err := os.Stat(filepath.Join(stagingRoot, path))
		if err != nil {
			t.Fatalf("staged %s: %v", path, err)
		}
		if wantMode != 0 && info.Mode().Perm() != wantMode {
			t.Fatalf("staged binary %s mode = %o, want %o", path, info.Mode().Perm(), wantMode)
		}
	}

	for path, wantMode := range map[string]os.FileMode{
		"var/lib/telegram-bot-api/state":     0o700,
		"var/lib/telegram-bot-api/tmp":       0o700,
		"var/log/telegram-bot-api":           0o750,
		"etc/telegram-bot-api":               0o700,
		"usr/local/libexec/telegram-bot-api": 0o750,
		"etc/systemd/system":                 0o755,
	} {
		info, err := os.Stat(filepath.Join(stagingRoot, path))
		if err != nil {
			t.Fatalf("staged directory %s: %v", path, err)
		}
		if got := info.Mode().Perm(); got != wantMode {
			t.Fatalf("directory %s mode = %o, want %o", path, got, wantMode)
		}
	}

	gotCredentials, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	if string(gotCredentials) != string(credentials) {
		t.Fatalf("credentials changed to %q, want %q", gotCredentials, credentials)
	}

	apiUnit, err := os.ReadFile(filepath.Join(stagingRoot, "etc/systemd/system/telegram-bot-api.service"))
	if err != nil {
		t.Fatalf("read staged API unit: %v", err)
	}
	if bytes.Contains(apiUnit, []byte("--api-id")) || bytes.Contains(apiUnit, []byte("--api-hash")) {
		t.Fatal("API credentials must remain environment-only, not expanded into ExecStart arguments")
	}
	if !bytes.Contains(apiUnit, []byte("EnvironmentFile=/etc/telegram-bot-api/telegram-bot-api.env")) {
		t.Fatal("API unit does not load the root-managed credential environment file")
	}
}
