import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT } from './lib/config.mjs'
import { handleHealth, handleLocal, handleGithub, handleVercel } from './lib/api-handlers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.get('/api/health', (req, res) => handleHealth(req, res))
app.get('/api/local', (req, res) => handleLocal(req, res))
app.get('/api/github', (req, res) => handleGithub(req, res))
app.get('/api/vercel', (req, res) => handleVercel(req, res))

app.use(express.static(path.join(__dirname, 'dist')))
app.use((req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))
app.listen(PORT, '127.0.0.1', () => console.log(`Developer Dashboard v1.3: http://localhost:${PORT}`))
