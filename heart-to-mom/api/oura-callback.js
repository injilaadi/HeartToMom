import {
  assertOuraConfig,
  exchangeCodeForToken,
  getBaseUrl,
  getRedirectUri,
  getServiceClient,
  saveOuraConnection,
  syncOuraVitals,
  verifyOAuthState,
} from '../server/oura.js'

export default async function handler(req, res) {
  const appUrl = getBaseUrl(req)

  try {
    assertOuraConfig({ requireServiceRole: true })

    const { code, state, error, error_description: errorDescription } = req.query ?? {}
    if (error) {
      return redirect(res, appUrl, 'error', errorDescription || error)
    }
    if (!code || !state) {
      return redirect(res, appUrl, 'error', 'Missing Oura authorization code.')
    }

    const parsedState = verifyOAuthState(state)
    const token = await exchangeCodeForToken({ code, redirectUri: getRedirectUri(req) })
    const supabase = getServiceClient()

    await saveOuraConnection({ supabase, userId: parsedState.user_id, token })
    await syncOuraVitals({
      supabase,
      userId: parsedState.user_id,
      accessToken: token.access_token,
    })

    return redirect(res, appUrl, 'connected')
  } catch (err) {
    console.error('oura-callback error:', err)
    return redirect(res, appUrl, 'error', err.message ?? 'Oura connection failed.')
  }
}

function redirect(res, appUrl, status, message = '') {
  const url = new URL('/sync-wearable', appUrl)
  url.searchParams.set('oura', status)
  if (message) url.searchParams.set('message', message)
  res.writeHead(302, { Location: url.toString() })
  res.end()
}
