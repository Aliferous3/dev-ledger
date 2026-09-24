import crypto from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { github } from '../../lib/config.mjs'
import { supabase } from '../../lib/db.mjs'
import { kickSync, runSync, setUserSync } from '../../lib/sync.mjs'
import { securityEvent } from '../../lib/security-events.mjs'

export const config = { api: { bodyParser: false } }

async function rawBody(req) {
  // config.api.bodyParser=false keeps the stream raw on Vercel. If a runtime
  // already parsed the body, fall back to re-serializing it.
  if (req.body != null) {
    return Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function verifySignature(raw, signature) {
  if (!github.webhookSecret || !signature) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', github.webhookSecret).update(raw).digest('hex')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// GitHub App webhook receiver. Signature-verified, read-only intent: events
// only mark sync work pending or upsert event payload data — no writes back
// to GitHub ever happen here.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const raw = await rawBody(req)
  const signature = req.headers['x-hub-signature-256']
  if (!verifySignature(raw, signature)) {
    // A present-but-wrong HMAC is an attack signal; a missing one is more
    // likely a stray probe — distinguish, but record both.
    const reasonCode = !github.webhookSecret
      ? 'secret_unconfigured'
      : !signature ? 'signature_missing' : 'signature_mismatch'
    securityEvent('webhook_signature_invalid', { req, reasonCode })
    res.status(401).json({ error: 'Invalid signature' })
    return
  }
  const event = req.headers['x-github-event']
  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    res.status(400).json({ error: 'Invalid payload' })
    return
  }

  // Replay dedup: X-GitHub-Delivery is unique per send. Insert-first — the
  // primary key serializes concurrent duplicates; a conflict means this
  // exact delivery already ran, so acknowledge it as a no-op. GitHub does
  // not auto-redeliver failed deliveries; manual/API redelivery of the same
  // delivery id still resolves safely here. Signature verification stays primary — the
  // delivery id is only ever trusted AFTER a valid HMAC.
  const deliveryId = req.headers['x-github-delivery']
  if (supabase && deliveryId) {
    try {
      // bound the dedup table — 30-day retention, pruned opportunistically
      await supabase
        .from('webhook_deliveries')
        .delete()
        .lt('received_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      const { data: inserted } = await supabase
        .from('webhook_deliveries')
        .insert({ delivery_id: String(deliveryId), event: event || null }, { onConflict: 'delivery_id', ignoreDuplicates: true })
        .select('delivery_id')
      if (!inserted?.length) {
        securityEvent('webhook_replay_blocked', { req, sourceId: deliveryId })
        res.status(200).json({ ok: true, duplicate: true })
        return
      }
    } catch {
      // dedup store unavailable — process anyway; handlers are idempotent
    }
  }

  try {
    if (event === 'installation') {
      await onInstallation(payload)
    } else if (event === 'installation_repositories') {
      await onInstallationRepositories(payload)
    } else if (event === 'push') {
      await onPush(payload)
    } else if (event === 'pull_request') {
      await onPullRequest(payload)
    }
    res.status(200).json({ ok: true })
  } catch (err) {
    // Never leave a delivery marked processed when its durable work was
    // never written — drop the dedup row so a GitHub redelivery retries the
    // event instead of being swallowed as a duplicate forever.
    if (supabase && deliveryId) {
      try {
        await supabase.from('webhook_deliveries').delete().eq('delivery_id', String(deliveryId))
      } catch { /* dedup cleanup is best-effort */ }
    }
    res.status(500).json({ error: 'Webhook handling failed' })
  }
}

// Detached sync continuation — the durable 'syncing' marker (kickSync) is
// written BEFORE the webhook acknowledges, so if this waitUntil slice dies
// with the invocation the cron pump still finds status='syncing' and
// finishes the run. The catch is load-bearing: background sync failure must
// never reject after the response, and runSync's own status writes stay the
// authority on outcome.
function scheduleSync(userId) {
  try {
    waitUntil(runSync(userId, { budgetMs: 45_000, force: true }).catch(() => {}))
  } catch {
    /* outside a Vercel invocation the detached promise still runs */
  }
}

async function onInstallation(payload) {
  const inst = payload.installation
  if (!inst) return
  if (payload.action === 'deleted') {
    // Mark sync revoked but keep historical analytics until the user deletes
    // their account — the UI surfaces a "Reconnect GitHub" state. Repos under
    // this installation transition to disconnected (source 'github') so a
    // later reinstall cleanly reconnects them to their retained history.
    const { data: rows } = await supabase.from('github_installations').select('user_id').eq('installation_id', inst.id)
    await supabase.from('repositories')
      .update({ disconnected_at: new Date().toISOString(), disconnect_source: 'github' })
      .eq('installation_id', inst.id)
    await supabase.from('github_installations').delete().eq('installation_id', inst.id)
    for (const r of rows || []) {
      await setUserSync(r.user_id, { status: 'revoked', error: 'GitHub access was revoked' })
    }
    return
  }
  if (payload.action === 'created') {
    // Link to an existing user by GitHub account id when possible.
    const { data: user } = await supabase
      .from('users').select('id').eq('github_user_id', inst.account?.id).maybeSingle()
    if (user) {
      await supabase.from('github_installations').upsert({
        user_id: user.id,
        installation_id: inst.id,
        account_id: inst.account?.id,
        account_login: inst.account?.login,
        account_type: inst.account?.type,
      }, { onConflict: 'user_id,installation_id' })
      await kickSync(user.id)
      scheduleSync(user.id)
    }
  }
}

async function onInstallationRepositories(payload) {
  const installationId = payload.installation?.id
  if (!installationId) return
  const { data: link } = await supabase
    .from('github_installations').select('user_id').eq('installation_id', installationId).maybeSingle()
  if (!link) return

  const removed = (payload.repositories_removed || []).map((r) => r.id)
  if (removed.length) {
    // De-authorized on GitHub → disconnected, history retained. The user
    // can still choose DISCONNECT & DELETE explicitly later.
    await supabase.from('repositories')
      .update({ disconnected_at: new Date().toISOString(), disconnect_source: 'github' })
      .eq('user_id', link.user_id)
      .in('github_repo_id', removed)
  }
  if ((payload.repositories_added || []).length) {
    await kickSync(link.user_id)
    scheduleSync(link.user_id)
  }
}

// Resolve the owning tenant through the installation id — github_repo_id
// alone is NOT unique per tenant (two Dev Ledger users can track the same
// public repo), so an unscoped lookup could attribute work cross-tenant.
async function repoForInstallationRepo(payload) {
  const repoId = payload.repository?.id
  const installationId = payload.installation?.id
  if (!repoId || !installationId) return null
  const { data: link } = await supabase
    .from('github_installations').select('user_id').eq('installation_id', installationId).maybeSingle()
  if (!link) return null
  const { data: repo } = await supabase
    .from('repositories')
    .select('id, user_id, disconnected_at')
    .eq('user_id', link.user_id)
    .eq('github_repo_id', repoId)
    .maybeSingle()
  return repo
}

async function onPush(payload) {
  const repo = await repoForInstallationRepo(payload)
  if (!repo || repo.disconnected_at) return // unknown, foreign, or retained
  // Mark the repo for incremental commit sync — only commits GitHub
  // attributes to the user are ingested, so pushes by others cost little.
  await supabase.from('repo_sync')
    .upsert({ user_id: repo.user_id, repository_id: repo.id, phase: 'done' }, { onConflict: 'user_id,repository_id' })
  await kickSync(repo.user_id, 'commits')
  scheduleSync(repo.user_id)
}

async function onPullRequest(payload) {
  const pr = payload.pull_request
  if (!pr) return
  const repo = await repoForInstallationRepo(payload)
  if (!repo || repo.disconnected_at) return // unknown, foreign, or retained
  const { data: user } = await supabase
    .from('users').select('github_user_id').eq('id', repo.user_id).single()
  if (!user || pr.user?.id !== user.github_user_id) return // not the user's PR
  await supabase.from('pull_requests').upsert({
    user_id: repo.user_id,
    repository_id: repo.id,
    github_pr_id: pr.id,
    number: pr.number,
    author_user_id: pr.user.id,
    author_login: pr.user.login,
    state: pr.merged_at ? 'merged' : pr.state,
    created_at: pr.created_at,
    closed_at: pr.closed_at,
    merged_at: pr.merged_at,
    // No pr.title — 008_data_minimization dropped the column; PR titles are
    // user-authored text Dev Ledger deliberately does not persist.
  }, { onConflict: 'user_id,github_pr_id' })
}
