# TRMNL Home Assistant Layout

A Home Assistant compatible add-on and standalone Docker app that renders Home Assistant sensor data into a precisely positioned 800x480 TRMNL frame for the Seeed Studio TRMNL 7.5-inch OG DIY Kit. It avoids dashboard screenshots and markdown spacing by rendering configurable SVG/HTML from sensor state and attributes.

## Features

- Home Assistant REST API client configured from the editor settings UI, Home Assistant add-on options, or environment variables.
- YAML layout file with explicit `x`, `y`, `width`, `height`, `fontSize`, `align`, and related positioning controls.
- Default Sleep + Weather dashboard for the Seeed Studio TRMNL 7.5-inch OG DIY Kit, 800x480.
- Pull endpoints for Terminus or browsers: `/screen.png`, `/screen.svg`, `/render`, `/preview`.
- Browser layout editor at `/` and `/editor` with drag, resize, style controls, connection settings, and YAML save through `/api/config`.
- Optional local Figma plugin workflow for designing the same 800x480 frame and saving exported widgets through `/api/figma/layout`.
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

Then open `http://localhost:10000/editor` to edit the layout and save Connection Settings. The `/data` mount persists both `layout.yaml` and GUI-saved `settings.json` across container upgrades.

Use a Home Assistant URL reachable from inside the container. A LAN IP, such as `http://192.168.1.50:8123`, is usually more reliable than `homeassistant.local` or `localhost` in Docker.

The image runs with `NODE_ENV=production`, so protected endpoints are blocked unless you choose one auth mode:

- Trusted LAN/dev use: set `ALLOW_NO_AUTH="1"` as shown above.
- Token-protected use: remove `ALLOW_NO_AUTH`, set `SETTINGS_TOKEN="replace_with_editor_token"`, and open `http://localhost:10000/editor?token=replace_with_editor_token` once so the browser stores the token.

### Optional Terminus environment configuration

Terminus settings can usually be saved in the editor instead of Compose. Use environment variables when you want container-managed configuration:

- `TERMINUS_API_URL`: Terminus base URL reachable from the dashboard container when using Terminus push modes.
- `TERMINUS_MODE`: `byos-uri` (default), `byos-base64`, `screen-content`, or `raw-webhook`.
- `ADDON_BASE_URL`: Required only for `byos-uri`; this is the URL Terminus can use to fetch this dashboard's `/screen.png`.
- `REFRESH_INTERVAL_SECONDS`: Optional periodic refresh/push interval.
- `SETTINGS_TOKEN`: Required for Figma entity loading and optional bearer protection for layout, settings, refresh, other Figma bridge, and Terminus auth requests; open `/editor?token=<token>` once so the browser stores it for the editor.

Environment variables have highest precedence, then Home Assistant add-on options, then `/data/settings.json`, then defaults.

`TERMINUS_API_URL` must be the Terminus base URL, for example `http://192.168.1.50:2300`. Do not include `/api/screens`; the app appends `/login`, `/api/screens`, and `/api/jwt` itself.

`GET /api/settings` returns GUI-saved settings from `/data/settings.json` with secrets masked. It does not show environment variable overrides, even though those env values are active at runtime.

Add-on URL examples for `byos-uri`:

- Same Docker Desktop host: set `ADDON_BASE_URL=http://host.docker.internal:10000` so a Terminus container can call back to the dashboard through the host port mapping.
- Same LAN: set `ADDON_BASE_URL=http://<host-lan-ip>:10000`, for example `http://192.168.1.50:10000`, and make sure the host firewall allows the port.
- Behind a reverse proxy: set `ADDON_BASE_URL=https://trmnl-ha.example.com` and route that host to the dashboard container's port `10000`.

`localhost` is usually wrong for Add-on URL from inside the Terminus container. From Terminus, `localhost` means the Terminus container itself, not this dashboard. Use `host.docker.internal` on Docker Desktop, a LAN IP/hostname, or a reverse-proxy URL that Terminus can reach.

