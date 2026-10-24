# Dependencies

Every dependency needs a reason. Prefer browser and Bun built-ins over packages.

| Package | Kind | Why |
|---|---|---|
| `react`, `react-dom` | runtime | UI. Lets the reading surface reuse Reader's tested `GuidedReader` component. Pulls in `scheduler` (same maintainers). |
| `typescript` | dev | Type checking (`tsc --noEmit`). Bun handles compiling. |
| `@types/react`, `@types/react-dom`, `@types/bun` | dev | Type definitions only. |
| `happy-dom` | dev | `DOMParser` for tests and `scripts/epub-smoke.ts`; Bun has none. Never shipped to the browser. |

## Rules

- Exact versions only (`bunfig.toml` sets `exact = true`). Commit `bun.lock` and install with `bun install --frozen-lockfile`.
- No install scripts: Bun never runs dependency lifecycle scripts unless the package is in `trustedDependencies`, which stays empty.
- `bunfig.toml` sets `minimumReleaseAge` to 7 days, so a freshly published version is never installed.
- Run `bun audit` before adding or upgrading anything, and add a row above.
