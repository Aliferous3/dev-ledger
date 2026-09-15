import { handleHealth } from '../lib/api-handlers.mjs'

export default async function handler(req, res) {
  await handleHealth(req, res)
}
