import {
  assertFitbitConfig,
  getServiceClient,
  getUserClient,
  getValidFitbitAccessToken,
  syncFitbitVitals,
} from '../server/fitbit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    assertFitbitConfig({ requireServiceRole: true })

    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' })
    }

    const userClient = getUserClient(auth)
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid auth token' })
    }

    const supabase = getServiceClient()
    const accessToken = await getValidFitbitAccessToken({ supabase, userId: user.id })
    const vital = await syncFitbitVitals({ supabase, userId: user.id, accessToken })

    return res.status(200).json({ ok: true, vital })
  } catch (err) {
    console.error('fitbit-sync error:', err)
    return res.status(500).json({ error: err.message ?? 'Internal error' })
  }
}
