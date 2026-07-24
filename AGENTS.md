# Repository Guidelines

## Project Structure & Module Organization

The Telegram bot is an ES-module Node application. Source lives in `src/`: `bot.js` wires Telegraf and startup, `messageHandlers.js`, `commandHandlers.js`, and `callbackHandlers.js` route Telegram events, and the processor/manager modules own media, files, sessions, and SQLite data. Keep runtime locations centralized in `src/runtimePaths.js`; application state belongs in `data/` and transient media in `temp/`, never beneath `src/`. Production packaging is in `scripts/` and `stickerbot.service`. Node built-in test files live in `test/`.

## Build, Test, and Development Commands

- `npm ci` installs lockfile-resolved dependencies.
- `npm test` runs the Node test runner (`node --test`).
- `npm start` starts the bot and requires a local `.env` containing `BOT_TOKEN`.
- `npm run dev` runs the same entry point under Nodemon.
- `bash scripts/smoke-production.sh` checks the bounded FFmpeg/VP9 production-media path; use it when changing video processing or deployment scripts.

FFmpeg is required for video/GIF support; image-only work can run without it. Native `sharp` and `sqlite3` modules must be installed on the target platform; do not copy `node_modules` between architectures.

## Coding Style & Naming Conventions

Use ESM imports with explicit `.js` extensions. Follow the touched file's existing formatting: most application modules use four-space indentation, while newer tests use tabs. Prefer focused modules and `camelCase` functions/variables; name source files by their responsibility (for example, `videoProcessor.js`). Keep filesystem paths and permissions behind the runtime/deployment helpers instead of scattering literals.

## Testing Guidelines

Add behavior-focused `node:test` coverage in `test/*.test.mjs`, named for the observable requirement (for example, `production install preserves state`). Tests must use isolated temporary directories and clean them up with `t.after`; never require a real token, Telegram network access, or production database. Run `npm test` before submitting changes, especially after edits to `scripts/`, `stickerbot.service`, or runtime paths.

## Commit & Pull Request Guidelines

Recent history favors short, imperative subjects such as `Add StickerBot production deployment` and `Fix image resizing to preserve aspect ratio for stickers`. Keep commits scoped to one change. PRs should explain the user-visible or operational effect, mention tests run, link relevant issues, and include screenshots only for Telegram/UI changes. Never commit `.env`, tokens, SQLite databases, generated media, or local agent notes.

## Security & Production Changes

Treat `/opt/stickerbot/data/stickerpacks.db` as persistent state. Preserve the service's restricted writable paths and root-owned source/runtime setup. Do not start a second poller during migration, and validate SQLite backups with `PRAGMA quick_check` before restoring them.
