# TRMNL Home Assistant Layout

A Home Assistant compatible add-on and standalone Docker app that renders Home Assistant sensor data into a precisely positioned 800x480 TRMNL frame for the Seeed Studio TRMNL 7.5-inch OG DIY Kit. It avoids dashboard screenshots and markdown spacing by rendering configurable SVG/HTML from sensor state and attributes.

## Features

- Home Assistant REST API client using `HOME_ASSISTANT_URL` plus `ACCESS_TOKEN` or `HA_TOKEN`.
- YAML layout file with explicit `x`, `y`, `width`, `height`, `fontSize`, `align`, and related positioning controls.
- Default Sleep + Weather dashboard for the Seeed Studio TRMNL 7.5-inch OG DIY Kit, 800x480.
- Pull endpoints for Terminus or browsers: `/screen.png`, `/screen.svg`, `/render`, `/preview`.
- Browser layout editor at `/editor` with drag, resize, style controls, and YAML save through `/api/config`.
- Push endpoint/job for Terminus BYOS Hanami/JWT `/api/screens` or generic PNG webhooks.
- Refresh scheduling through `REFRESH_INTERVAL_SECONDS`.

## Standalone quick start

```bash
cd trmnl-ha-layout
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:10000/preview` or edit the layout at `http://localhost:10000/editor`.

## Home Assistant add-on

Add this repository to Home Assistant, install **TRMNL HA Layout**, configure the add-on options, and mount/edit `/data/layout.yaml` if you want custom positions.

## Important environment variables

- `HOME_ASSISTANT_URL`: Home Assistant base URL, for example `http://homeassistant:8123`.
- `ACCESS_TOKEN` or `HA_TOKEN`: Home Assistant long-lived token.
- `LAYOUT_PATH`: Optional path to YAML layout, default `/data/layout.yaml` when available, otherwise `./data/default-layout.yaml`.
- `PUBLIC_BASE_URL`: URL Terminus can use to fetch this service, for URI/content integrations.
- `TERMINUS_API_URL`: Terminus base URL, for example `http://terminus:2300`.
- `TERMINUS_LOGIN` / `TERMINUS_PASSWORD`: Optional Terminus login for JWT access.
- `TERMINUS_ACCESS_TOKEN` / `TERMINUS_REFRESH_TOKEN`: Optional manual Terminus JWT tokens.
- `TERMINUS_MODE`: `byos-uri` (default), `byos-base64`, `screen-content`, or `raw-webhook`.
- `TERMINUS_MODEL_ID`, `TERMINUS_SCREEN_NAME`, `TERMINUS_SCREEN_LABEL`, `TERMINUS_PLAYLIST_ID`: Screen metadata for BYOS pushes.
- `TERMINUS_WEBHOOK_URL`: Generic webhook endpoint for `raw-webhook` mode.
- `REFRESH_INTERVAL_SECONDS`: Optional periodic refresh/push interval.

## API

- `GET /health`: service status.
- `GET /screen.png`: renders the current dashboard as an 800x480 PNG.
- `GET /screen.svg`: renders the current dashboard as SVG.
- `GET /render`: wraps the SVG in HTML.
- `GET /preview`: minimal preview and refresh UI.
- `GET /editor`: browser layout editor for the 800x480 frame.
- `POST /api/refresh`: fetches Home Assistant state and optionally pushes to Terminus/webhook.
- `GET /api/config`: returns resolved layout configuration.
- `PUT /api/config`: validates and saves layout YAML to the runtime layout path.
