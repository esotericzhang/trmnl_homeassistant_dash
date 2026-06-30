# TRMNL Home Assistant Layout

A Home Assistant compatible add-on and standalone Docker app that renders Home Assistant sensor data into a precisely positioned 800x480 TRMNL frame for the Seeed Studio TRMNL 7.5-inch OG DIY Kit. It avoids dashboard screenshots and markdown spacing by rendering configurable SVG/HTML from sensor state and attributes.

## Features

- Home Assistant REST API client configured from the editor settings UI, Home Assistant add-on options, or environment variables.
- YAML layout file with explicit `x`, `y`, `width`, `height`, `fontSize`, `align`, and related positioning controls.
- Default Sleep + Weather dashboard for the Seeed Studio TRMNL 7.5-inch OG DIY Kit, 800x480.
- Pull endpoints for Terminus or browsers: `/screen.png`, `/screen.svg`, `/render`, `/preview`.
- Browser layout editor at `/` and `/editor` with drag, resize, style controls, connection settings, and YAML save through `/api/config`.
- Push endpoint/job for Terminus BYOS Hanami/JWT `/api/screens` or generic PNG webhooks.
- Refresh scheduling through the editor settings UI or `REFRESH_INTERVAL_SECONDS`.

## Standalone quick start

```bash
cd trmnl-ha-layout
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:10000/` to edit the layout and connection settings, or use `http://localhost:10000/preview` for the preview page.

## Home Assistant add-on

Add this repository to Home Assistant, install **TRMNL HA Layout**, configure the add-on options or the editor connection settings, and mount/edit `/data/layout.yaml` if you want custom positions.

## Docker Compose deployment

Use Docker Compose when running this dashboard outside Home Assistant. Start with Home Assistant access only; Terminus can be configured later in the browser UI at `/editor` under **Connection Settings**.

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
      HOME_ASSISTANT_URL: "http://homeassistant.local:8123"
      ACCESS_TOKEN: "replace_with_home_assistant_long_lived_token"
      TZ: "America/New_York"
    volumes:
      - ./data:/data
```

To build from source instead, replace `image:` with `build: ./trmnl-ha-layout`.

Start the app:

```bash
docker compose up -d
```

Then open `http://localhost:10000/editor` to edit the layout and save Connection Settings. The `/data` mount persists both `layout.yaml` and GUI-saved `settings.json` across container upgrades.

### Optional Terminus environment configuration

Terminus settings can usually be saved in the editor instead of Compose. Use environment variables when you want container-managed configuration:

- `TERMINUS_API_URL`: Terminus base URL reachable from the dashboard container when using Terminus push modes.
- `TERMINUS_MODE`: `byos-uri` (default), `byos-base64`, `screen-content`, or `raw-webhook`.
- `ADDON_BASE_URL`: Required only for `byos-uri`; this is the URL Terminus can use to fetch this dashboard's `/screen.png`.
- `REFRESH_INTERVAL_SECONDS`: Optional periodic refresh/push interval.
- `SETTINGS_TOKEN`: Optional bearer token for mutating layout, settings, refresh, and Terminus auth requests; open `/editor?token=<token>` once so the browser stores it.

Environment variables have highest precedence, then Home Assistant add-on options, then `/data/settings.json`, then defaults.

Add-on URL examples for `byos-uri`:

- Same Docker Desktop host: set `ADDON_BASE_URL=http://host.docker.internal:10000` so a Terminus container can call back to the dashboard through the host port mapping.
- Same LAN: set `ADDON_BASE_URL=http://<host-lan-ip>:10000`, for example `http://192.168.1.50:10000`, and make sure the host firewall allows the port.
- Behind a reverse proxy: set `ADDON_BASE_URL=https://trmnl-ha.example.com` and route that host to the dashboard container's port `10000`.

`localhost` is usually wrong for Add-on URL from inside the Terminus container. From Terminus, `localhost` means the Terminus container itself, not this dashboard. Use `host.docker.internal` on Docker Desktop, a LAN IP/hostname, or a reverse-proxy URL that Terminus can reach.

## Configuration and settings

The editor's **Connection Settings** panel saves runtime settings to `settings.json` next to the layout file. With the default add-on layout path this is `/data/settings.json`; with a custom `LAYOUT_PATH` it is `settings.json` in the same directory as that layout; in standalone development it is `./settings.json`.

