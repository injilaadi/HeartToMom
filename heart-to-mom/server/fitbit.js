import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const FITBIT_AUTH_URL = 'https://www.fitbit.com/oauth2/authorize'
export const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token'
export const FITBIT_API_BASE = 'https://api.fitbit.com'
export const FITBIT_SCOPES = ['activity', 'heartrate', 'sleep', 'profile']

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET
const FITBIT_STATE_SECRET = process.env.FITBIT_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY

export function assertFitbitConfig({ requireServiceRole = false } = {}) {
  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
  if (!FITBIT_CLIENT_ID) missing.push('FITBIT_CLIENT_ID')
  if (!FITBIT_CLIENT_SECRET) missing.push('FITBIT_CLIENT_SECRET')
  if (!FITBIT_STATE_SECRET) missing.push('FITBIT_STATE_SECRET')
  if (requireServiceRole && !SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')

  if (missing.length) {
    throw new Error(`Server misconfigured. Missing ${missing.join(', ')}.`)
  }
}

export function getUserClient(auth) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getBaseUrl(req) {
  const configured = process.env.APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (configured) {
    return configured.startsWith('http') ? configured : `https://${configured}`
  }

  const proto = req.headers['x-forwarded-proto'] ?? 'http'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}`
}

export function getRedirectUri(req) {
  return process.env.FITBIT_REDIRECT_URI ?? `${getBaseUrl(req)}/api/fitbit-callback`
}

export function createOAuthState(userId) {
  const payload = base64UrlEncode(JSON.stringify({
    user_id: userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + 10 * 60_000,
  }))
  const signature = sign(payload)
  return `${payload}.${signature}`
}

export function verifyOAuthState(state) {
  const [payload, signature] = String(state ?? '').split('.')
  const expected = sign(payload || '')
  if (
    !payload ||
    !signature ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error('Invalid Fitbit OAuth state')
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!parsed.user_id || Date.now() > parsed.exp) {
    throw new Error('Expired Fitbit OAuth state')
  }
  return parsed
}

export function buildAuthorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: FITBIT_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: FITBIT_SCOPES.join(' '),
    state,
  })

  return `${FITBIT_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken({ code, redirectUri }) {
  return fitbitTokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
}

export async function refreshFitbitToken(refreshToken) {
  return fitbitTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

export async function saveFitbitConnection({ supabase, userId, token }) {
  const expiresAt = new Date(Date.now() + Number(token.expires_in ?? 0) * 1000).toISOString()

  const { error: connectionError } = await supabase
    .from('wearable_connections')
    .upsert({
      user_id: userId,
      provider: 'fitbit',
      provider_user_id: token.user_id ?? null,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      scope: token.scope ?? FITBIT_SCOPES.join(' '),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })
  if (connectionError) throw connectionError

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ wearable_provider: 'Fitbit', updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (profileError) throw profileError
}

export async function syncFitbitVitals({ supabase, userId, accessToken }) {
  const today = new Date().toISOString().slice(0, 10)
  const [heart, steps, sleep] = await Promise.all([
    fitbitApi('/1/user/-/activities/heart/date/today/1d.json', accessToken),
    fitbitApi('/1/user/-/activities/steps/date/today/1d.json', accessToken),
    fitbitApi(`/1.2/user/-/sleep/date/${today}.json`, accessToken).catch(() => null),
  ])

  const heartRate = heart?.['activities-heart']?.[0]?.value?.restingHeartRate ?? null
  const stepCount = Number(steps?.['activities-steps']?.[0]?.value ?? 0)
  const sleepMinutes = sleep?.summary?.totalMinutesAsleep ?? null
  const metadata = {
    provider: 'fitbit',
    steps: Number.isFinite(stepCount) ? stepCount : null,
    sleep_minutes: sleepMinutes,
  }

  const { data, error } = await supabase
    .from('vitals')
    .insert({
      user_id: userId,
      systolic: null,
      diastolic: null,
      heart_rate: heartRate,
      recorded_at: new Date().toISOString(),
      source: 'fitbit',
      metadata,
    })
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getValidFitbitAccessToken({ supabase, userId }) {
  const { data: connection, error } = await supabase
    .from('wearable_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'fitbit')
    .maybeSingle()

  if (error) throw error
  if (!connection) throw new Error('Fitbit is not connected for this user.')

  const expiresAt = new Date(connection.expires_at).getTime()
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    return connection.access_token
  }

  const token = await refreshFitbitToken(connection.refresh_token)
  await saveFitbitConnection({ supabase, userId, token })
  return token.access_token
}

async function fitbitTokenRequest(body) {
  const response = await fetch(FITBIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message ?? data.error_description ?? `Fitbit token request failed (${response.status})`)
  }
  return data
}

async function fitbitApi(path, accessToken) {
  const response = await fetch(`${FITBIT_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message ?? `Fitbit API request failed (${response.status})`)
  }
  return data
}

function sign(payload) {
  return crypto.createHmac('sha256', FITBIT_STATE_SECRET).update(payload).digest('base64url')
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}
