import {
  assertGoogleCalendarConfig,
  createGoogleCalendarEvents,
  exchangeGoogleCodeForToken,
  getGoogleBaseUrl,
  getGoogleRedirectUri,
  verifyGoogleOAuthState,
} from '../server/google-calendar.js'

export default async function handler(req, res) {
  const appUrl = getGoogleBaseUrl(req)

  try {
    assertGoogleCalendarConfig()

    const { code, state, error, error_description: errorDescription } = req.query ?? {}
    if (error) {
      return redirect(res, appUrl, 'error', errorDescription || error)
    }
    if (!code || !state) {
      return redirect(res, appUrl, 'error', 'Missing Google authorization code.')
    }

    verifyGoogleOAuthState(state)
    const token = await exchangeGoogleCodeForToken({ code, redirectUri: getGoogleRedirectUri(req) })
    await createGoogleCalendarEvents(token.access_token)

    return redirect(res, appUrl, 'connected')
  } catch (err) {
    console.error('google-calendar-callback error:', err)
    return redirect(res, appUrl, 'error', err.message ?? 'Google Calendar sync failed.')
  }
}

function redirect(res, appUrl, status, message = '') {
  const url = new URL('/home', appUrl)
  url.searchParams.set('google_calendar', status)
  if (message) url.searchParams.set('message', message)
  res.writeHead(302, { Location: url.toString() })
  res.end()
}
