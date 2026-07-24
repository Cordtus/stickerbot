# Telegram Sticker Bot

Bot to process images, videos, and GIFs into Telegram-compatible sticker formats or emotes, with persistent sticker pack management.

---

## Features

| Category | Details |
|----------|---------|
| Image conversion | *Emoticon* 100 × 100 px &nbsp;·&nbsp; *Sticker* ≤ 512 × 512 px with 50 px transparent padding |
| Video conversion | *Emoticon* 100 × 100 px &nbsp;·&nbsp; *Sticker* ≤ 512 × 512 px with transparent padding, max 6s input → 3s output |
| GPU acceleration | NVIDIA hardware encoding/decoding (h264_nvenc, h264_cuvid), CPU fallback |
| Processing controls | User blocking during conversion, 60s cooldown, timeout protection |
| File handling | Single or multiple files per message |
| Sticker processing | Fixes timestamp obscuring existing Telegram stickers by adding 50px transparent buffer |
| Output formats | Images: `.webp` &nbsp;·&nbsp; Videos: `.webm` (VP9) to avoid re‑compression |
| Metrics | Detailed before/after statistics: size, duration, FPS, resolution, processing time |
| Sticker‑pack ops | Create packs · add stickers · import external packs · mark favorites · manage collections |
| Video features | WebM conversion · duration limiting (3s max) · size optimization (256KB max) · frame rate standardization · transparent background preservation |
| Reliability | Automatic temp file cleanup; persistent SQLite DB for packs/users |

---

## Deploy your own instance

### Requirements

