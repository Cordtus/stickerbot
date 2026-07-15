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

### Persistent database and cutover

`/opt/stickerbot/data/stickerpacks.db` is canonical persistent state. Back it up with SQLite while the writer on `cordt@pi0.lan` is stopped; do not rely on copying only the main file while a WAL may be active. First prove the prepared unit in `nodev2:tgbot` is still waiting inactive:

```bash
ssh -F /dev/null -o BatchMode=yes bv@192.168.0.170 \
  "sudo /snap/bin/lxc exec tgbot -- sh -lc 'systemctl show -p ActiveState --value stickerbot.service | grep -qx inactive'"
ssh -F /dev/null -o BatchMode=yes bv@192.168.0.170 \
  'sudo /snap/bin/lxc exec tgbot -- /opt/stickerbot/scripts/smoke-production.sh'
```

For the Pi-to-Nodev2 cutover, leave the new unit inactive until code, token, FFmpeg/native dependency smoke checks, and a rehearsal database copy all pass. Then disable and stop the Pi poller so a Pi reboot cannot revive it, verify both systemd state and process state, create a uniquely named final SQLite backup without deleting earlier backups, and transfer it through this workstation:

```bash
ssh cordt@pi0.lan \
  'set -eu; sudo systemctl disable --now stickerbot.service; enabled="$(systemctl is-enabled stickerbot.service 2>/dev/null || true)"; active="$(systemctl is-active stickerbot.service 2>/dev/null || true)"; printf "is-enabled=%s\nis-active=%s\n" "$enabled" "$active"; test "$enabled" = disabled; test "$active" = inactive; ! pgrep -af "[n]ode .*src/bot.js"'
SOURCE_BACKUP="$(ssh cordt@pi0.lan '
  set -eu
  backup="/home/cordt/stickerpacks.final.$(date -u +%Y%m%dT%H%M%SZ).db"
  test ! -e "$backup"
  sudo sqlite3 /opt/stickerbot/data/stickerpacks.db ".backup \"$backup\""
  sudo chown cordt:cordt "$backup"
  chmod 0600 "$backup"
  test "$(sqlite3 "$backup" "PRAGMA quick_check;")" = ok
  printf "%s" "$backup"
')"
printf 'source backup retained at cordt@pi0.lan:%s\n' "$SOURCE_BACKUP"
scp "cordt@pi0.lan:${SOURCE_BACKUP}" /tmp/stickerpacks.final.db
ssh -F /dev/null -o BatchMode=yes bv@192.168.0.170 \
  "sudo /snap/bin/lxc exec tgbot -- sh -c 'set -eu; umask 077; cat > /opt/stickerbot/data/stickerpacks.db.incoming'" \
  < /tmp/stickerpacks.final.db
ssh -F /dev/null -o BatchMode=yes bv@192.168.0.170 \
  "sudo /snap/bin/lxc exec tgbot -- sh -lc 'set -eu; active=\"\$(systemctl is-active stickerbot.service 2>/dev/null || true)\"; test \"\$active\" = inactive; cd /opt/stickerbot/data; rm -f stickerpacks.db-wal stickerpacks.db-shm; chown stickerbot:stickerbot stickerpacks.db.incoming; chmod 0600 stickerpacks.db.incoming; test \"\$(sqlite3 stickerpacks.db.incoming \"PRAGMA quick_check;\")\" = ok; mv -f stickerpacks.db.incoming stickerpacks.db; test \"\$(sqlite3 stickerpacks.db \"PRAGMA quick_check;\")\" = ok'"
```

The target command verifies the service is inactive, removes stale target `stickerpacks.db-wal` and `stickerpacks.db-shm`, validates the incoming SQLite backup, atomically renames it into place, and validates `PRAGMA quick_check` again after the rename. Do not start the target until the Pi disabled/inactive checks above succeed. A Telegram bot token must never be held by two polling processes at once. Only after the final target database check succeeds, start exactly one poller in `nodev2:tgbot`:

