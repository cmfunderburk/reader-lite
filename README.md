# Reader Lite

A small, tablet-first EPUB reader built around a smooth line pacer used as an attention anchor, with Guided (OVP fixations) and Generation (letter masking) modes, plus Wikipedia's featured articles.

It's a lighter sibling of [Reader](https://github.com/cmfunderburk/Reader), aimed at reading on an iPad.

## Development

Requires [Bun](https://bun.com).

```bash
bun install --frozen-lockfile
bun run dev       # dev server with hot reload on 127.0.0.1:5418
bun run verify    # typecheck + tests
bun run start     # production mode
```

## Reading on an iPad over Tailscale

The server binds to `127.0.0.1` only. Expose it to your tailnet over HTTPS:

```bash
tailscale serve --bg 5418
# open https://<host>.<tailnet>.ts.net/ on the iPad, then Share → Add to Home Screen
tailscale serve reset   # stop sharing
```

## License

Apache-2.0, same as Reader. See `LICENSE`.
