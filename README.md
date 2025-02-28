# Telegram Sticker Bot

Bot to process images into Telegram-compatible sticker formats or emotes, with persistent sticker pack management.

---

## Features

- Convert images to **Icon Format** (100x100 resolution for Telegram emotes)
- Convert images to **Sticker Format** (512x512 resolution with a 50px transparent buffer)
- Support for all sticker types:
  - **Static stickers** (WebP format)
  - **Animated stickers** (TGS format)
  - **Video stickers** (WebM/VP9 format)
- Handles both single and multiple image uploads in a single message
- Processes existing Telegram stickers by adding a 50px transparent buffer
- Outputs processed images in `.webp` format and sends them back as documents to avoid compression
- **Persistent sticker pack management**:
  - Create new sticker packs (static, animated, or video)
  - Add stickers to existing packs
  - Add external packs to your collection
  - Mark packs as favorites
  - Manage your pack collection
- Manages temporary files and cleans up automatically

---

## Requirements

- **Node.js** v14 or later
- Telegram Bot Token (obtainable via [BotFather](https://core.telegram.org/bots#botfather))
- SQLite3
- FFmpeg (for video sticker processing)

---

## Installation

1. Clone the repository:

    ```bash
    git clone <repository-url>
    cd telegram-sticker-bot
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Ensure FFmpeg is installed:

    ```bash
    # On Debian/Ubuntu
    apt install ffmpeg
    
    # On macOS with Homebrew
    brew install ffmpeg
    
    # On Windows
    # Download from https://ffmpeg.org/download.html and add to PATH
    ```

4. Create a `.env` file:

    ```sh
    BOT_TOKEN=<your-telegram-bot-token>
    ```

5. Start the bot:

    ```bash
    npm start
    ```

   For development with live reload:

   ```bash
   npm run dev
   ```

---

## Usage

1. Start the bot on Telegram using the `/start` command.
2. Select a mode:
    - **Icon Format**: Converts images to 100x100 for emotes.
    - **Sticker Format**: Converts images to 512x512 (or smaller) with a 50px transparent buffer.
    - **Manage Sticker Packs**: Create and manage your sticker collections.
3. For image conversion, send one or more images to the bot.
4. For sticker pack management, you can:
    - Create a new pack and add stickers
    - Add stickers to your existing packs
    - Add external packs to your collection
    - View and manage your collection

---

## Sticker Format Requirements

### Static Stickers
- WebP format
- 512x512 pixels (one dimension must be exactly 512px)
- File size under 512KB

### Animated Stickers
- TGS format (Telegram's compressed Lottie)
- 512x512 pixels canvas
- 60 FPS, maximum 3 seconds
- File size under 64KB

### Video Stickers
- WebM container with VP9 codec
- No audio tracks
- 512x512 pixels (one dimension must be exactly 512px)
- 30 FPS maximum, maximum 3 seconds
- File size under 256KB

---

## Database Schema

The bot uses SQLite to store persistent data about user sticker packs:

- **users**: Stores user information
- **sticker_packs**: Stores sticker pack details (including type)
- **stickers**: Stores information about individual stickers
- **user_packs**: Manages the relationship between users and packs

The database file is stored in the `src/data/` directory.

---

## Supported Inputs

- **Static Images**: JPEG, PNG, or WEBP (up to 50MB)
- **Animated Stickers**: TGS files from Telegram
- **Video Stickers**: WebM files with VP9 codec
- **Existing Telegram Stickers**: All types

---

## Development Notes

- Temporary files are stored in the `temp/` directory and automatically purged after 6 hours of inactivity.

- Sticker pack data is persisted in a SQLite database with non-sequential IDs for security.

- Modular structure:
  - `bot.js`: Core bot functionality
  - `databaseManager.js`: Handles database operations
  - `stickerManager.js`: Manages sticker pack operations
  - `imageProcessor.js`: Handles static image processing
  - `animatedStickerProcessor.js`: Handles animated and video sticker processing
  - `fileUtils.js`: Manages file operations
  - `utils.js`: Common utility functions
  - `sessionManager.js`: Tracks user sessions and modes

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