```bash
ssh cordt@pi0.lan \
  'set -eu; enabled="$(systemctl is-enabled stickerbot.service 2>/dev/null || true)"; active="$(systemctl is-active stickerbot.service 2>/dev/null || true)"; printf "is-enabled=%s\nis-active=%s\n" "$enabled" "$active"; test "$enabled" = disabled; test "$active" = inactive; ! pgrep -af "[n]ode .*src/bot.js"'
ssh -F /dev/null -o BatchMode=yes bv@192.168.0.170 \
  "sudo /snap/bin/lxc exec tgbot -- sh -lc 'set -eu; systemctl enable --now stickerbot.service; enabled=\"\$(systemctl is-enabled stickerbot.service)\"; active=\"\$(systemctl is-active stickerbot.service)\"; printf \"is-enabled=%s\\nis-active=%s\\n\" \"\$enabled\" \"\$active\"; test \"\$enabled\" = enabled; test \"\$active\" = active'"
```

Verify a representative command, image conversion, and CPU video/GIF conversion while the Pi stays stopped. If target polling or conversion fails, stop and verify the target first, then restart the Pi source:

```bash
ssh -F /dev/null -o BatchMode=yes bv@192.168.0.170 \
  "sudo /snap/bin/lxc exec tgbot -- sh -lc 'set -eu; systemctl disable --now stickerbot.service; enabled=\"\$(systemctl is-enabled stickerbot.service 2>/dev/null || true)\"; active=\"\$(systemctl is-active stickerbot.service 2>/dev/null || true)\"; printf \"is-enabled=%s\\nis-active=%s\\n\" \"\$enabled\" \"\$active\"; test \"\$enabled\" = disabled; test \"\$active\" = inactive; ! pgrep -af \"[n]ode .*src/bot.js\"'"
ssh cordt@pi0.lan \
  'set -eu; sudo systemctl unmask stickerbot.service; if test -f /etc/systemd/system/stickerbot.service.pre-nodev2-migration; then sudo install -o root -g root -m 0644 /etc/systemd/system/stickerbot.service.pre-nodev2-migration /etc/systemd/system/stickerbot.service; fi; sudo systemctl daemon-reload; sudo systemctl enable --now stickerbot.service; enabled="$(systemctl is-enabled stickerbot.service)"; active="$(systemctl is-active stickerbot.service)"; printf "is-enabled=%s\nis-active=%s\n" "$enabled" "$active"; test "$enabled" = enabled; test "$active" = active'
```

Restore a database only while the target is stopped: remove its stale WAL/SHM sidecars, validate the backup with `PRAGMA quick_check`, atomically rename it into place as `stickerbot:stickerbot` mode `0600`, validate it again, and then start one poller. After target acceptance, permanently mask the Pi unit and verify it remains masked and inactive across reboots:

```bash
ssh cordt@pi0.lan \
  'set -eu; sudo systemctl disable --now stickerbot.service; fragment="$(systemctl show -p FragmentPath --value stickerbot.service)"; unit_backup=/etc/systemd/system/stickerbot.service.pre-nodev2-migration; if test "$fragment" = /etc/systemd/system/stickerbot.service && test -f "$fragment" && test ! -L "$fragment"; then if test -f "$unit_backup"; then sudo cmp -s "$fragment" "$unit_backup" || { printf "unit backup differs: %s\n" "$unit_backup" >&2; exit 1; }; sudo rm -f "$fragment"; else sudo mv "$fragment" "$unit_backup"; fi; fi; sudo systemctl daemon-reload; sudo systemctl mask stickerbot.service; enabled="$(systemctl is-enabled stickerbot.service 2>/dev/null || true)"; active="$(systemctl is-active stickerbot.service 2>/dev/null || true)"; printf "is-enabled=%s\nis-active=%s\n" "$enabled" "$active"; test "$enabled" = masked; test "$active" = inactive; ! pgrep -af "[n]ode .*src/bot.js"'
```

Retain `$SOURCE_BACKUP` on the Pi as the final source backup. Remove only the sensitive workstation copy and any obsolete target rehearsal copies after acceptance; also retain the Pi unit backup used to make the persistent mask reversible.

---

## Usage

1. Start the bot on Telegram using the `/start` command.
2. Select a mode:
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
