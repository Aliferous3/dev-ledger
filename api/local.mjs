import { handleLocal } from '../lib/api-handlers.mjs'

export default async function handler(req, res) {
  await handleLocal(req, res)
}
