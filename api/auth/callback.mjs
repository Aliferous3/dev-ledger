import { waitUntil } from '@vercel/functions'
import { getSession, getUserOctokit, getAppOctokit, configureSessionPersistence } from '../../lib/auth.mjs'
import { github, appUrl, sessionLeaseMs } from '../../lib/config.mjs'
import { supabase } from '../../lib/db.mjs'
import { kickSync, runSync, setUserSync, SYNC_DETAIL_INIT } from '../../lib/sync.mjs'
import { createAuthSession, gcAuthSessions, isSessionLive } from '../../lib/sessions.mjs'
import { desktopHandoff, isDesktopFlowId, isDesktopChallenge } from '../../lib/desktop-auth.mjs'
import { requestQuery } from '../../lib/request-query.mjs'
import { securityEvent } from '../../lib/security-events.mjs'

export default async function handler(req, res) {
  const { code, state, installation_id: installationId, setup_action: setupAction } = requestQuery(req)
  const session = await getSession(req, res)

  // GitHub App setup redirect (post-install/update) carries installation_id
  // and a fresh code, but no OAuth state. With an existing session, link the
  // installation directly; without one, restart login so OAuth completes.
  if (installationId && setupAction) {
    if (!session.userId || (supabase && !(await isSessionLive(session.sid)))) {
      // Carry a pending desktop flow through the restarted login so the
      // handoff still returns to the app after re-auth.
      const flow = isDesktopFlowId(session?.desktopFlow) && isDesktopChallenge(session?.desktopChallenge)
        ? `?desktop_flow=${encodeURIComponent(session.desktopFlow)}&desktop_challenge=${encodeURIComponent(session.desktopChallenge)}`
        : ''
      res.writeHead(302, { Location: `/api/auth/login${flow}` })
      res.end()
      return
    }
    if (supabase) {
      const appOctokit = await getAppOctokit().catch(() => null)
      const { data: inst } = appOctokit
        ? await appOctokit.rest.apps.getInstallation({ installation_id: Number(installationId) }).catch(() => ({ data: null }))
        : { data: null }
      // Attacker-controllable query param: link only when the installation's
      // target account IS the signed-in user. Org installs are linked by the
      // OAuth discovery path below (GitHub verifies against the user token).
      if (inst?.account?.id === session.githubUserId) {
        await supabase.from('github_installations').upsert({
          user_id: session.userId,
          installation_id: inst.id,
          account_id: inst.account?.id,
          account_login: inst.account?.login,
          account_type: inst.account?.type,
        }, { onConflict: 'user_id,installation_id' })
        // Kick a real first slice — a bare 'syncing' marker with no worker
        // leaves a wedged claim (and stale progress/detail) behind.
        await kickSync(session.userId)
        waitUntil(runSync(session.userId, { budgetMs: 45_000, force: true }).catch(() => {}))
      }
    }
    if (await desktopHandoff(res, session, '/')) return
    res.writeHead(302, { Location: '/' })
    res.end()
    return
  }

  // A system browser can have both a website and a desktop OAuth attempt
  // pending. Validate this callback against ITS OWN sealed-session record,
  // never simply the most recent attempt. Legacy state is accepted only
  // for a valid, unexpired callback created before this rollout.
  const attempts = Array.isArray(session.oauthAttempts) ? session.oauthAttempts : []
  const attempt = attempts.find((entry) => entry && entry.state === state)
  let stateOk = false
  let oauthAgeSeconds = null
  // Repeated query parameters arrive as arrays. Never coerce a list of
  // GitHub codes into a comma-joined string during the token exchange.
  // Do not log either the code or its state.
  const singleCode = typeof code === 'string' && code.length > 0 && code.length <= 512
  const singleState = typeof state === 'string' && state.length > 0
  if (singleCode && singleState && (attempt || state === session.oauthState)) {
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
      stateOk = Number.isFinite(parsed.at)
        && Date.now() - parsed.at >= 0
        && Date.now() - parsed.at < 15 * 60 * 1000
      if (stateOk) oauthAgeSeconds = Math.floor((Date.now() - parsed.at) / 1000)
    } catch {
      stateOk = false
    }
  }
  if (!singleCode || !singleState) {
    console.warn('github oauth callback query cardinality invalid: code_count=%d state_count=%d',
      Array.isArray(code) ? code.length : code === undefined ? 0 : 1,
      Array.isArray(state) ? state.length : state === undefined ? 0 : 1)
  }
  if (!stateOk) {
    securityEvent('auth_callback_failed', { req, reasonCode: 'state_mismatch' })
    res.status(400).json({ error: 'Invalid OAuth state' })
    return
  }
  if (attempt) {
    // A desktop login never hijacks a normal browser login and vice versa.
    // Both variants retain CSRF state checking and the desktop PKCE binding.
    session.oauthAttempts = attempts.filter((entry) => entry?.state !== state)
    session.remember = attempt.remember === true
    delete session.desktopFlow
    delete session.desktopChallenge
    if (isDesktopFlowId(attempt.desktopFlow) && isDesktopChallenge(attempt.desktopChallenge)) {
      session.desktopFlow = attempt.desktopFlow
      session.desktopChallenge = attempt.desktopChallenge
    }
  }
  if (session.oauthState === state) delete session.oauthState

  // This attempt's preference can differ from the last login initiated
  // in this browser. Reconfigure the outgoing cookie for the matching flow.
  session.persistent = session.remember === true
  delete session.remember
  configureSessionPersistence(session, session.persistent)
  // Non-persistent sessions get the sliding inactivity lease; remembered
  // sessions keep their ~30-day lifetime with no short lease.
  if (!session.persistent && sessionLeaseMs > 0) {
    session.leaseUntil = Date.now() + sessionLeaseMs
  }

  const redirectUri = `${appUrl}/api/auth/callback`
  // GitHub's documented web-application flow sends URL-encoded form fields.
  // Keep redirect_uri identical to the authorization request, and never put
  // the short-lived OAuth code or client secret in a URL or diagnostic log.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  })
  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenData?.access_token) {
    // Only one Set-Cookie header per callback: the successful path saves
    // after creating its session. A failed exchange still consumes state
    // in the browser cookie, preventing a refresh from retrying the code.
    await session.save()
    console.error(
      'github token exchange failed: http=%d error=%s desc=%s flow=%s oauth_age_sec=%d',
      tokenRes.status,
      tokenData?.error,
      tokenData?.error_description,
      session.desktopFlow ? 'desktop' : 'web',
      oauthAgeSeconds
    )
    securityEvent('auth_callback_failed', { req, reasonCode: 'token_exchange' })
    res.status(400).json({ error: 'GitHub token exchange failed' })
    return
  }

  const userOctokit = getUserOctokit(tokenData.access_token)
  const { data: user } = await userOctokit.rest.users.getAuthenticated()

  let installations = []
  if (supabase) {
    const { data: dbUser, error } = await supabase
      .from('users')
      .upsert({
        github_user_id: user.id,
        github_login: user.login,
        github_node_id: user.node_id,
        avatar_url: user.avatar_url,
        display_name: user.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'github_user_id' })
      .select()
      .single()
    if (error) {
      await session.save()
      securityEvent('auth_callback_failed', { req, reasonCode: 'user_upsert' })
      res.status(500).json({ error: 'Database error' })
      return
    }
    session.userId = dbUser.id
    session.githubUserId = user.id
    session.githubLogin = user.login
    // Server-side session record — revocation (logout / delete / kill-all)
    // kills this sid and the sealed cookie dies with it.
    session.sid = await createAuthSession(dbUser.id, { persistent: session.persistent === true })
    await session.save()
    waitUntil(gcAuthSessions().catch(() => {}))

    // Discover every installation of this app accessible to the user token.
    const { data: discovered } = await userOctokit.rest.apps
      .listInstallationsForAuthenticatedUser({ per_page: 100 })
      .catch(() => ({ data: { installations: [] } }))
    installations = discovered?.installations || []

    // A query-param installation_id is only honored when GitHub itself
    // reports it as accessible to this user token — never trust the raw
    // param, it would let a caller graft a foreign installation onto their
    // tenant.
    if (installationId) {
      const inst = installations.find((i) => i.id === Number(installationId))
      if (inst) {
        await supabase.from('github_installations').upsert({
          user_id: dbUser.id,
          installation_id: inst.id,
          account_id: inst.account?.id,
          account_login: inst.account?.login,
          account_type: inst.account?.type,
        }, { onConflict: 'user_id,installation_id' })
      }
    }
    for (const inst of installations) {
      await supabase.from('github_installations').upsert({
        user_id: dbUser.id,
        installation_id: inst.id,
        account_id: inst.account?.id,
        account_login: inst.account?.login,
        account_type: inst.account?.type,
      }, { onConflict: 'user_id,installation_id' })
    }

    if (installations.length) {
      // Kick a real first slice — the 'syncing' claim is backed by a worker.
      await kickSync(dbUser.id)
      waitUntil(runSync(dbUser.id, { budgetMs: 45_000, force: true }).catch(() => {}))
    } else {
      await setUserSync(dbUser.id, { status: 'needs_install', phase: 'discover', progress: 0, detail: SYNC_DETAIL_INIT })
    }
  } else {
    session.userId = String(user.id)
    session.githubUserId = user.id
    session.githubLogin = user.login
    // No database → no auth_sessions table; cookie-only session (dev).
    session.sid = null
    await session.save()
  }

  // No installation yet → send the user through the GitHub App install flow
  // (all or selected repositories), which returns via the app Setup URL.
  // session.desktopFlow intentionally survives this hop — /api/setup
  // completes the deep-link handoff once the install lands.
  if (!installations.length && github.appSlug) {
    res.writeHead(302, { Location: `https://github.com/apps/${github.appSlug}/installations/new` })
    res.end()
    return
  }

  if (await desktopHandoff(res, session, '/')) return
  res.writeHead(302, { Location: '/' })
  res.end()
}
