import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { app } from '../src/server.js'

describe('server routes', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('expected TCP address')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('serves PNG output and editor UI', async () => {
    const png = await fetch(`${baseUrl}/screen.png?sample=1`)
    expect(png.headers.get('content-type')).toContain('image/png')
    const bytes = new Uint8Array(await png.arrayBuffer())
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    const editor = await fetch(`${baseUrl}/editor`)
    const editorHtml = await editor.text()
    expect(editorHtml).toContain('TRMNL Layout Editor')
    expect(editorHtml).toContain('id="preview-frame"')
    expect(editorHtml).toContain('src="/screen.svg?sample=1"')
    expect(editorHtml).toContain('id="overlay"')
  })
})
