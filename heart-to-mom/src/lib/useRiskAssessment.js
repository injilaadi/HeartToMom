import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useAuth } from './AuthContext.jsx'

/**
 * Reads the latest persisted risk assessment from the risk_assessments table.
 * Also exposes `refresh()` so screens that just triggered a new assessment
 * (e.g. after a check-in) can reload without a full page refresh.
 */
export function useLatestAssessment() {
  const { user } = useAuth()
  const [assessment, setAssessment] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('risk_assessments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setAssessment(data ?? null)
    setLoading(false)
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  return { assessment, loading, refresh }
}

/**
 * Triggers the AI risk-assessment serverless function. Pass a `trigger` label
 * so the server can tag where it came from ('onboarding' | 'check_in').
 *
 * Fail-safe: returns { ok: boolean, error? } and never throws — callers can
 * decide whether to block the user flow or just log and continue.
 */
export async function triggerRiskAssessment(trigger = 'manual') {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, error: 'Not signed in' }

    const res = await fetch('/api/risk-assessment', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trigger }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err.message ?? 'Network error' }
  }
}
