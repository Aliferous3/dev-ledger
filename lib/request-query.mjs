// Parse query parameters directly from IncomingMessage.url with the WHATWG
// URL API. Do not read Vercel's req.query helper here: older @vercel/node
// runtimes implement that lazy getter with deprecated node:url.parse(), which
// emits DEP0169 on access.
export function requestQuery(req) {
  const parsed = new URL(req?.url || '/', 'http://localhost')
  const query = {}

  for (const [key, value] of parsed.searchParams) {
    const existing = query[key]
    if (existing === undefined) query[key] = value
    else if (Array.isArray(existing)) query[key] = [...existing, value]
    else query[key] = [existing, value]
  }

  return query
}
