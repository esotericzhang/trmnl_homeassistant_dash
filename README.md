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

## Configuration and settings

The editor's **Connection Settings** panel saves runtime settings to `settings.json` next to the layout file. With the default add-on layout path this is `/data/settings.json`; with a custom `LAYOUT_PATH` it is `settings.json` in the same directory as that layout; in standalone development it is `./settings.json`.

Configuration precedence is environment variables first, then Home Assistant add-on options from `/data/options.json`, then GUI-saved `settings.json`, then defaults. Refreshes re-read connection and Terminus settings before each push, so those GUI settings changes do not require a restart; changing `refresh_interval_seconds` affects scheduling after restart.

Set `SETTINGS_TOKEN` or the add-on `settings_token` option to protect mutating endpoints. When a token is set, open `/editor?token=<token>` once; the editor stores it in session storage and sends `Authorization: Bearer <token>` for layout saves, settings saves, refreshes, and Terminus auth actions. If no token is configured, mutations are allowed with a warning for development; set `ALLOW_NO_AUTH=1` only to silence that warning in local/dev use.

## Important environment variables

- `HOME_ASSISTANT_URL`: Home Assistant base URL, for example `http://homeassistant:8123`.
- `ACCESS_TOKEN` or `HA_TOKEN`: Home Assistant long-lived token.
- `LAYOUT_PATH`: Optional path to YAML layout, default `/data/layout.yaml` when available, otherwise `./data/default-layout.yaml`.
- `PUBLIC_BASE_URL`: URL Terminus can use to fetch this service, for URI/content integrations.
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
