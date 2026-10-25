# Snipname

Windows Snipping Tool saves files like `Cuplikan layar 2026-10-09 153059.png`. After a few dozen, finding one screenshot is painful.

**Snipname** watches your Screenshots folder, asks a **local Gemma** model (via Ollama) what is on the image, and renames the file to a short searchable slug — e.g. `auth0-login-error.png`.

Built for [DEV Hacktoberfest Week 3 — Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19): open-weight AI that does the boring work so you don’t.

## Stack

- **Tauri 2 + React + TypeScript** — small native Windows desktop app
- **Ollama + Gemma 3 (vision)** — names screenshots on your machine; nothing leaves the laptop
- No Temporal (on purpose): a simple scan → dry-run → rename loop is enough

## Prerequisites

1. [Rust](https://rustup.rs/) + Tauri [Linux/Windows prerequisites](https://tauri.app/start/prerequisites/)
2. Node 20+ and [pnpm](https://pnpm.io/)
3. [Ollama](https://ollama.com/) with a vision-capable Gemma, e.g. `ollama pull gemma3:4b`

## Develop

```bash
pnpm install
pnpm tauri dev
```

1. Point the folder at `%USERPROFILE%\Pictures\Screenshots` (default on Windows).
2. **New** opens the same overlay as Snipping Tool: rectangle, window, full screen, or freeform. `Print Screen` does the same when it is free. Delay is 3, 5, or 10 seconds.
3. Release the drag. The snip is copied and saved immediately as `Cuplikan layar YYYY-MM-DD HHMMSS.png`, so you can snip again without waiting.
4. Gemma renames that file in the background. **Scan / Dry run / Rename** still works for older unnamed files.

## Landing / .tech

A marketing landing page will live separately so the project can sit on a `.tech` domain for the partner category. App binary stays desktop-local.

## License

MIT (to be added).
