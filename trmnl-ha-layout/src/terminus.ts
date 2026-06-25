import { getAddonOptions, stringOption } from './config.js'

export interface TerminusPushOptions {
  apiUrl?: string
  accessToken?: string
  refreshToken?: string
  login?: string
  password?: string
  mode?: 'screen-content' | 'byos-uri' | 'byos-base64' | 'raw-webhook'
  publicBaseUrl?: string
  webhookUrl?: string
  modelId?: string
  screenName?: string
  screenLabel?: string
  playlistId?: string
  screenId?: string
}

export class TerminusClient {
  constructor(private fetcher: typeof fetch = fetch) {}

  async push(png: Buffer, options: TerminusPushOptions, svg = ''): Promise<string> {
    const mode = options.mode ?? 'byos-uri'
    if (mode === 'raw-webhook') return this.pushRaw(png, options)
    if (!options.apiUrl) return 'skipped: Terminus API URL not configured'
    const accessToken = await this.resolveAccessToken(options)
    if (!accessToken) return 'skipped: Terminus credentials not configured'
    options.accessToken = accessToken
    if (mode === 'byos-uri') return this.pushUri(options)
    if (mode === 'byos-base64') return this.pushBase64(png, options)
    return this.pushContent(svg, options)
  }

  private async pushContent(svg: string, options: TerminusPushOptions): Promise<string> {
    const content = `<html><body style="margin:0">${svg}</body></html>`
    return this.postScreen(options, { content, file_name: this.fileName(options) })
  }

  private async pushUri(options: TerminusPushOptions): Promise<string> {
    if (!options.publicBaseUrl) return 'skipped: PUBLIC_BASE_URL is required for byos-uri mode'
    const uri = new URL('/screen.png', options.publicBaseUrl).toString()
    return this.postScreen(options, { uri, preprocessed: true, file_name: this.fileName(options) })
  }

  private async pushBase64(png: Buffer, options: TerminusPushOptions): Promise<string> {
    return this.postScreen(options, { data: png.toString('base64'), preprocessed: true, file_name: this.fileName(options) })
  }

