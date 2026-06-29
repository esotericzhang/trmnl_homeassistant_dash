# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build / test / lint

All commands run from `trmnl-ha-layout/`:

- `npm run build` — TypeScript compile to `dist/` (entrypoint `dist/src/server.js`).
- `npm run typecheck` — `tsc --noEmit` (authoritative type check; SourceKit is unreliable).
- `npm test` — vitest run. 30 tests across 7 files.
- `npm run lint` — eslint `. --ext .ts`. `vitest.config.ts` is ignored (not in tsconfig project).

Tests share a vitest setup (`tests/setup.ts`) that redirects `LAYOUT_PATH` to a temp dir so `settings.json` bootstrap-on-first-read never pollutes the repo root. New tests that touch settings/env should follow the same pattern (pass explicit settings paths or set `LAYOUT_PATH` to a temp dir).

## Settings persistence (GUI auth migration, task #1)

`trmnl-ha-layout/src/config.ts` owns the settings store. `settings.json` lives next to `layout.yaml`:

- Container/addon (`/data/options.json` exists OR `LAYOUT_PATH` set): `/data/settings.json` (or `dirname(LAYOUT_PATH)/settings.json`).
- Dev: `<cwd>/settings.json`. `trmnl-ha-layout/settings.json` is gitignored.

`loadSettingsSafe()` bootstraps an empty `{}` file on first read (no env-var requirement to start). `saveSettings()` writes atomically (tmp + rename, mirroring `saveLayoutConfig()`).

Config precedence (highest first): `process.env` → `/data/options.json` (addon) → `settings.json` (GUI) → defaults. Implemented in `getRuntimeConfig()` and `terminusOptionsFromEnv()`. GUI changes take effect on the next push (no restart) because `refreshAndPush()` re-resolves options per tick.

`GET /api/settings` masks tokens to last-4 (`••••abcd`). `PUT /api/settings` preserves existing tokens when the submitted value is masked (`••••…`) or absent — only real non-masked values overwrite. `POST /api/terminus/login` and `/api/terminus/refresh` discard credentials, persist tokens with `obtainedAt`, and return only `{ success, obtained_at }` (never the tokens themselves — the client re-fetches via GET).

## Settings GUI auth

`SETTINGS_TOKEN` env var (or `settings.settingsToken`) gates all mutating endpoints (`PUT /api/config`, `POST /api/refresh`, `PUT /api/settings`, `POST /api/terminus/*`, `DELETE /api/terminus/tokens`). If unset, mutations are allowed with a logged warning (dev fallback). `ALLOW_NO_AUTH=1` silences the warning explicitly. The `/editor` page accepts `?token=` and stores it in `sessionStorage`; the client attaches `Authorization: Bearer <token>` to all fetches. Do not regress: `GET /api/settings` must never return full `haToken`, `terminus.login`, `terminus.password`, or raw JWTs.

## Out of scope for task #1 (handled by later tasks)

- Device registry / selector — the `device: string | null` field exists in the Settings schema but no device API or dropdown yet.
- Terminus delivery-mode strategy refactor, cron/multi-schedule, 422→PATCH optimization.
- Token soft/hard expiry thresholds (`isRefreshable`/`isTokenValid` proactive keepalive) — reliability gap, not an end-state blocker.

## TerminusClient.login / refresh

`TerminusClient` exposes public `login(apiUrl, login, password)` and `refresh(options)` methods (used by the GUI auth routes) in addition to the internal `resolveAccessToken` used at push time. Both discard the password and return `{ accessToken, refreshToken }`.
