# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build / test / lint

All commands run from `trmnl-ha-layout/`:

- `npm run build` — TypeScript compile to `dist/` (entrypoint `dist/src/server.js`).
- `npm run typecheck` — `tsc --noEmit` (authoritative type check; SourceKit is unreliable).
- `npm test` — vitest run. 85 tests across 10 files.
- `npm run lint` — eslint `. --ext .ts`. `vitest.config.ts` is ignored (not in tsconfig project).

Tests share a vitest setup (`tests/setup.ts`) that redirects `LAYOUT_PATH` to a temp dir so `settings.json` bootstrap-on-first-read never pollutes the repo root. New tests that touch settings/env should follow the same pattern (pass explicit settings paths or set `LAYOUT_PATH` to a temp dir).

## Settings persistence

`trmnl-ha-layout/src/config.ts` owns the global settings store. `settings.json` lives beside the legacy layout path and the `schedules/` directory:

- Container/addon (`/data/options.json` exists OR `LAYOUT_PATH` set): `/data/settings.json` (or `dirname(LAYOUT_PATH)/settings.json`).
- Dev: `<cwd>/settings.json`. `trmnl-ha-layout/settings.json` is gitignored.

`loadSettingsSafe()` bootstraps an empty `{}` file on first read (no env-var requirement to start). `saveSettings()` writes atomically (tmp + rename, mirroring `saveLayoutConfig()`).

Global config precedence (highest first): `process.env` → `/data/options.json` (addon) → `settings.json` (GUI) → defaults. Implemented in `getRuntimeConfig()` and `terminusOptionsFromEnv()`. Connection and Terminus authentication changes take effect on the next push. Schedule timing is stored per schedule and reloaded by the coordinator; legacy `refresh_interval_seconds` only seeds the default schedule during migration.

`GET /api/settings` masks tokens to last-4 (`••••abcd`). `PUT /api/settings` preserves existing tokens when the submitted value is masked (`••••…`) or absent — only real non-masked values overwrite. `POST /api/terminus/login` and `/api/terminus/refresh` discard credentials, persist tokens with `obtainedAt`, and return only `{ success, obtained_at }` (never the tokens themselves — the client re-fetches via GET).

## Settings GUI auth

`SETTINGS_TOKEN` env var (or `settings.settingsToken`) gates every mutating schedule, config, refresh, settings, and Terminus endpoint. If unset, mutations are allowed with a logged warning (dev fallback). `ALLOW_NO_AUTH=1` silences the warning explicitly. The `/editor` page accepts `?token=` and stores it in `sessionStorage`; the client attaches `Authorization: Bearer <token>` to all fetches. Do not regress: `GET /api/settings` must never return full `haToken`, `terminus.login`, `terminus.password`, or raw JWTs, and schedule API responses must mask webhook URLs.

## TerminusClient.login / refresh

`TerminusClient` exposes public `login(apiUrl, login, password)` and `refresh(options)` methods (used by the GUI auth routes) in addition to the internal `resolveAccessToken` used at push time. Both discard the password and return `{ accessToken, refreshToken }`.

## Multi-schedule persistence and execution

`src/schedules.ts` owns the versioned schedule store. `schedules/index.json` lives beside `settings.json`; layouts remain YAML at `schedules/<id>/layout.yaml`. First startup migrates the legacy layout/settings into the stable `default` schedule, writes the index last, and leaves the original files untouched. Legacy `/api/config`, `/api/refresh`, `/screen.*`, and `/render` routes always resolve through the persisted `defaultScheduleId`.

When `settings.json` exists, migration reads it strictly and must fail before publishing `index.json` if it is malformed. `layout.yaml` and `LAYOUT_PATH` are migration inputs after schedules initialize; later file edits must target `schedules/<id>/layout.yaml` or use the editor/API.

Each schedule owns `manual`, `interval`, or `daily` timing, enabled state, text-ID destination fallbacks, optional delivery/screen metadata, and latest status. Home Assistant connection and Terminus API/JWT remain global. Legacy schedule-specific environment/add-on options apply only to the default schedule; new schedules receive unique `ha-layout-<id>` Terminus names and `/schedules/<id>/screen.png` BYOS URIs.

`createScheduleCoordinator()` reloads metadata every poll, runs due schedules serially, prevents overlapping polls, and persists status through a callback. Daily scheduling uses `Intl` timezone calculations. Device registry selectors, proactive shared token refresh, and direct known-screen PATCH remain follow-up optimizations; do not copy registry objects or auth tokens into schedule records.