Configuration precedence is environment variables first, then Home Assistant add-on options from `/data/options.json`, then GUI-saved `settings.json`, then defaults. Refreshes re-read connection and Terminus settings before each push, so those GUI settings changes do not require a restart; changing `refresh_interval_seconds` affects scheduling after restart.

Set `SETTINGS_TOKEN` or the add-on `settings_token` option to protect mutating endpoints. When a token is set, open `/editor?token=<token>` once; the editor stores it in session storage and sends `Authorization: Bearer <token>` for layout saves, settings saves, refreshes, and Terminus auth actions. If no token is configured, mutations are allowed with a warning for development; set `ALLOW_NO_AUTH=1` only to silence that warning in local/dev use.

## Important environment variables

- `HOME_ASSISTANT_URL`: Home Assistant base URL, for example `http://homeassistant:8123`.
- `ACCESS_TOKEN` or `HA_TOKEN`: Home Assistant long-lived token.
- `LAYOUT_PATH`: Optional path to YAML layout, default `/data/layout.yaml` when available, otherwise `./data/default-layout.yaml`.
- `ADDON_BASE_URL`: Add-on URL Terminus can use to fetch this dashboard's `/screen.png` in `byos-uri` mode. `PUBLIC_BASE_URL` remains supported as a legacy alias.
- `TERMINUS_API_URL`: Terminus base URL, for example `http://terminus:2300`.
- `TERMINUS_LOGIN` / `TERMINUS_PASSWORD`: Optional environment/add-on Terminus login for JWT access. The editor login flow stores returned JWT tokens, not credentials.
- `TERMINUS_ACCESS_TOKEN` / `TERMINUS_REFRESH_TOKEN`: Optional manual Terminus JWT tokens.
- `TERMINUS_MODE`: `byos-uri` (default), `byos-base64`, `screen-content`, or `raw-webhook`.
- `TERMINUS_MODEL_ID`, `TERMINUS_SCREEN_NAME`, `TERMINUS_SCREEN_LABEL`, `TERMINUS_PLAYLIST_ID`: Optional screen metadata for BYOS pushes; defaults are used when omitted.
- `TERMINUS_SCREEN_ID`: Optional fallback for duplicate-screen cleanup; normally runtime-derived on 422 conflicts, not user-configured in the editor.
- `TERMINUS_WEBHOOK_URL`: Generic webhook endpoint for `raw-webhook` mode.
- `REFRESH_INTERVAL_SECONDS`: Optional periodic refresh/push interval.
- `SETTINGS_TOKEN`: Optional bearer token required for mutating layout, settings, refresh, and Terminus auth requests.
- `ALLOW_NO_AUTH`: Set to `1` to allow unauthenticated settings mutations without the development warning.

`ADDON_BASE_URL` / `addon_base_url` take precedence over legacy `PUBLIC_BASE_URL` / `public_base_url`; existing legacy values continue to work when the new alias is unset.

## API

- `GET /health`: service status.
- `GET /`: redirects to `/editor`.
- `GET /screen.png`: renders the current dashboard as an 800x480 PNG.
- `GET /screen.svg`: renders the current dashboard as SVG.
- `GET /render`: wraps the SVG in HTML.
- `GET /preview`: minimal preview and refresh UI.
- `GET /editor`: browser layout and connection settings editor for the 800x480 frame. Accepts `?token=<SETTINGS_TOKEN>` for mutating requests.
- `POST /api/refresh`: fetches Home Assistant state and optionally pushes to Terminus/webhook.
- `GET /api/config`: returns resolved layout configuration.
- `PUT /api/config`: validates and saves layout YAML to the runtime layout path.
- `GET /api/settings`: returns GUI settings with tokens masked.
- `PUT /api/settings`: validates and saves GUI settings, preserving already-masked stored tokens.
- `POST /api/terminus/login`: exchanges a Terminus API URL, login, and password for stored JWT tokens.
- `POST /api/terminus/refresh`: refreshes stored Terminus JWT tokens.
- `DELETE /api/terminus/tokens`: clears stored Terminus JWT tokens.

Mutating endpoints (`PUT /api/config`, `POST /api/refresh`, `PUT /api/settings`, and `/api/terminus/*`) require `Authorization: Bearer <SETTINGS_TOKEN>` when a settings token is configured.
