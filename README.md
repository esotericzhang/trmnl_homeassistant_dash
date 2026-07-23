# TRMNL Home Assistant Layout

A Home Assistant compatible add-on and standalone Docker app that renders Home Assistant sensor data into a precisely positioned 800x480 TRMNL frame for the Seeed Studio TRMNL 7.5-inch OG DIY Kit. It avoids dashboard screenshots and markdown spacing by rendering configurable SVG/HTML from sensor state and attributes.

## Features

- Home Assistant REST API client configured from the editor settings UI, Home Assistant add-on options, or environment variables.
- Multiple named schedules, each with its own YAML layout, enabled state, manual/interval/daily timing, destination metadata, and push status.
- YAML layout files with explicit `x`, `y`, `width`, `height`, `fontSize`, `align`, and related positioning controls.
- Default Sleep + Weather dashboard for the Seeed Studio TRMNL 7.5-inch OG DIY Kit, 800x480.
- Pull endpoints for Terminus or browsers, with legacy default-schedule routes and stable `/schedules/:id/*` routes.
- Browser layout editor at `/` and `/editor` with responsive schedule tabs, a searchable manager, drag/resize/style controls, global connection settings, and a searchable live Home Assistant entity picker for sensor fields.
- Push endpoint/job for Terminus BYOS Hanami/JWT `/api/screens` or generic PNG webhooks.
- Per-schedule refresh timing through the editor. Legacy `REFRESH_INTERVAL_SECONDS` seeds the migrated default schedule.

## Standalone quick start

```bash
cd trmnl-ha-layout
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:10000/` to edit schedules and global connection settings, or use `http://localhost:10000/preview` for the default-schedule preview page.

When adding a **Sensor value** field, the editor loads entities from the configured Home Assistant instance and lets you search by friendly name, entity ID, or domain. Results show the current state and unit when available. Selecting a discovered entity saves that state and unit as an editor-only preview snapshot so the new metric is understandable on the canvas before and after saving; runtime renders still fetch live Home Assistant data. The entity ID remains a normal text input, so existing or uncommon IDs that discovery does not return can still be entered manually without adding a snapshot.

## Home Assistant add-on

Add this repository to Home Assistant, install **TRMNL HA Layout**, and configure the add-on options or editor connection settings. On a new install, create and edit layouts through the editor. On upgrade, an existing `/data/layout.yaml` is imported once into the default schedule; active layouts then live under `/data/schedules/<schedule-id>/layout.yaml`.

## Docker Compose deployment

Use Docker Compose when running this dashboard outside Home Assistant. Start with Home Assistant access only; Terminus can be configured later from **Global connection** in `/editor`.

A prebuilt multi-arch image (amd64 + arm64) is published to GHCR on every push to `main`:

```yaml
services:
  trmnl-ha:
    image: ghcr.io/esotericzhang/trmnl_homeassistant_dash:latest
    container_name: trmnl-ha
    restart: unless-stopped
    ports:
      - "10000:10000"
    environment:
      HOME_ASSISTANT_URL: "http://192.168.1.50:8123"
      ACCESS_TOKEN: "replace_with_home_assistant_long_lived_token"
      TZ: "America/New_York"
      ALLOW_NO_AUTH: "1"
    volumes:
      - ./data:/data
```

To build from source instead, replace `image:` with `build: ./trmnl-ha-layout`.

Start the app:

```bash
docker compose up -d
```

Then open `http://localhost:10000/editor` to edit schedules and save global connection settings. The `/data` mount persists `settings.json`, `schedules/index.json`, and each `schedules/<schedule-id>/layout.yaml` across container upgrades. A legacy `layout.yaml` is migration input only after schedules have been initialized.

Use a Home Assistant URL reachable from inside the container. A LAN IP, such as `http://192.168.1.50:8123`, is usually more reliable than `homeassistant.local` or `localhost` in Docker.

The image runs with `NODE_ENV=production`, so mutating endpoints and Home Assistant entity discovery are blocked unless you choose one auth mode:

- Trusted LAN/dev use: set `ALLOW_NO_AUTH="1"` as shown above.
- Token-protected use: remove `ALLOW_NO_AUTH`, set `SETTINGS_TOKEN="replace_with_editor_token"`, and open `http://localhost:10000/editor?token=replace_with_editor_token` once so the browser stores the token.

### Optional Terminus environment configuration

