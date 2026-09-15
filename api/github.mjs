import { handleGithub } from '../lib/api-handlers.mjs'

export default async function handler(req, res) {
  await handleGithub(req, res)
}