  private async pushRaw(png: Buffer, options: TerminusPushOptions): Promise<string> {
    if (!options.webhookUrl) return 'skipped: TERMINUS_WEBHOOK_URL not configured'
    const response = await this.fetcher(options.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(png)
    })
    if (!response.ok) throw new Error(`Webhook push failed: ${response.status}`)
    return 'pushed raw webhook'
  }

  private async postScreen(options: TerminusPushOptions, payload: Record<string, unknown>, retried = false): Promise<string> {
    const screen: Record<string, unknown> = {
      model_id: options.modelId ?? '1',
      label: options.screenLabel ?? 'Home Assistant Layout',
      name: options.screenName ?? 'ha-layout',
      ...payload
    }
    if (options.playlistId) screen.playlist_id = options.playlistId
    const response = await this.fetcher(new URL('/api/screens', options.apiUrl).toString(), {
      method: 'POST',
      headers: { Authorization: this.authorizationHeader(options.accessToken ?? ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ screen })
    })
    if (response.status === 422 && !retried) {
      const deleted = await this.deleteDuplicateScreen(options)
      if (deleted) return this.postScreen(options, payload, true)
    }
    if (!response.ok) throw new Error(`Terminus screen push failed: ${response.status} ${await response.text()}`)
    return 'pushed Terminus screen'
  }

  async listPlaylists(options: TerminusPushOptions): Promise<unknown> {
    const response = await this.fetcher(new URL('/api/playlists', options.apiUrl).toString(), {
      headers: { Authorization: this.authorizationHeader(options.accessToken ?? '') }
    })
    if (!response.ok) throw new Error(`Terminus playlist list failed: ${response.status}`)
    return response.json() as Promise<unknown>
  }

  async patchPlaylist(options: TerminusPushOptions, playlistId: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetcher(new URL(`/api/playlists/${playlistId}`, options.apiUrl).toString(), {
      method: 'PATCH',
      headers: { Authorization: this.authorizationHeader(options.accessToken ?? ''), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) throw new Error(`Terminus playlist update failed: ${response.status}`)
    return response.json() as Promise<unknown>
  }

  private async resolveAccessToken(options: TerminusPushOptions): Promise<string | undefined> {
    if (options.accessToken && options.refreshToken) {
      const refreshed = await this.refreshAccessToken(options)
      if (refreshed) {
        options.accessToken = refreshed
        return refreshed
      }
    }
    if (options.accessToken) return options.accessToken
    if (!options.login || !options.password || !options.apiUrl) return undefined
    const response = await this.fetcher(new URL('/login', options.apiUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: options.login, password: options.password })
    })
    if (!response.ok) throw new Error(`Terminus login failed: ${response.status}`)
    const body = await response.json() as Record<string, unknown>
    const accessToken = tokenValue(body, ['access_token', 'token', 'jwt'])
    const refreshToken = tokenValue(body, ['refresh_token'])
    if (accessToken) options.accessToken = accessToken
    if (refreshToken) options.refreshToken = refreshToken
    return accessToken
  }

  private async refreshAccessToken(options: TerminusPushOptions): Promise<string | undefined> {
    if (!options.apiUrl || !options.accessToken || !options.refreshToken) return undefined
    const response = await this.fetcher(new URL('/api/jwt', options.apiUrl).toString(), {
      method: 'POST',
      headers: { Authorization: this.authorizationHeader(options.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: options.refreshToken })
    })
    if (!response.ok) return undefined
    const body = await response.json() as Record<string, unknown>
    return tokenValue(body, ['access_token', 'token', 'jwt'])
  }

  private async deleteDuplicateScreen(options: TerminusPushOptions): Promise<boolean> {
    if (!options.apiUrl || !options.accessToken) return false
    const listResponse = await this.fetcher(new URL('/api/screens', options.apiUrl).toString(), {
      headers: { Authorization: this.authorizationHeader(options.accessToken) }
    })
    if (!listResponse.ok) return false
    const body = await listResponse.json() as unknown
    const screens = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown[] }).data)
        ? (body as { data: unknown[] }).data
        : Array.isArray((body as { screens?: unknown[] }).screens)
          ? (body as { screens: unknown[] }).screens
          : []
    const targetName = options.screenName ?? 'ha-layout'
    const targetModel = String(options.modelId ?? '1')
    const duplicate = screens.map((screen) => screen as Record<string, unknown>).find((screen) => {
      if (options.screenId && String(screen.id) === options.screenId) return true
      return String(screen.name) === targetName && String(screen.model_id ?? screen.modelId ?? targetModel) === targetModel
    })
    if (!duplicate?.id) return false
    const deleteResponse = await this.fetcher(new URL(`/api/screens/${duplicate.id}`, options.apiUrl).toString(), {
      method: 'DELETE',
      headers: { Authorization: this.authorizationHeader(options.accessToken) }
    })
    return deleteResponse.ok
  }

  private authorizationHeader(token: string): string {
    if (!token) return ''
    return token
  }

  private fileName(options: TerminusPushOptions): string {
    return `${options.screenName ?? 'ha-layout'}.png`
  }
}

function tokenValue(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export function terminusOptionsFromEnv(): TerminusPushOptions {
  const options = getAddonOptions()
  return {
    apiUrl: process.env.TERMINUS_API_URL ?? stringOption(options, 'terminus_api_url'),
    accessToken: process.env.TERMINUS_ACCESS_TOKEN ?? stringOption(options, 'terminus_access_token'),
    refreshToken: process.env.TERMINUS_REFRESH_TOKEN ?? stringOption(options, 'terminus_refresh_token'),
    login: process.env.TERMINUS_LOGIN ?? stringOption(options, 'terminus_login'),
    password: process.env.TERMINUS_PASSWORD ?? stringOption(options, 'terminus_password'),
    mode: (process.env.TERMINUS_MODE as TerminusPushOptions['mode']) ?? (stringOption(options, 'terminus_mode') as TerminusPushOptions['mode']) ?? 'byos-uri',
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? stringOption(options, 'public_base_url'),
    webhookUrl: process.env.TERMINUS_WEBHOOK_URL ?? stringOption(options, 'terminus_webhook_url'),
    modelId: process.env.TERMINUS_MODEL_ID ?? stringOption(options, 'terminus_model_id'),
    screenName: process.env.TERMINUS_SCREEN_NAME ?? stringOption(options, 'terminus_screen_name'),
    screenLabel: process.env.TERMINUS_SCREEN_LABEL ?? stringOption(options, 'terminus_screen_label'),
    playlistId: process.env.TERMINUS_PLAYLIST_ID ?? stringOption(options, 'terminus_playlist_id'),
    screenId: process.env.TERMINUS_SCREEN_ID ?? stringOption(options, 'terminus_screen_id')
  }
}