## Configuration and settings

The editor's **Connection Settings** panel saves runtime settings to `settings.json` next to the layout file. With the default add-on layout path this is `/data/settings.json`; with a custom `LAYOUT_PATH` it is `settings.json` in the same directory as that layout; in standalone development it is `./settings.json`.

Configuration precedence is environment variables first, then Home Assistant add-on options from `/data/options.json`, then GUI-saved `settings.json`, then defaults. Refreshes re-read connection and Terminus settings before each push, so those GUI settings changes do not require a restart; changing `refresh_interval_seconds` affects scheduling after restart.

Set `SETTINGS_TOKEN` or the add-on `settings_token` option before loading entities through the local Figma bridge. The same token can protect layout/settings mutations and other bridge requests. Open `/editor?token=<token>` once; the editor stores it in session storage and sends `Authorization: Bearer <token>` for layout saves, settings saves, refreshes, and Terminus auth actions. The Figma plugin has its own **Dashboard Token** field for bridge calls. If no token is configured, entity loading is denied while mutations are allowed with a warning for development; set `ALLOW_NO_AUTH=1` only to silence that warning in local/dev use.

### Layout and rendering model

The dashboard renders from a YAML layout file, normally `trmnl-ha-layout/data/default-layout.yaml` in local development or `/data/layout.yaml` in the Home Assistant add-on/container. `trmnl-ha-layout/src/config.ts` resolves, validates, loads, and atomically saves this file.

The layout schema is intentionally small:

- `frame`: 800x480 screen metadata with `background`, `foreground`, and `fontFamily`.
- `data.entities`: a map of local source keys to Home Assistant entity IDs, for example `kitchenTemperature: sensor.kitchen_temperature`.
- `items`: positioned rendering blocks. Supported item types are `text`, `metric`, `forecast`, and `line`.

`text` and `metric` items can interpolate entity source keys with `{{ key }}` and safe formatter filters such as `{{ minutesAsleep | minutes }}`. The `minutes` preset converts an integer minute value such as `417` to `6h 57m`; `time` and `date` presets are also available. Optional `data.selectors` entries choose a sanitized state/attribute path for a source, for example `weatherTemperature: attributes.forecast.0.temperature`. Selectors are bounded to the bridge's exported attribute depth and first eight array entries. Layouts without selectors continue to use the entity state exactly as before. Text items wrap at approximate character boundaries and are clipped to their configured width and height. `/screen.svg`, `/screen.png`, `/render`, and `/preview` all use the same renderer in `trmnl-ha-layout/src/render.ts`. `/screen.*?sample=1` and `/render?sample=1` use sample data instead of live Home Assistant data.

The Figma workflow exports into this existing schema. It does not introduce a second layout format: Figma text becomes bounded, wrapping `text` items, Figma cards become `metric` items, and bound Home Assistant entity IDs become `data.entities` entries. Sanitized entity units are preserved in exported value templates.

## Figma Plugin Workflow

The local-development plugin lives in `figma-plugin/` and is named **TRMNL Home Assistant Designer**. It is additive; the built-in `/editor` workflow and TRMNL screen push/update behavior remain available.

### Run the dashboard backend

```bash
cd trmnl-ha-layout
npm install
npm run dev
```

Open `http://localhost:10000/preview` to confirm the backend is running. Configure Home Assistant URL and token in `/editor` if you want live entities. Without a Home Assistant token, the Figma entity bridge returns sample entities from the current layout.

### Build and load the plugin

```bash
cd figma-plugin
npm install
npm run build
```

In Figma Desktop, choose **Plugins -> Development -> Import plugin from manifest**, then select `figma-plugin/manifest.json`.

