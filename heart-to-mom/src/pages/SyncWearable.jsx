import { useCallback, useEffect, useMemo, useState } from 'react'
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
    bluetooth: {
      namePrefixes: ['Apple Watch', 'Apple'],
      services: ['heart_rate', 'battery_service', 'device_information'],
    },
  },
  {
    id: 'fitbit',
    name: 'Fitbit',
    desc: 'Heart rate, sleep stages, activity minutes, and stress signals.',
    signal: 'Best for sleep trends',
    cadence: 'Hourly',
    glyph: 'band',
    syncs: ['heart rate', 'sleep stages', 'activity', 'stress'],
    bluetooth: {
      namePrefixes: ['Fitbit', 'Charge', 'Sense', 'Versa', 'Inspire'],
      services: ['heart_rate', 'battery_service', 'device_information'],
    },
  },
  {
    id: 'oura',
    name: 'Oura Ring',
    desc: 'Temperature shifts, HRV, sleep readiness, and resting heart rate.',
    signal: 'Best for temperature',
    cadence: 'Daily summary',
    glyph: 'ring',
    syncs: ['temperature', 'HRV', 'sleep', 'readiness'],
    bluetooth: {
      namePrefixes: ['Oura', 'oura'],
      services: ['battery_service', 'device_information'],
    },
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
  const [flowProvider, setFlowProvider] = useState(null)
  const [flowStep, setFlowStep] = useState('permissions')
  const [syncProgress, setSyncProgress] = useState(0)
  const [pairedDeviceName, setPairedDeviceName] = useState('')
  const [flowError, setFlowError] = useState(null)
  const [error, setError] = useState('')

  const connected = profile?.wearable_provider ?? ''
  const connectedProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.name === connected),
    [connected]
  )

  const saveConnection = useCallback(async (providerName) => {
    setConnecting(providerName)
    setError('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ wearable_provider: providerName, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (error) throw error
      setProfile((p) => ({ ...p, wearable_provider: providerName }))
      setFlowStep('done')
    } catch (err) {
      setError(err.message ?? 'Could not sync this wearable. Please try again.')
      setFlowStep('permissions')
    } finally {
      setConnecting('')
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [user])

  useEffect(() => {
    if (flowStep !== 'syncing') return undefined

    const ticks = [34, 58, 82, 100]
    const timers = ticks.map((value, index) => (
      window.setTimeout(() => setSyncProgress(value), 420 * (index + 1))
    ))

    return () => timers.forEach(window.clearTimeout)
  }, [flowStep])

  useEffect(() => {
    if (flowStep !== 'syncing' || syncProgress !== 100 || !flowProvider) return undefined

    const timer = window.setTimeout(() => {
      saveConnection(flowProvider.name)
    }, 420)

    return () => window.clearTimeout(timer)
  }, [flowProvider, flowStep, saveConnection, syncProgress])

  const beginConnect = (provider) => {
    setError('')
    setFlowError(null)
    setPairedDeviceName('')
    setSyncProgress(0)
    if (provider.id === 'manual') {
      saveConnection(provider.name)
      return
    }
    setFlowProvider(provider)
    setFlowStep('permissions')
  }

  const closeFlow = () => {
    setFlowProvider(null)
    setFlowStep('permissions')
    setSyncProgress(0)
    setPairedDeviceName('')
    setFlowError(null)
  }

  const authorizeFlow = async () => {
    setError('')
    setFlowError(null)
    setFlowStep('pairing')

    try {
      const device = await requestBluetoothDevice(flowProvider)
      setPairedDeviceName(device.name || flowProvider.name)
      setSyncProgress(12)
      setFlowStep('syncing')
    } catch (err) {
      setFlowError(formatBluetoothError(err, flowProvider))
      setFlowStep('error')
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
                    onClick={() => beginConnect(provider)}
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

      {flowProvider && (
        <ConnectFlow
          provider={flowProvider}
          step={flowStep}
          progress={syncProgress}
          deviceName={pairedDeviceName}
          error={flowError}
          connecting={connecting === flowProvider.name}
          onAuthorize={authorizeFlow}
          onRetry={authorizeFlow}
          onClose={closeFlow}
        />
      )}
    </div>
  )
}

async function requestBluetoothDevice(provider) {
  if (!navigator.bluetooth) {
    throw new BluetoothConnectError(
      'unsupported',
      'Bluetooth is not available in this browser.',
      'Use Chrome or Microsoft Edge on a Bluetooth-enabled laptop, then try again.'
    )
  }

  const bluetooth = provider.bluetooth
  if (!bluetooth) {
    throw new BluetoothConnectError(
      'unsupported-provider',
      `${provider.name} does not support direct Bluetooth pairing here.`,
      'Use manual entry for now, or choose another wearable.'
    )
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: bluetooth.namePrefixes.map((namePrefix) => ({ namePrefix })),
    optionalServices: bluetooth.services,
  })

  if (!device.gatt) {
    throw new BluetoothConnectError(
      'gatt-unavailable',
      'This device was found, but it does not expose a Bluetooth health connection.',
      'Make sure the device is awake, nearby, and not already connected to another app.'
    )
  }

  await device.gatt.connect()
  return device
}

function formatBluetoothError(err, provider) {
  if (err instanceof BluetoothConnectError) return err

  if (err?.name === 'NotFoundError') {
    return new BluetoothConnectError(
      'not-found',
      `${provider.name} was not selected.`,
      'Keep the wearable nearby, make sure Bluetooth is on, then try pairing again.'
    )
  }

  if (err?.name === 'NotSupportedError') {
    return new BluetoothConnectError(
      'not-supported',
      `${provider.name} cannot be paired through this browser.`,
      'Try Chrome or Edge on desktop, or use manual entry for this demo.'
    )
  }

  if (err?.name === 'SecurityError') {
    return new BluetoothConnectError(
      'blocked',
      'Bluetooth permission is blocked for this page.',
      'Allow Bluetooth access in your browser settings, then retry.'
    )
  }

  if (err?.name === 'NetworkError') {
    return new BluetoothConnectError(
      'connection-failed',
      'The device was found, but the Bluetooth connection failed.',
      'Move it closer, wake the screen, and make sure it is not connected somewhere else.'
    )
  }

  return new BluetoothConnectError(
    'unknown',
    `Could not connect to ${provider.name}.`,
    err?.message || 'Please check Bluetooth and try again.'
  )
}

class BluetoothConnectError extends Error {
  constructor(code, title, message) {
    super(message)
    this.code = code
    this.title = title
  }
}

function ConnectFlow({ provider, step, progress, deviceName, error, connecting, onAuthorize, onRetry, onClose }) {
  const isDone = step === 'done'
  const isPairing = step === 'pairing'
  const isSyncing = step === 'syncing'
  const isBusy = isPairing || isSyncing || connecting

  return (
    <div className="sw-flow" role="dialog" aria-modal="true" aria-labelledby="sw-flow-title">
      <div className="sw-flow__backdrop" onClick={isBusy ? undefined : onClose} />
      <section className="sw-flow__card">
        <button
          className="sw-flow__close"
          onClick={onClose}
          disabled={isBusy}
          aria-label="Close connect flow"
        >
          ×
        </button>

        <div className="sw-flow__brand">
          <span className="sw-flow__device" aria-hidden><ProviderIcon name={provider.glyph} /></span>
          <div>
            <p className="sw-flow__kicker">{isDone ? 'CONNECTED' : step === 'error' ? 'CONNECTION ISSUE' : 'CONNECT DEVICE'}</p>
            <h2 id="sw-flow-title">
              {isDone ? `${provider.name} is ready` : step === 'error' ? `Could not connect ${provider.name}` : `Connect ${provider.name}`}
            </h2>
          </div>
        </div>

        <div className="sw-flow__steps" aria-label="Connection progress">
          {['permissions', 'pairing', 'syncing', 'done'].map((item, index) => {
            const activeIndex = isDone ? 3 : isSyncing ? 2 : isPairing ? 1 : 0
            return (
              <span
                key={item}
                className={[
                  'sw-flow__step',
                  index <= activeIndex && 'is-active',
                  index < activeIndex && 'is-complete',
                ].filter(Boolean).join(' ')}
              />
            )
          })}
        </div>

        {step === 'permissions' && (
          <>
            <p className="sw-flow__lede">
              Review the signals HeartToMom will request from {provider.name}. Your browser will ask you to choose a nearby Bluetooth device next.
            </p>

            <div className="sw-flow__permission-grid">
              {provider.syncs.map((signal) => (
                <label key={signal} className="sw-flow__permission">
                  <input type="checkbox" checked readOnly />
                  <span>{signal}</span>
                </label>
              ))}
            </div>

            <div className="sw-flow__note">
              <span aria-hidden><ProviderIcon name="shield" /></span>
              <p>We only save summarized vitals to your profile. Raw wearable feeds stay private.</p>
            </div>

            <div className="sw-flow__actions">
              <button className="sw-flow__secondary" onClick={onClose}>Cancel</button>
              <button className="sw-flow__primary" onClick={onAuthorize}>
                Pair with Bluetooth
              </button>
            </div>
          </>
        )}

        {isPairing && (
          <div className="sw-flow__syncing">
            <div className="sw-flow__pulse" aria-hidden><ProviderIcon name={provider.glyph} /></div>
            <p className="sw-flow__sync-title">Waiting for Bluetooth pairing</p>
            <p className="sw-flow__sync-copy">
              Select your {provider.name} in the browser pairing window. Keep the device awake and nearby.
            </p>
          </div>
        )}

        {isSyncing && (
          <div className="sw-flow__syncing">
            <div className="sw-flow__pulse" aria-hidden><ProviderIcon name={provider.glyph} /></div>
            <p className="sw-flow__sync-title">Securely syncing {deviceName || provider.name}</p>
            <p className="sw-flow__sync-copy">Checking permissions, reading recent signals, and preparing your dashboard.</p>
            <div className="sw-flow__progress" aria-label={`${progress}% complete`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="sw-flow__progress-label">{progress}% complete</p>
          </div>
        )}

        {step === 'error' && (
          <div className="sw-flow__error">
            <span className="sw-flow__error-mark" aria-hidden>!</span>
            <p className="sw-flow__error-title">{error?.title || 'Connection failed'}</p>
            <p className="sw-flow__error-copy">
              {error?.message || 'Check Bluetooth permissions and try again.'}
            </p>
            <div className="sw-flow__actions sw-flow__actions--center">
              <button className="sw-flow__secondary" onClick={onClose}>Close</button>
              <button className="sw-flow__primary" onClick={onRetry}>Try again</button>
            </div>
          </div>
        )}

        {isDone && (
          <div className="sw-flow__done">
            <span className="sw-flow__done-mark" aria-hidden>✓</span>
            <p className="sw-flow__done-title">Connection saved</p>
            <p className="sw-flow__done-copy">
              {deviceName || provider.name} will now appear as your connected wearable. New vitals will show on the dashboard when available.
            </p>
            <button className="sw-flow__primary" onClick={onClose}>Done</button>
          </div>
        )}
      </section>
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
