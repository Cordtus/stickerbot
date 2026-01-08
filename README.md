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

    > *For systemd users, `BOT_TOKEN` can also be defined in the service file*

5. Start:

    ```bash
    yarn start
    ```

   For development (auto-reload on code changes):

   ```bash
   yarn dev
   ```

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

The database file is stored in the `src/data/` directory.

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
