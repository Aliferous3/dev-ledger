import { put, get } from '@vercel/blob'
import fs from 'node:fs/promises'
import { SNAPSHOT_BLOB } from './config.mjs'

const hasBlobReadToken = () =>
  !!process.env.BLOB_READ_WRITE_TOKEN ||
  !!(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)

const hasBlobWriteToken = () => !!process.env.BLOB_READ_WRITE_TOKEN

export async function writeSnapshot(json){
  const text = JSON.stringify(json)
  if (hasBlobWriteToken()) {
    await put(SNAPSHOT_BLOB, text, { access: 'private', contentType: 'application/json' })
    return { destination: 'vercel-blob', pathname: SNAPSHOT_BLOB }
  }
  await fs.writeFile(SNAPSHOT_BLOB, text, 'utf8')
  return { destination: 'local-file', path: SNAPSHOT_BLOB }
}

export async function readSnapshot(){
  if (hasBlobReadToken()) {
    const { stream } = await get(SNAPSHOT_BLOB, { access: 'private', useCache: false })
    const reader = stream.getReader()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const total = chunks.reduce((a, c) => a + c.length, 0)
    const buf = new Uint8Array(total)
    let o = 0
    for (const c of chunks) { buf.set(c, o); o += c.length }
    const text = new TextDecoder().decode(buf)
    return JSON.parse(text)
  }
  const text = await fs.readFile(SNAPSHOT_BLOB, 'utf8')
  return JSON.parse(text)
}
