import { buildSnapshot } from '../lib/snapshot.mjs'
import { writeSnapshot } from '../lib/storage.mjs'

const data = await buildSnapshot()
const { destination, pathname } = await writeSnapshot(data)
console.log('generated:', data.generatedAt)
console.log('repositories:', data.local?.summary?.repos || 0)
console.log('destination:', destination, pathname || '')