- **Node.js**
- Telegram Bot Token (obtainable via [BotFather](https://core.telegram.org/bots#botfather))
- SQLite3
- **FFmpeg** (for video/GIF processing)

---

## Installation

1. Clone the repository:

    ```bash
    git clone <repository-url>
    cd telegram-sticker-bot
    ```

2. Install dependencies:

    ```bash
    yarn install
    ```

3. **Install FFmpeg** (for video support):

    FFmpeg is a separate system binary required for video processing. The Node.js dependency `fluent-ffmpeg` is just a wrapper that requires the actual FFmpeg executable to be installed on your system.

    ```bash
    # macOS
    brew install ffmpeg

    # Ubuntu/Debian
    sudo apt update && sudo apt install ffmpeg
    ```

    > Without FFmpeg, the bot will work normally but only process images.

4. Create `.env` file:

    ```sh
    BOT_TOKEN=<your-telegram-bot-token>
    ```

    Keep the token in a mode `0600` environment file; never place it inline in a world-readable systemd unit.

5. Start:

    ```bash
    yarn start
    ```

   For development (auto-reload on code changes):

   ```bash
   yarn dev
   ```

---

## Production on `nodev2:tgbot`

Production runs as the dedicated `stickerbot` account from `/opt/stickerbot`. Code, scripts, `node_modules`, and the service unit are root-owned and immutable to the bot. Only `/opt/stickerbot/data` and `/opt/stickerbot/temp` are private writable directories for `stickerbot` (mode `0700`, with service-created files restricted further by `UMask=0077`).

Install the target-native runtime and media/native build dependencies first. `/opt/node-v22` must contain the x86-64 Node.js 22 distribution; do not copy the Raspberry Pi Node runtime, `node_modules`, npm cache, or Sharp/SQLite native binaries.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates ffmpeg build-essential python3 pkg-config sqlite3
sudo bash scripts/install-production.sh
```

The installer checks `ffmpeg` and `ffprobe`, runs a bounded local VP9 conversion/probe through `scripts/smoke-production.sh`, runs `/opt/node-v22/bin/npm ci --omit=dev`, and imports `sharp` and `sqlite3` with the target Node binary. It installs `/etc/systemd/system/stickerbot.service` but deliberately does not enable or start it. This keeps the target poller waiting inactive while the source poller remains live.

When the environment file is absent, the installer creates a root-owned mode `0600` sentinel containing `BOT_TOKEN=REPLACE_BEFORE_START` and prints a required-action message. It preserves an existing environment file, enforces its ownership and mode, and never prints its contents. Replace the sentinel without printing the token:

```bash
sudoedit /etc/stickerbot/stickerbot.env
sudo systemctl daemon-reload
sudo systemctl is-enabled stickerbot.service || true
sudo systemctl is-active stickerbot.service || true
```

`/etc/stickerbot/stickerbot.env` contains only:

```env
BOT_TOKEN=<production token>
```

FFmpeg capability detection probes NVIDIA NVENC, VA-API, and platform encoders when present. The Nodev2 LXC is allowed to run without GPU passthrough: unavailable hardware probes fall back to CPU processing. Re-run the same bounded CPU smoke inside `nodev2:tgbot` with `/opt/stickerbot/scripts/smoke-production.sh` before starting the bot.

### Persistent database and recovery

Production runs in `nodev2:tgbot`; `/opt/stickerbot/data/stickerpacks.db` is the canonical persistent database. Create WAL-consistent backups through SQLite rather than copying only the main file:

```bash
lxc exec nodev2:tgbot -- sh -lc '
  set -eu
  backup="/opt/stickerbot/data/stickerpacks.$(date -u +%Y%m%dT%H%M%SZ).db"
  sqlite3 /opt/stickerbot/data/stickerpacks.db ".backup \"$backup\""
  chown stickerbot:stickerbot "$backup"
  chmod 0600 "$backup"
  test "$(sqlite3 "$backup" "PRAGMA quick_check;")" = ok
  printf "%s\n" "$backup"
'
```

Restore only while `stickerbot.service` is stopped. Validate the incoming file, remove stale WAL/SHM sidecars, atomically rename it as `stickerbot:stickerbot` mode `0600`, validate it again, then start exactly one poller:

```bash
lxc exec nodev2:tgbot -- sh -lc '
  set -eu
  systemctl stop stickerbot.service
  cd /opt/stickerbot/data
  test "$(sqlite3 stickerpacks.db.incoming "PRAGMA quick_check;")" = ok
  rm -f stickerpacks.db-wal stickerpacks.db-shm
  chown stickerbot:stickerbot stickerpacks.db.incoming
  chmod 0600 stickerpacks.db.incoming
  mv -f stickerpacks.db.incoming stickerpacks.db
  test "$(sqlite3 stickerpacks.db "PRAGMA quick_check;")" = ok
  systemctl start stickerbot.service
  systemctl is-active --quiet stickerbot.service
'
```

---

## Shared local Telegram Bot API on `tgbotapi`

StickerBot can use the shared local Bot API only after its application
configuration supplies `TELEGRAM_API_ROOT=http://tgbotapi.lxd:8081` (and, for
local-mode media files, `TELEGRAM_FILE_ROOT=http://tgbotapi.lxd:8082`). Public
Telegram remains the development default. Do not mount the Bot API state tree
into bot containers: it contains token-scoped state for every bot.

The API server, token-scoped file gateway, and bounded cache cleaner are
packaged under `ops/telegram-bot-api`. On the `tgbotapi` container, build and
install the Go components and units with:

```bash
cd /path/to/stickerbot/ops/telegram-bot-api
sudo bash install.sh
```

The installer creates the `telegram-bot-api` service account and private state
directories, builds `file-gateway` and `cache-cleaner`, installs the four units,
and runs `systemctl daemon-reload`. It deliberately does **not** start or enable
any unit, and it never creates, reads, or overwrites
`/etc/telegram-bot-api/telegram-bot-api.env`. Install the audited native Bot API
binary separately at `/usr/local/libexec/telegram-bot-api/telegram-bot-api`.

Create the credential file manually, as root, before enabling the API. It is
root-only and contains the Telegram application credentials, never a bot token:

```bash
sudo install -d -m 0700 /etc/telegram-bot-api
sudoedit /etc/telegram-bot-api/telegram-bot-api.env
sudo chown root:root /etc/telegram-bot-api/telegram-bot-api.env
sudo chmod 0600 /etc/telegram-bot-api/telegram-bot-api.env
```

```env
TELEGRAM_API_ID=<api id>
TELEGRAM_API_HASH=<api hash>
```

State and temporary files live in mode-`0700`
`/var/lib/telegram-bot-api/{state,tmp}`; service logs are in mode-`0750`
`/var/log/telegram-bot-api`. The API and gateway intentionally listen on
`0.0.0.0:8081` and `0.0.0.0:8082` for the LXD network only. Keep those ports
off the public network. The gateway validates the calling token's native state
directory and does not log tokens or absolute file paths.

### Cache retention and activation

`telegram-bot-api-cache-cleaner.timer` runs hourly, serialized through
`/usr/bin/flock`. Initially its service runs only with `--dry-run`; review the
sanitized numeric bot-ID usage and planned reclaim figures before permitting
deletion:

```bash
sudo systemctl start telegram-bot-api-cache-cleaner.service
sudo journalctl -u telegram-bot-api-cache-cleaner.service --since '-10 min'
```

The cleaner removes only regular temporary files older than six hours and
regular downloaded media older than 24 hours in allowlisted Telegram media
directories. It never follows symlinks or removes TDLib databases, binlogs,
configuration, logs, or unknown state files. At 100 GiB of managed media it
prunes the oldest eligible media toward 80 GiB, while protecting media younger
than two hours.

After reviewing dry-run candidates against the live layout, remove `--dry-run`
from `/etc/systemd/system/telegram-bot-api-cache-cleaner.service`, then reload
and activate the timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-bot-api-cache-cleaner.timer
```

Do not enable destructive cleanup until a current state backup has passed its
SQLite/TDLib validation and dry-run output contains only expected media paths.

---

## Usage

1. Send an image or a static sticker directly to receive a sticker-formatted WebP document with a 50px transparent bottom buffer. No command is required; direct media uses Sticker Format.
2. Use `/start` only when you want to select a different mode:
    - **Emoticon Format**: Converts media to 100x100 for emotes.
    - **Sticker Format**: Converts media to 512x512 with a 50px transparent buffer.
    - **Manage Sticker Packs**: Create and manage your sticker collections.
3. For media conversion, send one or more images, videos, or GIFs to the bot.
4. For sticker pack management, you can:
    - Create a new pack and add stickers (images, videos, GIFs)
    - Add stickers to your existing packs
    - Add external packs to your collection
    - View and manage your collection

### Video Processing Notes

- **Duration Limit**: Videos and GIFs up to 6 seconds input, automatically processed to 3 seconds (Telegram requirement)
- **Size Optimization**: Output files compressed to meet Telegram's 256KB limit
- **GPU Acceleration**: NVIDIA hardware acceleration when available, CPU fallback
- **Format Conversion**: All videos/GIFs converted to WebM format for optimal compatibility
- **Quality Settings**: Automatic quality adjustment based on content complexity
- **Processing Controls**: User blocking during conversion with 60-second cooldown
- **Detailed Metrics**: Before/after statistics including processing time and hardware used

---

## Commands

- `/start` - Start the bot and select a mode
- `/help` - Show detailed help message
- `/cancel` - Cancel current operation
- `/status` - Show current bot and session status

---

## Database Schema

The bot uses SQLite to store persistent data about user sticker packs:

- **users**: Stores user information
- **sticker_packs**: Stores sticker pack details (including animated/video type flags)
- **stickers**: Stores information about individual stickers
- **user_packs**: Manages the relationship between users and packs

The database file is stored at `data/stickerpacks.db` (production: `/opt/stickerbot/data/stickerpacks.db`).

---

## Supported Inputs

### Images

- **Static Images**: JPEG, PNG, or WebP (up to 50MB)
- **Existing Telegram Stickers**: Adds a 50px transparent buffer

### Videos

- **Video Files**: MP4, MOV, AVI, WebM (up to 50MB, max 6 seconds input duration)
- **Animated GIFs**: GIF format (up to 50MB, max 6 seconds input duration)
- **Output**: WebM format optimized for Telegram stickers

### File Size Limits

- **Download**: 50MB (Telegram API limit)
- **Processing**: Up to 50MB input files
- **Output**: 256KB max for sticker compatibility
- **Duration**: 6 seconds max input, 3 seconds max output for video stickers

---

## Technical Details

### Video Processing Pipeline

1. **Download**: Secure download from Telegram servers
2. **Validation**: Check file size, duration, and format
3. **GPU Detection**: Automatic NVIDIA hardware acceleration detection
4. **Conversion**: FFmpeg processing with optimized settings (GPU or CPU)
5. **Smart Processing**: Speed adjustment for 3-6s videos, progressive compression
6. **Scaling**: Automatic resolution adjustment (512x512 max)
7. **Output**: WebM format with VP9 codec and alpha channel support

### Performance Optimization

- **GPU Acceleration**: 5-15x faster encoding with NVIDIA hardware
- **Processing Controls**: Per-user locks prevent resource conflicts
- **Memory Management**: Streaming processing for large files
- **Automatic Cleanup**: Temporary file cleanup and session management
- **Error Recovery**: Graceful handling of processing failures

---

## Development Notes

- Temporary files are stored in the `temp/` directory and automatically purged after 6 hours of inactivity.
- Sticker pack data is persisted in a SQLite database.
- Video processing is optional and gracefully disabled if FFmpeg is not available.
- GPU acceleration automatically detected and utilized when available.

### Modular Structure

- `bot.js`: Core bot functionality with FFmpeg detection
- `videoProcessor.js`: Handles video and GIF processing with GPU acceleration
- `imageProcessor.js`: Handles static image processing
- `stickerManager.js`: Manages sticker pack operations with video support
- `databaseManager.js`: Handles database operations
- `sessionManager.js`: Tracks user sessions, processing states, and cooldowns
- `messageHandlers.js`: Message type routing and processing control
- `callbackHandlers.js`: Inline keyboard callbacks
- `commandHandlers.js`: Bot commands
- `fileHandler.js`: Temporary file management
- `utils.js`: Utility functions

---

## Contributing

1. Fork the repository.
2. Create a feature branch:

    ```bash
    git checkout -b feature-name
    ```

3. Commit your changes:

    ```bash
    git commit -m "Add new feature"
    ```

4. Push to the branch:

    ```bash
    git push origin feature-name
    ```

5. Open a pull request.

---

**License**
This project is licensed under the MIT License.
