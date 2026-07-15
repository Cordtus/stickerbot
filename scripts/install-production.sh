#!/usr/bin/env bash
# Install StickerBot code and native dependencies without starting the poller.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="${SOURCE_DIR:-$PROJECT_DIR}"
INSTALL_DIR="${INSTALL_DIR:-/opt/stickerbot}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
ENV_DIR="${ENV_DIR:-/etc/stickerbot}"
SERVICE_USER="${SERVICE_USER:-stickerbot}"
SERVICE_GROUP="${SERVICE_GROUP:-stickerbot}"
NODE_BIN="${NODE_BIN:-/opt/node-v22/bin/node}"
NPM_BIN="${NPM_BIN:-/opt/node-v22/bin/npm}"
FFMPEG_BIN="${FFMPEG_BIN:-/usr/bin/ffmpeg}"
FFPROBE_BIN="${FFPROBE_BIN:-/usr/bin/ffprobe}"
TIMEOUT_BIN="${TIMEOUT_BIN:-/usr/bin/timeout}"
SKIP_SYSTEM_USER="${SKIP_SYSTEM_USER:-0}"
ALLOW_UNPRIVILEGED_TEST="${ALLOW_UNPRIVILEGED_TEST:-0}"

SUDO=()
if [[ "$EUID" -ne 0 ]]; then
	if [[ "$ALLOW_UNPRIVILEGED_TEST" != 1 ]]; then
		echo 'Run this installer as root' >&2
		exit 1
	fi
	SUDO=(sudo)
fi
root_run() {
	"${SUDO[@]}" "$@"
}

for required_file in package.json package-lock.json stickerbot.service scripts/smoke-production.sh; do
	if [[ ! -f "$SOURCE_DIR/$required_file" ]]; then
		echo "Missing release file: $SOURCE_DIR/$required_file" >&2
		exit 1
	fi
done
if [[ ! -d "$SOURCE_DIR/src" ]]; then
	echo "Missing release source directory: $SOURCE_DIR/src" >&2
	exit 1
fi
for binary in "$NODE_BIN" "$NPM_BIN" "$FFMPEG_BIN" "$FFPROBE_BIN" "$TIMEOUT_BIN"; do
	if [[ ! -x "$binary" ]]; then
		echo "Required executable is missing: $binary" >&2
		exit 1
	fi
done

"$FFMPEG_BIN" -version >/dev/null
"$FFPROBE_BIN" -version >/dev/null
FFMPEG_BIN="$FFMPEG_BIN" \
	FFPROBE_BIN="$FFPROBE_BIN" \
	TIMEOUT_BIN="$TIMEOUT_BIN" \
	"$SOURCE_DIR/scripts/smoke-production.sh"

if [[ "$SKIP_SYSTEM_USER" != 1 ]]; then
	if ! getent group "$SERVICE_GROUP" >/dev/null; then
		root_run groupadd --system "$SERVICE_GROUP"
	fi
	if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
		root_run useradd \
			--system \
			--gid "$SERVICE_GROUP" \
			--home-dir /nonexistent \
			--shell /usr/sbin/nologin \
			"$SERVICE_USER"
	fi
fi

# Immutable application and dependency paths are root-owned. The bot token is
# never copied from a checkout; systemd reads it only from ENV_DIR.
root_run mkdir -p "$INSTALL_DIR"
root_run chown "root:$SERVICE_GROUP" "$INSTALL_DIR"
root_run chmod 0755 "$INSTALL_DIR"
root_run rm -rf "$INSTALL_DIR/src" "$INSTALL_DIR/scripts" "$INSTALL_DIR/node_modules"
root_run cp -r "$SOURCE_DIR/src" "$INSTALL_DIR/src"
if [[ -d "$SOURCE_DIR/scripts" ]]; then
	root_run cp -r "$SOURCE_DIR/scripts" "$INSTALL_DIR/scripts"
fi
root_run cp "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$INSTALL_DIR/"
if [[ -f "$SOURCE_DIR/README.md" ]]; then
	root_run cp "$SOURCE_DIR/README.md" "$INSTALL_DIR/"
