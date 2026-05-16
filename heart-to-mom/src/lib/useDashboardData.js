import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useAuth } from './AuthContext.jsx'

/**
 * Loads everything the dashboard needs. Returns null fields for any data
 * that doesn't exist yet, so the UI can render empty states.
 *
 * Safe to call even before the schema SQL has been run — table-missing
 * errors are caught and treated the same as "no data".
 */
export function useDashboardData() {
  const { user } = useAuth()
  const [data, setData] = useState({
    profile: null,
    appointments: [],
    latestVital: null,
    latestCheckIn: null,
    loading: true,
  })

  useEffect(() => {
    if (!user) return

    let cancelled = false

    async function fetchAll() {
      const safe = (p) => p.then((r) => r).catch(() => ({ data: null, error: null }))

      const [profileRes, apptRes, vitalRes, checkInRes] = await Promise.all([
        safe(
          supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle()
        ),
        safe(
          supabase
            .from('appointments')
            .select('*')
            .eq('user_id', user.id)
            .gte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
        ),
        safe(
          supabase
            .from('vitals')
            .select('*')
            .eq('user_id', user.id)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ),
        safe(
          supabase
            .from('check_ins')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ),
      ])

      if (cancelled) return

      setData({
        profile: profileRes.data ?? null,
        appointments: apptRes.data ?? [],
        latestVital: vitalRes.data ?? null,
        latestCheckIn: checkInRes.data ?? null,
        loading: false,
      })
    }

    fetchAll()
    return () => { cancelled = true }
  }, [user])

  return data
}
