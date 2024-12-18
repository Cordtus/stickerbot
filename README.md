# Telegram Sticker Bot

Bot to process images into Telegram-compatible sticker formats or emotes.

---

## Features

- Convert images to **Icon Format** (100x100 resolution for Telegram emotes).
- Convert images to **Sticker Format** (512x512 resolution with a 50px transparent buffer).
- Handles both single and multiple image uploads in a single message.
- Processes existing Telegram stickers by adding a 50px transparent buffer.
- Outputs processed images in `.webp` format and sends them back as documents to avoid compression.
- Manages temporary files and cleans up automatically.

---

## Requirements

- **Node.js** v14 or later
- Telegram Bot Token (obtainable via [BotFather](https://core.telegram.org/bots#botfather))

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

3. Create a `.env` file:

    ```sh
    BOT_TOKEN=<your-telegram-bot-token>
    ```

4. Start the bot:

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
2. Select a conversion mode:
    - **Icon Format**: Converts images to 100x100 for emotes.
    - **Sticker Format**: Converts images to 512x512 (or smaller) with a 50px transparent buffer.
3. Send one or more images to the bot for conversion.
4. Receive processed images as `.webp` documents.
5. After processing, choose to **Start Over** or **Convert More** in the current mode.

---

## Supported Inputs

- **Static Images**: JPEG, PNG, or WEBP (up to 50MB).
- **Existing Telegram Stickers**: Adds a 50px transparent buffer.

---

## Development Notes

- Temporary files are stored in the `temp/` directory and automatically purged after 6 hours of inactivity.

- Modular structure:
  - `bot.js`: Core bot functionality.
  - `imageProcessor.js`: Handles image processing.
  - `fileHandling.js`: Manages temporary files.
  - `sessionManager.js`: Tracks user sessions and modes.

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