The manifest allows `http://localhost:10000` under `networkAccess.devAllowedDomains`; local/development servers should not be placed in `allowedDomains`. Figma rejects some loopback and numeric-IP patterns during manifest import, so use `localhost` for same-machine testing. If the dashboard backend runs on another LAN host, edit `figma-plugin/manifest.json` before importing and add the exact hostname origin, for example `http://raspberrypi.local:10000`, to `networkAccess.devAllowedDomains`. Figma's plugin network-access model requires explicit development domains; published plugins cannot generally allow arbitrary private LAN hosts without review constraints, so this plugin is intended for local development/import.

### Design and export

1. Run **TRMNL Home Assistant Designer** from Figma's development plugins menu.
2. Set **Backend URL**, defaulting to `http://localhost:10000`, and click **Save**. The value is persisted in Figma `clientStorage`.
3. Configure `SETTINGS_TOKEN` or the add-on `settings_token`, enter the same value in **Dashboard Token**, and click **Save**. Loading entity data always requires this configured token, including local development.
4. Click **Create 800x480 TRMNL Frame** to create a white 800x480 e-ink-friendly frame.
5. Click **Load** to call `GET {backendUrl}/api/figma/entities`. The status says whether the result is **live** Home Assistant data or **sample** fallback data. The plugin receives only sanitized entity metadata and bounded primitive state/attribute values; credential-like attributes and secret-like entities are omitted, and Home Assistant credentials are never returned.
6. In an entity row, choose **Value**. `State` uses the normal entity state. Attribute-rich entities expose paths such as `forecast.0.temperature`, `forecast.0.condition`, or other sanitized primitive attributes. Forecast arrays expose the first eight entries where feasible.
7. Choose **Format**: `Raw`, `Minutes → hours/minutes`, `Time`, or `Date`. For `sensor.google_health_sleep_latest_minutes_asleep`, select `State` plus `Minutes → hours/minutes` to preview and save `417` as `6h 57m`.
8. Use **Insert Text** for a bound text node such as `Living Room Temperature: 72.4°F`.
9. Use **Insert Card** for a simple grayscale metric card with label and large value.
10. Move and resize the Figma nodes inside the 800x480 frame.
11. Select the frame, or a bound node inside it, then click **Refresh Selected** to refetch entities and update the selected state/attribute value using its saved format. User-edited text and card labels are preserved.
12. Click **Export Selected Frame**. The plugin traverses visible supported nodes, skips its guide label, converts bindings to `data.entities`, optional `data.selectors`, and safe formatter templates, shows the generated JSON, and reports warnings for unsupported or out-of-frame nodes.
13. Click **Save to Dashboard** to freshly export the current frame and call `PUT {backendUrl}/api/figma/layout`. Empty or warning-bearing exports require confirmation before replacing the dashboard. The backend validates the 800x480 layout and saves only the layout sections (`frame`, `data.entities`, optional `data.selectors`, and `items`) into the existing YAML config.
14. Click **Open Preview** or open `{backendUrl}/preview` to review the rendered dashboard. `/screen.png` and `/screen.svg` will reflect the saved layout.

Loading Figma entities always requires a configured `SETTINGS_TOKEN` and the matching dashboard token in the plugin. Previewing exports and saving from the cross-origin Figma plugin require the same token; the no-token development fallback does not expose entity data.

### Figma workflow limitations

- The plugin talks only to this dashboard bridge. It is not intended to store Home Assistant credentials, and `/api/figma/entities` never returns tokens or sensitive settings.
- Figma plugin network access and CORS can block LAN hosts unless the exact origin is listed in `manifest.json` before import.
- Only visible text nodes and unmodified plugin-created metric card frames export cleanly. Hidden content and the generated guide label are omitted; extra visible card children, justified text, unsupported bound nodes, text strokes/effects, over-limit labels/static text, and content clipped by ancestors produce warnings and are skipped.
- Rotated, skewed, scaled, or flipped frames/nodes cannot be represented by the YAML schema and are rejected or skipped during export.
- The TRMNL screen is black/white/grayscale e-ink; avoid color-dependent designs and tiny typography.
- Figma plugins do not run in the background. Use **Refresh Selected** after changing Home Assistant state or reloading entities.
- Preview embedding can be unreliable across local network/CORS boundaries; the plugin opens `{backendUrl}/preview` instead of depending on an embedded image.

