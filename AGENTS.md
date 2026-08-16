# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build / test / lint

All commands run from `trmnl-ha-layout/`:

- `npm run build` — TypeScript compile to `dist/` (entrypoint `dist/src/server.js`).
- `npm run typecheck` — `tsc --noEmit` (authoritative type check; SourceKit is unreliable).
- `npm test` — run the Vitest suite.
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

`SETTINGS_TOKEN` env var (or `settings.settingsToken`) gates every mutating schedule, config, refresh, settings, and Terminus endpoint, plus read-only Home Assistant entity discovery and layout reads containing editor preview snapshots because both may expose private state. If unset, protected routes are allowed with a logged warning (dev fallback). `ALLOW_NO_AUTH=1` silences the warning explicitly. The `/editor` page accepts `?token=` and stores it in `sessionStorage`; the client attaches `Authorization: Bearer <token>` to all fetches. Do not regress: `GET /api/settings` must never return full `haToken`, `terminus.login`, `terminus.password`, or raw JWTs, entity discovery must expose only its UI summary fields, and schedule API responses must mask webhook URLs.

## TerminusClient.login / refresh

`TerminusClient` exposes public `login(apiUrl, login, password)` and `refresh(options)` methods (used by the GUI auth routes) in addition to the internal `resolveAccessToken` used at push time. Both discard the password and return `{ accessToken, refreshToken }`.

## Multi-schedule persistence and execution

`src/schedules.ts` owns the versioned schedule store. `schedules/index.json` lives beside `settings.json`; layouts remain YAML at `schedules/<id>/layout.yaml`. First startup migrates the legacy layout/settings into the stable `default` schedule, writes the index last, and leaves the original files untouched. Legacy `/api/config`, `/api/refresh`, `/screen.*`, and `/render` routes always resolve through the persisted `defaultScheduleId`.

When `settings.json` exists, migration reads it strictly and must fail before publishing `index.json` if it is malformed. `layout.yaml` and `LAYOUT_PATH` are migration inputs after schedules initialize; later file edits must target `schedules/<id>/layout.yaml` or use the editor/API.

Each schedule owns `manual`, `interval`, or `daily` timing, enabled state, text-ID destination fallbacks, optional delivery/screen metadata, and latest status. Home Assistant connection and Terminus API/JWT remain global. Legacy schedule-specific environment/add-on options apply only to the default schedule; new schedules receive unique `ha-layout-<id>` Terminus names and `/schedules/<id>/screen.png` BYOS URIs.

`createScheduleCoordinator()` reloads metadata every poll, runs due schedules serially, prevents overlapping polls, and persists status through a callback. Daily scheduling uses `Intl` timezone calculations. Device registry selectors, proactive shared token refresh, and direct known-screen PATCH remain follow-up optimizations; do not copy registry objects or auth tokens into schedule records.

Editor schedule switches mark the clicked tab as loading while its config loads, then make it active only after the load succeeds. They must restore the previous `activeId` if loading fails; leaving the failed target active internally while the old schedule remains rendered makes later clicks on the target return early and appear completely unresponsive.

## Metric rendering and preview snapshots

`previewSource`/`previewState`/`previewUnit` on a metric are editor-only snapshots: `editorPreviewRenderData()` feeds them to the canvas/`/preview` render, while runtime SVG/PNG/push (`HomeAssistantClient.collect`) never sees them and always resolves metric values from live Home Assistant data. `GET` layout routes that carry preview snapshots require settings auth.

Live/fallback unit insertion at runtime requires `unitSource` to match the placeholder, an available value, a raw-or-unset filter, AND no explicit literal unit decoration next to that placeholder (`hasExplicitUnitDecoration` in `src/render.ts`). The editor mirrors this as `templateHasExplicitUnit` and deletes `unitSource` when an explicit unit is typed, so editor canvas preview and exported output stay in parity; keep the two guards aligned when changing the unit token list.

`loadLayoutConfig()` repairs picker snapshots saved before `previewSource` existed by binding them to the metric's sole configured template source (preferring a valid `unitSource`). Ambiguous orphaned snapshots are discarded because preview metadata is editor-only; direct writes remain strictly validated.

Editor canvas masking: `#canvas-state` (z-index 3) and `.canvas-state-card` must stay `pointer-events:none` with a transparent full-bleed background; only `#retry-preview` may be `pointer-events:auto`. Otherwise the error/rendering UI blocks item clicks on `#overlay` (z-index 2), which is the "clicking does nothing" failure mode when a draft preview fails and the canvas is stuck hidden. jsdom has no hit-testing, so regressions assert the computed `pointer-events` values; verify real clicks with `document.elementFromPoint` in a live browser.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
