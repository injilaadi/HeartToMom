import {
  assertFitbitConfig,
  exchangeCodeForToken,
  getBaseUrl,
  getRedirectUri,
  getServiceClient,
  saveFitbitConnection,
  syncFitbitVitals,
  verifyOAuthState,
} from '../server/fitbit.js'

export default async function handler(req, res) {
  const appUrl = getBaseUrl(req)

  try {
    assertFitbitConfig({ requireServiceRole: true })

    const { code, state, error, error_description: errorDescription } = req.query ?? {}
    if (error) {
      return redirect(res, appUrl, 'error', errorDescription || error)
    }
    if (!code || !state) {
      return redirect(res, appUrl, 'error', 'Missing Fitbit authorization code.')
    }

    const parsedState = verifyOAuthState(state)
    const token = await exchangeCodeForToken({ code, redirectUri: getRedirectUri(req) })
    const supabase = getServiceClient()

    await saveFitbitConnection({ supabase, userId: parsedState.user_id, token })
    await syncFitbitVitals({
      supabase,
      userId: parsedState.user_id,
      accessToken: token.access_token,
    })

    return redirect(res, appUrl, 'connected')
  } catch (err) {
    console.error('fitbit-callback error:', err)
    return redirect(res, appUrl, 'error', err.message ?? 'Fitbit connection failed.')
  }
}

function redirect(res, appUrl, status, message = '') {
  const url = new URL('/sync-wearable', appUrl)
  url.searchParams.set('fitbit', status)
  if (message) url.searchParams.set('message', message)
  res.writeHead(302, { Location: url.toString() })
  res.end()
}
