import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

export const GOOGLE_SYNC_APPOINTMENTS = [
  { title: 'Prenatal checkup', provider: 'Google Calendar', daysFromNow: 6, hour: 10, required: false, suggested: false },
  { title: 'Blood pressure screening', provider: 'Google Calendar', daysFromNow: 13, hour: 14, required: true, suggested: false },
]

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_STATE_SECRET = process.env.GOOGLE_STATE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET

export function assertGoogleCalendarConfig() {
  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
  if (!GOOGLE_STATE_SECRET) missing.push('GOOGLE_STATE_SECRET or GOOGLE_CLIENT_SECRET')

  if (missing.length) {
    throw new Error(`Server misconfigured. Missing ${missing.join(', ')}.`)
  }
}

export function getGoogleUserClient(auth) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getGoogleBaseUrl(req) {
  const configured = process.env.APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (configured) {
    return configured.startsWith('http') ? configured : `https://${configured}`
  }

  const proto = req.headers['x-forwarded-proto'] ?? 'http'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}`
}

export function getGoogleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI ?? `${getGoogleBaseUrl(req)}/api/google-calendar-callback`
}

export function createGoogleOAuthState(userId) {
  const payload = Buffer.from(JSON.stringify({
    user_id: userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + 10 * 60_000,
  })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyGoogleOAuthState(state) {
  const [payload, signature] = String(state ?? '').split('.')
  const expected = sign(payload || '')
  if (
    !payload ||
    !signature ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error('Invalid Google OAuth state')
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!parsed.user_id || Date.now() > parsed.exp) {
    throw new Error('Expired Google OAuth state')
  }
  return parsed
}

export function buildGoogleAuthorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeGoogleCodeForToken({ code, redirectUri }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error_description ?? data.error ?? `Google token request failed (${response.status})`)
  }
  return data
}

export async function createGoogleCalendarEvents(accessToken) {
  const created = []

  for (const appt of GOOGLE_SYNC_APPOINTMENTS) {
    const start = appointmentDate(appt.daysFromNow, appt.hour)
    const end = new Date(start.getTime() + 45 * 60_000)
    const event = await createGoogleCalendarEvent(accessToken, {
      summary: appt.title,
      location: 'Google Calendar',
      description: 'Synced from HeartToMom.',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    })
    created.push(event)
  }

  return created
}

async function createGoogleCalendarEvent(accessToken, event) {
  const response = await fetch(GOOGLE_CALENDAR_EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Google Calendar event insert failed (${response.status})`)
  }
  return data
}

function appointmentDate(daysFromNow, hour) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, 0, 0, 0)
  return d
}

function sign(payload) {
  return crypto.createHmac('sha256', GOOGLE_STATE_SECRET).update(payload).digest('base64url')
}