Terminus settings can usually be saved in the editor instead of Compose. Use environment variables when you want container-managed configuration:

- `TERMINUS_API_URL`: Terminus base URL reachable from the dashboard container when using Terminus push modes.
- `TERMINUS_MODE`: `byos-uri` (default), `byos-base64`, `screen-content`, or `raw-webhook` for the default schedule.
- `ADDON_BASE_URL`: Required only for `byos-uri`; this is the URL Terminus can use to fetch this dashboard's `/screen.png`.
- `REFRESH_INTERVAL_SECONDS`: Optional interval used to seed the default schedule during first-run migration.
- `SETTINGS_TOKEN`: Optional bearer token for all mutating schedule, layout, settings, refresh, and Terminus auth requests, plus Home Assistant entity discovery; open `/editor?token=<token>` once so the browser stores it.

Environment variables have highest precedence, then Home Assistant add-on options, then `/data/settings.json`, then defaults.

`TERMINUS_API_URL` must be the Terminus base URL, for example `http://192.168.1.50:2300`. Do not include `/api/screens`; the app appends `/login`, `/api/screens`, and `/api/jwt` itself.

`GET /api/settings` returns GUI-saved settings from `/data/settings.json` with secrets masked. It does not show environment variable overrides, even though those env values are active at runtime.

Add-on URL examples for `byos-uri`:

- Same Docker Desktop host: set `ADDON_BASE_URL=http://host.docker.internal:10000` so a Terminus container can call back to the dashboard through the host port mapping.
- Same LAN: set `ADDON_BASE_URL=http://<host-lan-ip>:10000`, for example `http://192.168.1.50:10000`, and make sure the host firewall allows the port.
- Behind a reverse proxy: set `ADDON_BASE_URL=https://trmnl-ha.example.com` and route that host to the dashboard container's port `10000`.

`localhost` is usually wrong for Add-on URL from inside the Terminus container. From Terminus, `localhost` means the Terminus container itself, not this dashboard. Use `host.docker.internal` on Docker Desktop, a LAN IP/hostname, or a reverse-proxy URL that Terminus can reach.

## Configuration and settings

The editor's **Global connection** panel saves shared Home Assistant and Terminus authentication settings to `settings.json` next to the legacy layout file. With the default add-on layout path this is `/data/settings.json`; with a custom `LAYOUT_PATH` it is `settings.json` in the same directory as that layout; in standalone development it is `./settings.json`.

Schedules are stored in `schedules/index.json`, with each layout at `schedules/<schedule-id>/layout.yaml`. On first startup after upgrading, the existing single `layout.yaml` and its refresh/destination settings are copied into a `default` schedule. The original files remain in place, and legacy routes continue to resolve to that persisted default schedule.

Configuration precedence is environment variables first, then Home Assistant add-on options from `/data/options.json`, then GUI-saved `settings.json`, then defaults. Pushes re-read shared connection and Terminus settings. Schedule timing changes are reloaded by the coordinator without a restart; legacy `refresh_interval_seconds` applies only to the migrated default schedule.

Set `SETTINGS_TOKEN` or the add-on `settings_token` option to protect mutating endpoints and Home Assistant entity discovery. When a token is set, open `/editor?token=<token>` once; the editor stores it in session storage and sends `Authorization: Bearer <token>` for schedule changes, layout saves, settings saves, refreshes, Terminus auth actions, and entity discovery. If no token is configured, protected requests are allowed with a warning for development; set `ALLOW_NO_AUTH=1` only to silence that warning in local/dev use.

## Important environment variables

