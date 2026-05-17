import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize'
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
export const OURA_API_BASE = 'https://api.ouraring.com'
export const OURA_SCOPES = ['email', 'personal', 'daily', 'heartrate']

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET
const OURA_STATE_SECRET = process.env.OURA_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY

export function assertOuraConfig({ requireServiceRole = false } = {}) {
  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
  if (!OURA_CLIENT_ID) missing.push('OURA_CLIENT_ID')
  if (!OURA_CLIENT_SECRET) missing.push('OURA_CLIENT_SECRET')
  if (!OURA_STATE_SECRET) missing.push('OURA_STATE_SECRET')
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
  return process.env.OURA_REDIRECT_URI ?? `${getBaseUrl(req)}/api/oura-callback`
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
    throw new Error('Invalid Oura OAuth state')
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!parsed.user_id || Date.now() > parsed.exp) {
    throw new Error('Expired Oura OAuth state')
  }
  return parsed
}

export function buildAuthorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OURA_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OURA_SCOPES.join(' '),
    state,
  })
  return `${OURA_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken({ code, redirectUri }) {
  return ouraTokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
}

export async function refreshOuraToken(refreshToken) {
  return ouraTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

export async function saveOuraConnection({ supabase, userId, token }) {
  const expiresAt = new Date(Date.now() + Number(token.expires_in ?? 0) * 1000).toISOString()

  const { error: connectionError } = await supabase
    .from('wearable_connections')
    .upsert({
      user_id: userId,
      provider: 'oura',
      provider_user_id: null,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      scope: token.scope ?? OURA_SCOPES.join(' '),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })
  if (connectionError) throw connectionError

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ wearable_provider: 'Oura Ring', updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (profileError) throw profileError
}

export async function syncOuraVitals({ supabase, userId, accessToken }) {
  // Pull the last 24 hours of heart-rate samples; take the latest.
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  const hr = await ouraApi(
    `/v2/usercollection/heartrate?start_datetime=${start.toISOString()}&end_datetime=${end.toISOString()}`,
    accessToken,
  ).catch(() => null)

  // Oura returns { data: [{ bpm, source, timestamp }, ...] }
  const latest = (hr?.data ?? []).slice(-1)[0]
  const heartRate = latest?.bpm ?? null
  const recordedAt = latest?.timestamp ?? new Date().toISOString()

  const { data, error } = await supabase
    .from('vitals')
    .insert({
      user_id: userId,
      systolic: null,
      diastolic: null,
      heart_rate: heartRate,
      recorded_at: recordedAt,
      source: 'oura',
      metadata: { provider: 'oura', samples_pulled: hr?.data?.length ?? 0 },
    })
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getValidOuraAccessToken({ supabase, userId }) {
  const { data: connection, error } = await supabase
    .from('wearable_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .maybeSingle()

  if (error) throw error
  if (!connection) throw new Error('Oura is not connected for this user.')

  const expiresAt = new Date(connection.expires_at).getTime()
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    return connection.access_token
  }

  const token = await refreshOuraToken(connection.refresh_token)
  await saveOuraConnection({ supabase, userId, token })
  return token.access_token
}

async function ouraTokenRequest(body) {
  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${OURA_CLIENT_ID}:${OURA_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? `Oura token request failed (${response.status})`)
  }
  return data
}

async function ouraApi(path, accessToken) {
  const response = await fetch(`${OURA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail ?? data.message ?? `Oura API request failed (${response.status})`)
  }
  return data
}

function sign(payload) {
  return crypto.createHmac('sha256', OURA_STATE_SECRET).update(payload).digest('base64url')
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}
