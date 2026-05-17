import {
  assertOuraConfig,
  buildAuthorizeUrl,
  createOAuthState,
  getRedirectUri,
  getUserClient,
} from '../server/oura.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    assertOuraConfig()

    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' })
    }

    const supabase = getUserClient(auth)
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid auth token' })
    }

    return res.status(200).json({
      url: buildAuthorizeUrl({
        state: createOAuthState(user.id),
        redirectUri: getRedirectUri(req),
      }),
    })
  } catch (err) {
    console.error('oura-auth-url error:', err)
    return res.status(500).json({ error: err.message ?? 'Internal error' })
  }
}
