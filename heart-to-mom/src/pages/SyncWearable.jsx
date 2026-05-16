import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import './pages-common.css'
import './SyncWearable.css'

const PROVIDERS = [
  {
    id: 'apple',
    name: 'Apple Watch',
    desc: 'Heart rate, sleep, activity, and blood pressure when paired with a cuff.',
    signal: 'Best for daily vitals',
    cadence: 'Every 15 min',
    glyph: 'watch',
    syncs: ['heart rate', 'sleep', 'steps', 'blood pressure'],
  },
  {
    id: 'fitbit',
    name: 'Fitbit',
    desc: 'Heart rate, sleep stages, activity minutes, and stress signals.',
    signal: 'Best for sleep trends',
    cadence: 'Hourly',
    glyph: 'band',
    syncs: ['heart rate', 'sleep stages', 'activity', 'stress'],
  },
  {
    id: 'oura',
    name: 'Oura Ring',
    desc: 'Temperature shifts, HRV, sleep readiness, and resting heart rate.',
    signal: 'Best for temperature',
    cadence: 'Daily summary',
    glyph: 'ring',
    syncs: ['temperature', 'HRV', 'sleep', 'readiness'],
  },
  {
    id: 'manual',
    name: 'Manual entry',
    desc: 'No wearable needed. Add blood pressure and heart rate by hand.',
    signal: 'Best for cuff readings',
    cadence: 'When logged',
    glyph: 'pen',
    syncs: ['blood pressure', 'heart rate', 'symptoms', 'notes'],
  },
]

const SYNC_PERMISSIONS = [
  'heart rate and resting heart rate',
  'blood pressure readings when available',
  'sleep duration and recovery signals',
  'activity trends that may affect risk score',
]

export default function SyncWearable() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [connecting, setConnecting] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [user])

  const connected = profile?.wearable_provider ?? ''
  const connectedProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.name === connected),
    [connected]
  )

  const connect = async (providerName) => {
    setConnecting(providerName)
    setError('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ wearable_provider: providerName, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (error) throw error
      setProfile((p) => ({ ...p, wearable_provider: providerName }))
    } catch (err) {
      setError(err.message ?? 'Could not sync this wearable. Please try again.')
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
            Continuous data gives us earlier signals than spot checks. Pick a device to sync, or use manual entry if you prefer.
          </p>
        </header>

        <section className="sw__summary" aria-label="Wearable sync summary">
          <div className="sw__summary-main">
            <p className="sw__summary-kicker">CURRENT CONNECTION</p>
            <h2>{connectedProvider ? connectedProvider.name : 'No device connected'}</h2>
            <p>
              {connectedProvider
                ? `${connectedProvider.signal}. Sync cadence: ${connectedProvider.cadence.toLowerCase()}.`
                : 'Choose a device below to start bringing vitals into your HeartToMom dashboard.'}
            </p>
          </div>
          <span className={`sw__status ${connectedProvider ? 'sw__status--ok' : ''}`}>
            <span className="sw__status-dot" />
            {connectedProvider ? 'ready to sync' : 'not connected'}
          </span>
        </section>

        {error && <div className="sw__error">{error}</div>}

        <div className="sw__layout">
          <section className="sw__grid" aria-label="Available wearable providers">
            {PROVIDERS.map((provider) => {
              const isConnected = connected === provider.name
              const isLoading = connecting === provider.name
              return (
                <article key={provider.id} className={`sw__card ${isConnected ? 'is-connected' : ''}`}>
                  <div className="sw__head">
                    <span className="sw__glyph" aria-hidden><ProviderIcon name={provider.glyph} /></span>
                    <div>
                      <div className="sw__title-row">
                        <h2 className="sw__name">{provider.name}</h2>
                        {isConnected && <span className="sw__mini-status">Connected</span>}
                      </div>
                      <p className="sw__desc">{provider.desc}</p>
                    </div>
                  </div>

                  <div className="sw__chips" aria-label={`${provider.name} synced signals`}>
                    {provider.syncs.map((item) => (
                      <span key={item} className="sw__chip">{item}</span>
                    ))}
                  </div>

                  <div className="sw__meta">
                    <span>{provider.signal}</span>
                    <span>{provider.cadence}</span>
                  </div>

                  <button
                    className={`sw__btn ${isConnected ? 'sw__btn--connected' : ''}`}
                    onClick={() => connect(provider.name)}
                    disabled={isLoading || isConnected}
                  >
                    {isLoading ? 'Connecting...' : isConnected ? 'Connected' : provider.id === 'manual' ? 'Use manual entry' : 'Connect'}
                  </button>
                </article>
              )
            })}
          </section>

          <aside className="sw__side" aria-label="Sync details">
            <section className="sw__panel">
              <div className="sw__panel-icon" aria-hidden><ProviderIcon name="shield" /></div>
              <div>
                <h2>What HeartToMom reads</h2>
                <p>Only health signals that help estimate maternal risk are requested.</p>
              </div>
              <ul className="sw__permission-list">
                {SYNC_PERMISSIONS.map((permission) => (
                  <li key={permission}>
                    <span aria-hidden>✓</span>
                    {permission}
                  </li>
                ))}
              </ul>
            </section>

            <section className="sw__panel sw__panel--soft">
              <p className="sw__panel-kicker">PRIVACY</p>
              <h2>You stay in control</h2>
              <p>
                You can switch devices any time. Raw device feeds are not shared with providers unless you choose to export a report.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}

function ProviderIcon({ name }) {
  const props = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  switch (name) {
    case 'watch':
      return <svg {...props}><rect x="7" y="6" width="10" height="12" rx="3" /><path d="M9 6V3h6v3M9 18v3h6v-3" /><path d="M10 12h4" /></svg>
    case 'band':
      return <svg {...props}><path d="M8 4h8l1 5-1 11H8L7 9z" /><path d="M9 9h6M10 14h4" /></svg>
    case 'diamond':
      return <svg {...props}><path d="M12 3l8 9-8 9-8-9z" /><path d="M8 12h8" /></svg>
    case 'ring':
      return <svg {...props}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></svg>
    case 'loop':
      return <svg {...props}><path d="M7 17c-3-2-4-6-2-9s6-4 9-2l3 2" /><path d="M17 7c3 2 4 6 2 9s-6 4-9 2l-3-2" /><path d="M8 8l8 8" /></svg>
    case 'pen':
      return <svg {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
    case 'shield':
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-5" /></svg>
    default:
      return null
  }
}