fi
immutable_paths=("$INSTALL_DIR/src" "$INSTALL_DIR/package.json" "$INSTALL_DIR/package-lock.json")
if [[ -d "$INSTALL_DIR/scripts" ]]; then
	immutable_paths+=("$INSTALL_DIR/scripts")
fi
if [[ -f "$INSTALL_DIR/README.md" ]]; then
	immutable_paths+=("$INSTALL_DIR/README.md")
fi
root_run chown -R root:root "${immutable_paths[@]}"
root_run chmod -R u=rwX,go=rX "${immutable_paths[@]}"
if [[ -d "$INSTALL_DIR/scripts" ]]; then
	root_run chmod +x "$INSTALL_DIR/scripts/"*.sh
fi

# Preserve the migrated SQLite DB and any in-flight temp files while fixing the
# private runtime ownership expected by UMask=0077.
root_run mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/temp"
root_run chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/data" "$INSTALL_DIR/temp"
root_run find "$INSTALL_DIR/data" "$INSTALL_DIR/temp" -type d -exec chmod 0700 {} +
root_run find "$INSTALL_DIR/data" "$INSTALL_DIR/temp" -type f -exec chmod 0600 {} +

root_run mkdir -p "$ENV_DIR"
root_run chown root:root "$ENV_DIR"
root_run chmod 0700 "$ENV_DIR"
ENV_FILE="$ENV_DIR/stickerbot.env"
if [[ -L "$ENV_FILE" || ( -e "$ENV_FILE" && ! -f "$ENV_FILE" ) ]]; then
	echo "Refusing unsafe environment path: $ENV_FILE must be a regular file" >&2
	exit 1
fi
if [[ ! -e "$ENV_FILE" ]]; then
	placeholder_file="$(mktemp)"
	chmod 0600 "$placeholder_file"
	printf 'BOT_TOKEN=REPLACE_BEFORE_START\n' > "$placeholder_file"
	root_run install -m 0600 "$placeholder_file" "$ENV_FILE"
	rm -f "$placeholder_file"
fi
root_run chown root:root "$ENV_FILE"
root_run chmod 0600 "$ENV_FILE"

if [[ "$EUID" -eq 0 && "$(stat -c '%U:%G' "$ENV_FILE")" != 'root:root' ]]; then
	echo "Failed to enforce root ownership on $ENV_FILE" >&2
	exit 1
fi
if [[ "$(stat -c '%a' "$ENV_FILE")" != '600' ]]; then
	echo "Failed to enforce mode 0600 on $ENV_FILE" >&2
	exit 1
fi
if ! root_run grep -Eq '^BOT_TOKEN=.+$' "$ENV_FILE" \
	|| root_run grep -qx 'BOT_TOKEN=REPLACE_BEFORE_START' "$ENV_FILE"; then
	environment_action_required=1
else
	environment_action_required=0
fi

# Rebuild sharp/sqlite3 for the target architecture. Never copy node_modules or
# package-manager caches from the source machine.
cd "$INSTALL_DIR"
root_run "$NPM_BIN" ci --omit=dev
root_run chown -R root:root "$INSTALL_DIR/node_modules"
root_run chmod -R u=rwX,go=rX "$INSTALL_DIR/node_modules"
root_run "$NODE_BIN" --input-type=module -e "await import('sharp'); await import('sqlite3');"

root_run mkdir -p "$UNIT_DIR"
root_run install -m 0644 "$SOURCE_DIR/stickerbot.service" "$UNIT_DIR/stickerbot.service"
root_run chown root:root "$UNIT_DIR/stickerbot.service"

echo "StickerBot installed at $INSTALL_DIR"
if [[ "$environment_action_required" == 1 ]]; then
	echo "REQUIRED ACTION: set the production BOT_TOKEN in $ENV_FILE before cutover."
else
	echo "Preserved $ENV_FILE and enforced root:root ownership with mode 0600."
fi
echo 'The service was installed but not enabled or started.'
