import { handleVercel } from '../lib/api-handlers.mjs'

export default async function handler(req, res) {
  await handleVercel(req, res)
}
