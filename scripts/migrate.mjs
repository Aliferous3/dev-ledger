import fs from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const sql = postgres(url)

async function run() {
  const dir = path.join(process.cwd(), 'migrations')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), 'utf8')
    await sql.unsafe(text)
    console.log('migrated:', f)
  }
  await sql.end()
}

run().catch((e) => {
  console.error('Migration failed:', e.message)
  process.exit(1)
})
