import { useCallback, useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import './pages-common.css'
import './SyncWearable.css'

const PROVIDERS = [
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
    id: 'apple',
    name: 'Apple Watch',
    desc: 'Heart rate, sleep, activity, and blood pressure when paired with a cuff.',
    signal: 'Best for daily vitals',
    cadence: 'Every 15 min',
    glyph: 'watch',
    syncs: ['heart rate', 'sleep', 'steps', 'blood pressure'],
    implemented: false,
  },
  {
    id: 'oura',
    name: 'Oura Ring',
    desc: 'Temperature shifts, HRV, sleep readiness, and resting heart rate.',
    signal: 'Best for temperature',
    cadence: 'Daily summary',
    glyph: 'ring',
    syncs: ['temperature', 'HRV', 'sleep', 'readiness'],
    implemented: false,
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
  const [manualForm, setManualForm] = useState({
    systolic: '',
    diastolic: '',
    heartRate: '',
  })
  const [error, setError] = useState('')

  const connected = profile?.wearable_provider ?? ''
  const connectedProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.name === connected),
    [connected]
  )

  const refreshProfile = useCallback(async () => {
    if (!user) return
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    setProfile(data ?? null)
  }, [user])

  const saveConnection = useCallback(async (providerName, options = {}) => {
    setConnecting(providerName)
    setError('')
    try {
      if (options.importMockVitals) {
        await importMockVitals(user.id)
      }

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
    if (!user) return undefined

    let cancelled = false
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile(data ?? null)
      })

    return () => { cancelled = true }
  }, [user])

  // Handle the redirect back from Fitbit's OAuth flow.
  // Callback redirects to /sync-wearable?fitbit=connected (or error&message=…)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const params = new URLSearchParams(window.location.search)
    const status = params.get('fitbit')
    if (!status) return undefined

    const timer = window.setTimeout(() => {
      if (status === 'connected') {
        refreshProfile()
        setError('')
      } else if (status === 'error') {
        setError(params.get('message') ?? 'Fitbit connection failed.')
      }

      // Clean the URL so the banner doesn't reappear on every render
      window.history.replaceState({}, '', window.location.pathname)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshProfile])

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
      saveConnection(flowProvider.name, { importMockVitals: true })
    }, 420)

    return () => window.clearTimeout(timer)
  }, [flowProvider, flowStep, saveConnection, syncProgress])

  const beginConnect = (provider) => {
    setError('')
    setFlowError(null)
    setPairedDeviceName('')
    setSyncProgress(0)
    if (provider.implemented === false) return
    if (provider.id === 'manual') {
      setFlowProvider(provider)
      setFlowStep('manual')
      return
    }
    if (provider.id === 'fitbit') {
      connectFitbitOAuth()
      return
    }
    setFlowProvider(provider)
    setFlowStep('permissions')
  }

  // Fetches a Fitbit OAuth URL from our serverless function and redirects.
  // Fitbit's permission page → callback → /sync-wearable?fitbit=connected
  const connectFitbitOAuth = async () => {
    setConnecting('Fitbit')
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in first.')

      const res = await fetch('/api/fitbit-auth-url', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      })
      const body = await res.json()
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      window.location.assign(body.url)
    } catch (err) {
      setError(err.message ?? 'Could not start Fitbit authorization.')
      setConnecting('')
    }
  }

  const syncConnectedProviderNow = async (providerName) => {
    await saveConnection(providerName, { importMockVitals: true })
    await refreshProfile()
  }

  const disconnectWearable = async () => {
    if (!window.confirm(`Disconnect ${connectedProvider?.name ?? 'this device'}? You can reconnect any time.`)) return
    setError('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ wearable_provider: null, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (error) throw error
      setProfile((p) => ({ ...p, wearable_provider: null }))
    } catch (err) {
      setError(err.message ?? 'Could not disconnect device.')
    }
  }

  const useManualFallback = () => {
    const manualProvider = PROVIDERS.find((provider) => provider.id === 'manual')
    if (!manualProvider) return
    setFlowProvider(null)
    setFlowStep('permissions')
    setFlowError(null)
    setSyncProgress(0)
    setFlowProvider(manualProvider)
    setFlowStep('manual')
  }

  const closeFlow = () => {
    setFlowProvider(null)
    setFlowStep('permissions')
    setSyncProgress(0)
    setPairedDeviceName('')
    setFlowError(null)
    setManualForm({ systolic: '', diastolic: '', heartRate: '' })
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

  const updateManualForm = (field, value) => {
    setManualForm((current) => ({ ...current, [field]: value }))
  }

  const saveManualEntry = async () => {
    setConnecting('Manual entry')
    setError('')
    setFlowError(null)

    try {
      const { error: vitalError } = await supabase.from('vitals').insert({
        user_id: user.id,
        systolic: Number(manualForm.systolic),
        diastolic: Number(manualForm.diastolic),
        heart_rate: Number(manualForm.heartRate),
        recorded_at: new Date().toISOString(),
      })
      if (vitalError) throw vitalError

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ wearable_provider: 'Manual entry', updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (profileError) throw profileError

      setProfile((p) => ({ ...p, wearable_provider: 'Manual entry' }))
      setFlowStep('manual-done')
    } catch (err) {
      setFlowError(new BluetoothConnectError(
        'manual-save-failed',
        'Could not save manual reading',
        err.message ?? 'Please check the values and try again.'
      ))
      setFlowStep('error')
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
          <div className="sw__summary-actions">
            <span className={`sw__status ${connectedProvider ? 'sw__status--ok' : ''}`}>
              <span className="sw__status-dot" />
              {connectedProvider ? 'ready to sync' : 'not connected'}
            </span>
            {connectedProvider && (
              <button className="sw__disconnect" onClick={disconnectWearable}>
                Disconnect
              </button>
            )}
          </div>
        </section>

        {error && <div className="sw__error">{error}</div>}

        <div className="sw__layout">
          <section className="sw__grid" aria-label="Available wearable providers">
            {PROVIDERS.map((provider) => {
              const isConnected = connected === provider.name
              const isLoading = connecting === provider.name
              const canSyncConnectedDemo = isConnected && ['fitbit', 'apple'].includes(provider.id)
              const isComingSoon = provider.implemented === false
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

                  <div className="sw__btn-row">
                    <button
                      className={`sw__btn ${isConnected ? 'sw__btn--connected' : ''}`}
                      onClick={() => canSyncConnectedDemo ? syncConnectedProviderNow(provider.name) : beginConnect(provider)}
                      disabled={isLoading || isComingSoon || (isConnected && !canSyncConnectedDemo)}
                    >
                      {isComingSoon
                        ? 'To be implemented'
                        : isLoading
                        ? (canSyncConnectedDemo ? 'Syncing...' : 'Connecting...')
                        : canSyncConnectedDemo
                          ? 'Sync now'
                          : isConnected
                            ? 'Connected'
                            : provider.id === 'manual'
                              ? 'Use manual entry'
                              : 'Connect'}
                    </button>
                    {isConnected && (
                      <button
                        className="sw__btn-unsync"
                        onClick={disconnectWearable}
                        disabled={isLoading}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
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
          manualForm={manualForm}
          connecting={connecting === flowProvider.name}
          onManualChange={updateManualForm}
          onSaveManual={saveManualEntry}
          onAuthorize={authorizeFlow}
          onRetry={authorizeFlow}
          onUseManual={useManualFallback}
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
    acceptAllDevices: true,
    optionalServices: bluetooth.services,
  })

  if (!isSupportedDeviceName(device.name, bluetooth.namePrefixes)) {
    throw new BluetoothConnectError(
      'unsupported-device',
      `${device.name || 'Selected device'} is not supported for ${provider.name}.`,
      `You selected ${device.name || 'a Bluetooth device'}, but this flow expects ${provider.name}. Choose a supported wearable or use manual entry.`
    )
  }

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

function isSupportedDeviceName(deviceName = '', supportedPrefixes = []) {
  if (!deviceName) return false
  return supportedPrefixes.some((prefix) => (
    deviceName.toLowerCase().startsWith(prefix.toLowerCase())
  ))
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

async function importMockVitals(userId) {
  const now = new Date()
  const systolic = 112 + Math.floor(Math.random() * 12)
  const diastolic = 70 + Math.floor(Math.random() * 8)
  const heartRate = 76 + Math.floor(Math.random() * 12)

  const { error } = await supabase.from('vitals').insert({
    user_id: userId,
    systolic,
    diastolic,
    heart_rate: heartRate,
    recorded_at: now.toISOString(),
  })

  if (error) throw error
}

function ConnectFlow({
  provider,
  step,
  progress,
  deviceName,
  error,
  manualForm,
  connecting,
  onManualChange,
  onSaveManual,
  onAuthorize,
  onRetry,
  onUseManual,
  onClose,
}) {
  const isDone = step === 'done'
  const isManual = step === 'manual'
  const isManualDone = step === 'manual-done'
  const isPairing = step === 'pairing'
  const isSyncing = step === 'syncing'
  const isBusy = isPairing || isSyncing || connecting
  const isUnsupportedDevice = error?.code === 'unsupported-device'

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
            <p className="sw-flow__kicker">
              {isDone || isManualDone ? 'CONNECTED' : step === 'error' ? 'CONNECTION ISSUE' : isManual ? 'MANUAL ENTRY' : 'CONNECT DEVICE'}
            </p>
            <h2 id="sw-flow-title">
              {isDone || isManualDone
                ? `${provider.name} is ready`
                : step === 'error'
                  ? `Could not connect ${provider.name}`
                  : isManual
                    ? 'Add a manual reading'
                    : `Connect ${provider.name}`}
            </h2>
          </div>
        </div>

        <div className="sw-flow__steps" aria-label="Connection progress">
          {['permissions', 'pairing', 'syncing', 'done'].map((item, index) => {
            const activeIndex = isDone || isManualDone ? 3 : isSyncing ? 2 : isPairing ? 1 : 0
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

        {isManual && (
          <ManualEntryForm
            form={manualForm}
            saving={connecting}
            onChange={onManualChange}
            onSave={onSaveManual}
            onCancel={onClose}
          />
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
            <div className="sw-flow__browser-note">
              <span aria-hidden><ProviderIcon name="shield" /></span>
              <p>
                {isUnsupportedDevice
                  ? 'This Bluetooth device was found, but it does not match the wearable type you selected.'
                  : 'Direct Bluetooth pairing works best in Chrome or Edge on desktop. If the device is not discoverable, manual entry keeps your vitals flowing.'}
              </p>
            </div>
            <div className="sw-flow__actions sw-flow__actions--stacked">
              <button className="sw-flow__primary" onClick={onUseManual}>Use manual entry</button>
              <button className="sw-flow__primary" onClick={onRetry}>Try again</button>
              <button className="sw-flow__secondary" onClick={onClose}>Choose another device</button>
            </div>
          </div>
        )}

        {(isDone || isManualDone) && (
          <div className="sw-flow__done">
            <span className="sw-flow__done-mark" aria-hidden>✓</span>
            <p className="sw-flow__done-title">{isManualDone ? 'Manual reading saved' : 'Connection saved'}</p>
            <p className="sw-flow__done-copy">
              {isManualDone
                ? 'Your latest blood pressure and heart rate are ready for the dashboard.'
                : `${deviceName || provider.name} is connected through ${provider.name}. A fresh sample vital was imported for your dashboard.`}
            </p>
            <button className="sw-flow__primary" onClick={onClose}>Done</button>
          </div>
        )}
      </section>
    </div>
  )
}

function ManualEntryForm({ form, saving, onChange, onSave, onCancel }) {
  const canSave = Number(form.systolic) > 0 && Number(form.diastolic) > 0 && Number(form.heartRate) > 0

  return (
    <div className="sw-manual">
      <p className="sw-flow__lede">
        Enter the reading from your cuff or wearable. This will update today&apos;s vitals on your dashboard.
      </p>

      <div className="sw-manual__grid">
        <label className="sw-manual__field">
          <span>Systolic</span>
          <input
            type="number"
            min="70"
            max="220"
            placeholder="118"
            value={form.systolic}
            onChange={(e) => onChange('systolic', e.target.value)}
          />
        </label>
        <label className="sw-manual__field">
          <span>Diastolic</span>
          <input
            type="number"
            min="40"
            max="140"
            placeholder="76"
            value={form.diastolic}
            onChange={(e) => onChange('diastolic', e.target.value)}
          />
        </label>
        <label className="sw-manual__field">
          <span>Heart rate</span>
          <input
            type="number"
            min="35"
            max="220"
            placeholder="82"
            value={form.heartRate}
            onChange={(e) => onChange('heartRate', e.target.value)}
          />
        </label>
      </div>

      <div className="sw-flow__actions">
        <button className="sw-flow__secondary" onClick={onCancel}>Cancel</button>
        <button className="sw-flow__primary" onClick={onSave} disabled={!canSave || saving}>
          {saving ? 'Saving...' : 'Save reading'}
        </button>
      </div>
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
