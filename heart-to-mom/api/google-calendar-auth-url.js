import {
  assertGoogleCalendarConfig,
  buildGoogleAuthorizeUrl,
  createGoogleOAuthState,
  getGoogleRedirectUri,
  getGoogleUserClient,
} from '../server/google-calendar.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    assertGoogleCalendarConfig()

    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' })
    }

    const supabase = getGoogleUserClient(auth)
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid auth token' })
    }

    return res.status(200).json({
      url: buildGoogleAuthorizeUrl({
        state: createGoogleOAuthState(user.id),
        redirectUri: getGoogleRedirectUri(req),
      }),
    })
  } catch (err) {
    console.error('google-calendar-auth-url error:', err)
    return res.status(500).json({ error: err.message ?? 'Internal error' })
  }
}
