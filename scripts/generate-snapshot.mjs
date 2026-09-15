import { buildSnapshot } from '../lib/snapshot.mjs'
import fs from 'node:fs/promises'

const data = await buildSnapshot()
await fs.writeFile('dev-ledger-snapshot.json', JSON.stringify(data, null, 2))
console.log('generated:', data.generatedAt)
console.log('repositories:', data.local?.summary?.repos || 0)
console.log('destination: dev-ledger-snapshot.json')
