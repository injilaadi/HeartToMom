import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import './pages-common.css'
import './SyncWearable.css'

const PROVIDERS = [
  { id: 'apple',   name: 'Apple Watch', desc: 'Heart rate, BP (with cuff), sleep, activity', glyph: '' },
  { id: 'fitbit',  name: 'Fitbit',      desc: 'Heart rate, sleep stages, stress score',     glyph: '◐' },
  { id: 'garmin',  name: 'Garmin',      desc: 'HRV, pulse ox, body battery',                glyph: '◆' },
  { id: 'oura',    name: 'Oura Ring',   desc: 'HRV, temperature, sleep readiness',          glyph: '○' },
  { id: 'whoop',   name: 'Whoop',       desc: 'Strain, recovery, HRV trends',               glyph: '◇' },
  { id: 'manual',  name: 'Manual entry', desc: 'Log BP and heart rate yourself',            glyph: '✎' },
]

export default function SyncWearable() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [connecting, setConnecting] = useState('')

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [user])

  const connected = profile?.wearable_provider ?? ''

  const connect = async (providerName) => {
    setConnecting(providerName)
    try {
      await supabase
        .from('profiles')
        .update({ wearable_provider: providerName, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      setProfile((p) => ({ ...p, wearable_provider: providerName }))
    } finally {
      setConnecting('')
    }
  }

  return (
    <div className="page">
      <NavBar profile={profile} />

      <main className="page__main">
        <header className="page__head">
          <p className="page__eyebrow">DEVICES</p>
          <h1 className="page__title">Sync your wearable</h1>
          <p className="page__lede">
            Continuous data gives us earlier signals than spot checks. Pick a device to sync — you can switch later.
          </p>
        </header>

        <div className="sw__grid">
          {PROVIDERS.map((p) => {
            const isConnected = connected === p.name
            const isLoading = connecting === p.name
            return (
              <article key={p.id} className={`card sw__card ${isConnected ? 'is-connected' : ''}`}>
                <div className="sw__head">
                  <span className="sw__glyph" aria-hidden>{p.glyph}</span>
                  <div>
                    <h2 className="sw__name">{p.name}</h2>
                    <p className="sw__desc">{p.desc}</p>
                  </div>
                </div>

                <div className="sw__action">
                  {isConnected ? (
                    <span className="pill pill--ok">
                      <span className="pill__dot" />Connected
                    </span>
                  ) : (
                    <button
                      className="btn-primary sw__btn"
                      onClick={() => connect(p.name)}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Connecting…' : 'Connect'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        <p className="sw__footer">
          We never share raw device data. Vitals are processed and stored under your account only.
        </p>
      </main>
    </div>
  )
}
