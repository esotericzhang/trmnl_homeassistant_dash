import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-test-'))
process.env.LAYOUT_PATH = path.join(tempRoot, 'layout.yaml')

process.on('exit', () => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})