- `HOME_ASSISTANT_URL`: Home Assistant base URL, for example `http://homeassistant:8123`.
- `ACCESS_TOKEN` or `HA_TOKEN`: Home Assistant long-lived token.
- `LAYOUT_PATH`: Optional legacy layout path used as first-run migration input and to locate the persistent settings/schedules directory. After migration, active layouts are stored under `schedules/<schedule-id>/layout.yaml` beside it.
- `ADDON_BASE_URL`: Add-on URL Terminus can use to fetch this dashboard's `/screen.png` in `byos-uri` mode. `PUBLIC_BASE_URL` remains supported as a legacy alias.
- `TERMINUS_API_URL`: Terminus base URL, for example `http://terminus:2300`.
- `TERMINUS_LOGIN` / `TERMINUS_PASSWORD`: Optional environment/add-on Terminus login for JWT access. The editor login flow stores returned JWT tokens, not credentials.
- `TERMINUS_ACCESS_TOKEN` / `TERMINUS_REFRESH_TOKEN`: Optional manual Terminus JWT tokens.
- `TERMINUS_MODE`: `byos-uri` (default), `byos-base64`, `screen-content`, or `raw-webhook`; this legacy override applies only to the default schedule.
- `TERMINUS_MODEL_ID`, `TERMINUS_SCREEN_NAME`, `TERMINUS_SCREEN_LABEL`, `TERMINUS_PLAYLIST_ID`: Optional default-schedule screen metadata overrides for BYOS pushes.
- `TERMINUS_SCREEN_ID`: Optional default-schedule fallback for duplicate-screen lookup; normally runtime-derived on 422 conflicts, not user-configured in the editor.
- `TERMINUS_WEBHOOK_URL`: Generic webhook endpoint override for the default schedule's `raw-webhook` mode.
- `REFRESH_INTERVAL_SECONDS`: Optional interval used to seed the default schedule during first-run migration; later schedule timing is edited per schedule.
- `SETTINGS_TOKEN`: Optional bearer token required for all mutating schedule, layout, settings, refresh, and Terminus auth requests, plus Home Assistant entity discovery.
- `ALLOW_NO_AUTH`: Set to `1` to allow unauthenticated settings mutations without the development warning.

`ADDON_BASE_URL` / `addon_base_url` take precedence over legacy `PUBLIC_BASE_URL` / `public_base_url`; existing legacy values continue to work when the new alias is unset.

## API

- `GET /health`: service status.
- `GET /`: redirects to `/editor`.
- `GET /screen.png`: renders the persisted default schedule as an 800x480 PNG. Use `/schedules/:id/screen.png` for another schedule.
- `GET /screen.svg`: renders the persisted default schedule as SVG.
- `GET /render`: wraps the persisted default schedule's SVG in HTML.
- `GET /preview`: minimal default-schedule preview and refresh UI.
- `GET /editor`: browser schedule, layout, and global connection settings editor for the 800x480 frame. Accepts `?token=<SETTINGS_TOKEN>` for protected requests, including entity discovery.
- `POST /api/refresh`: fetches Home Assistant state and pushes the persisted default schedule.
- `GET /api/config`: returns the persisted default schedule's layout configuration.
- `PUT /api/config`: validates and saves the persisted default schedule's layout.
- `GET /api/schedules`: lists schedules and the legacy default schedule ID.
- `POST /api/schedules`: creates a disabled blank schedule.
- `GET /api/schedules/:id`: returns one schedule.
- `PATCH /api/schedules/:id`: updates schedule identity, enabled state, timing, or destination; status is server-owned.
- `DELETE /api/schedules/:id`: deletes only the local schedule and layout when at least one other schedule remains.
- `POST /api/schedules/:id/duplicate`: duplicates a schedule as a disabled copy with cleared remote status.
- `GET /api/schedules/:id/config` and `PUT /api/schedules/:id/config`: load or save one schedule's layout.
- `PUT /api/schedules/:id`: validates and saves one schedule and its layout together.
- `POST /api/schedules/:id/push`: renders and pushes one schedule immediately, even when it is disabled.
- `GET /schedules/:id/screen.png`, `/screen.svg`, `/render`: stable schedule-specific output routes.
- `GET /api/settings`: returns GUI settings with tokens masked.
- `GET /api/home-assistant/entities`: uses the active runtime Home Assistant URL/token to return filtered entity summaries (`entityId`, optional `friendlyName`, `domain`, `state`, and optional `unitOfMeasurement`) for the editor picker. It never returns the Home Assistant token or arbitrary state attributes.
- `PUT /api/settings`: validates and saves GUI settings, preserving already-masked stored tokens.
- `POST /api/terminus/login`: exchanges a Terminus API URL, login, and password for stored JWT tokens.
- `POST /api/terminus/refresh`: refreshes stored Terminus JWT tokens.
- `DELETE /api/terminus/tokens`: clears stored Terminus JWT tokens.

All mutating `/api/schedules*`, `/api/config`, `/api/refresh`, `/api/settings`, and `/api/terminus/*` endpoints require `Authorization: Bearer <SETTINGS_TOKEN>` when a settings token is configured. Entity discovery at `GET /api/home-assistant/entities` uses the same protection because entity names and states may be private; the editor sends its stored settings token automatically.