### Manual Figma checklist

- Start the backend with `npm run dev` in `trmnl-ha-layout/`.
- Open `http://localhost:10000/preview` and verify sample rendering works.
- Build the plugin with `npm run build` in `figma-plugin/`.
- Import `figma-plugin/manifest.json` in Figma Desktop development plugins.
- Configure `SETTINGS_TOKEN` and save the same value in **Dashboard Token** before loading entities or saving the dashboard.
- Create an 800x480 TRMNL frame.
- Load entities and verify no Home Assistant token appears in plugin output, plugin data, browser console, or exported JSON.
- Verify the status identifies the entity source as `live` or `sample`. If it says `sample`, configure `HOME_ASSISTANT_URL` and `ACCESS_TOKEN` (or save the HA token in `/editor`) before testing actual attributes.
- For a minute sensor, choose `State` and `Minutes → hours/minutes`; verify `417` previews and renders as `6h 57m`.
- For an attribute-rich weather sensor, choose a path such as `forecast.0.temperature` or `forecast.0.condition` and verify the selected attribute is used instead of the raw `forecast` state string.
- Insert text and card elements for an entity.
- Move and resize inserted elements inside the frame.
- Refresh selected bound elements after reloading entities.
- Edit a bound text or card label, refresh it, and verify the custom label remains unchanged.
- Export the selected frame and review warnings; verify the generated guide label and hidden nodes are absent.
- Save to dashboard.
- Open `/preview`, `/screen.png`, and `/screen.svg` and verify the saved layout renders.

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
- `SETTINGS_TOKEN`: Bearer token required for Figma entity loading and optional protection for layout, settings, refresh, other Figma bridge, and Terminus auth requests.
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
- `GET /api/figma/entities`: returns `{ source: "live" | "sample", entities }` for the local Figma plugin. Each entity includes sanitized primitive state/attribute value paths; credential-like attribute keys, secret-like entities, and Home Assistant credentials are omitted. Results are capped at 1,000 entities and 5,000 total values. It always requires a configured `SETTINGS_TOKEN` and matching `Authorization: Bearer <SETTINGS_TOKEN>` header.
- `POST /api/figma/preview-layout`: validates a Figma-exported layout and returns sample-rendered SVG plus normalized config for plugin preview/debug use. It requires `Authorization: Bearer <SETTINGS_TOKEN>` when a settings token is configured.
- `PUT /api/figma/layout`: accepts `{ width: 800, height: 480, widgets }`, validates supported `text` and `metric_card` widgets and their in-frame geometry, then replaces `data.entities` and `items` in the existing YAML layout while preserving the other layout settings.
- `GET /api/settings`: returns GUI settings with tokens masked.
- `PUT /api/settings`: validates and saves GUI settings, preserving already-masked stored tokens.
- `POST /api/terminus/login`: exchanges a Terminus API URL, login, and password for stored JWT tokens.
- `POST /api/terminus/refresh`: refreshes stored Terminus JWT tokens.
- `DELETE /api/terminus/tokens`: clears stored Terminus JWT tokens.

`GET /api/figma/entities` always requires a configured token. Other protected endpoints (`POST /api/figma/preview-layout`, `PUT /api/config`, `PUT /api/figma/layout`, `POST /api/refresh`, `PUT /api/settings`, and `/api/terminus/*`) require `Authorization: Bearer <SETTINGS_TOKEN>` when a settings token is configured.

The Figma plugin exports metric cards only when their container and bound label/value nodes still match the supported renderer template, including each part's canonical role-specific paint. Moving or resizing the card and editing its label or value binding are supported; visual, opacity, child-position, and typography changes are skipped with an export warning because the saved layout cannot represent them. Export requests are correlated so preview and save results cannot be confused.
