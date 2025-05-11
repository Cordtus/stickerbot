# Telegram Sticker Bot

A Telegraf‑based bot that converts images into Telegram‑ready sticker/emote formats and manages sticker packs persistently.

---

## Features

| Category | Details |
|----------|---------|
| Image conversion | *Icon* 100 × 100 px &nbsp;·&nbsp; *Sticker* ≤ 512 × 512 px with 50 px transparent padding |
| Sticker processing | Accepts existing `.webp` stickers, adds padding automatically |
| Multiple uploads | Handles single files or batches in one message |
| Output | Always returns `.webp` as **documents** to avoid Telegram re‑compression |
| Sticker‑pack ops | Create packs · add stickers · import external packs · mark favourites · list/manage packs |
| Reliability | Cleans up temp files automatically; persistent SQLite DB for packs/users |

---

## Requirements

* **Node.js ≥ 18 LTS** (recommended; v14 still works but is EOL‑soon)  
* **Yarn ≥ 1.22** – project is Yarn‑based  
* **SQLite 3**  
* Telegram **Bot Token** – obtain from [BotFather](https://core.telegram.org/bots#botfather)

---

## Quick Start

```bash
# 1 · clone
git clone https://github.com/<your‑org>/stickerbot.git
cd stickerbot

# 2 · install deps
yarn install --frozen-lockfile

# 3 · configure
cp .env.example .env
$EDITOR .env            # set BOT_TOKEN, DB_PATH, etc.

# 4 · run (development, auto‑reload)
yarn dev

# 5 · run (production)
yarn start
````

\### Production via systemd

A hardened unit file is included in `deploy/stickerbot.service`.  Install with:

```bash
sudo cp deploy/stickerbot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stickerbot
```

Check logs:

```bash
sudo journalctl -u stickerbot -f
```

---

\## Environment Variables (`.env`)

| Var         | Purpose                                           |
| ----------- | ------------------------------------------------- |
| `BOT_TOKEN` | **Required** – token from BotFather               |
| `DB_PATH`   | SQLite file (default: `./src/data/stickerbot.db`) |
| `TEMP_DIR`  | Temp work dir (default: `./temp`)                 |
| `LOG_LEVEL` | `info` · `debug` · `error` (default `info`)       |

---

\## Database Schema (SQLite)

```
users(id PRIMARY KEY,  telegram_id, first_name, last_name, username, created_at)
sticker_packs(id PRIMARY KEY,  title, short_name, is_animated, owner_id FK->users, created_at)
stickers(id PRIMARY KEY,  file_unique_id, file_id, pack_id FK->sticker_packs, emoji, created_at)
user_packs(user_id FK->users,  pack_id FK->sticker_packs,  is_favourite, UNIQUE(user_id,pack_id))
```

DB file lives at `src/data/` (configurable via `DB_PATH`).

---

\## Usage

1. `/start` – choose a mode: **Icon**, **Sticker**, **Manage Packs**.
2. Send images or stickers → bot returns converted `.webp`.
3. In *Manage Packs* you can create/import packs, add stickers, mark favourites, list packs, etc.

---

\## Scripts

| Command      | Action                                              |
| ------------ | --------------------------------------------------- |
| `yarn dev`   | Run with `nodemon`/hot‑reload                       |
| `yarn start` | Production start (`node dist/bot.js`)               |
| `yarn build` | Transpile TypeScript (if present) & prepare `dist/` |
| `yarn lint`  | ESLint (follows npm‑recommended rules)              |
| `yarn clean` | Purge `dist/` and `temp/`                           |

---

\## Project Structure

```
src/
  bot.js              # entry point
  imageProcessor.js   # conversion logic (sharp/webp)
  stickerManager.js   # pack CRUD
  databaseManager.js  # SQLite ops
  fileHandling.js     # temp dir cleanup
  sessionManager.js   # per‑user state
deploy/
  stickerbot.service  # systemd unit
temp/                 # ephemeral work files
```

---

\## Contributing

```bash
git checkout -b feature/my-awesome-idea
# hack…
git commit -s -m "feat: my awesome idea"
git push origin feature/my-awesome-idea
```

Then open a Pull Request.

---

\## License

MIT
