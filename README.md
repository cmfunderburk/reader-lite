# Reader Lite

A small, tablet-first reader for EPUBs and Markdown notes, built around a smooth line pacer used as an attention anchor, with Guided (OVP fixations) and Generation (letter masking) modes, plus Wikipedia's featured articles.

It's a lighter sibling of [Reader](https://github.com/cmfunderburk/Reader), aimed at reading on an iPad.

## Development

Requires [Bun](https://bun.com).

```bash
bun install --frozen-lockfile
bun run dev       # dev server with hot reload on 127.0.0.1:5418 (desktop browser only)
bun run ipad      # production mode, restarts on file changes; use this behind tailscale serve
bun run verify    # typecheck + tests
bun run start     # production mode
```

## Reading on an iPad over Tailscale

The server binds to `127.0.0.1` only. Bun's dev server rejects requests whose Host header isn't localhost, so serve production mode (`bun run ipad` or `bun run start`) and expose it to your tailnet over HTTPS:

```bash
tailscale serve --bg 5418
# open https://<host>.<tailnet>.ts.net/ on the iPad, then Share → Add to Home Screen
tailscale serve reset   # stop sharing
```

After the first visit the app works offline: a service worker keeps the app itself, and books live in the iPad's own storage, so the desktop can be asleep or off. When the desktop serves a newer build, the app offers "A new version is ready · Reload". The dev server (`bun run dev`) removes the service worker instead of using it.

Books and places stay on the device. **Backup** at the bottom of the library exports the reading state (a small JSON file) or everything including the books (a zip), and restores either one.

The home-screen icon is drawn in `public/icon.svg`; `scripts/make-icons.sh` re-renders the PNGs (needs `rsvg-convert`).

## License

MIT. See `LICENSE`.
