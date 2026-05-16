import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { useDashboardData } from '../lib/useDashboardData.js'
import { supabase } from '../lib/supabase.js'
import NavBar from '../components/NavBar.jsx'
import './pages-common.css'
import './Home.css'

const TOTAL_WEEKS = 40
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEKDAYS = ['S','M','T','W','T','F','S']

const GOOGLE_SYNC_APPOINTMENTS = [
  { title: 'Prenatal checkup', provider: 'Google Calendar', daysFromNow: 6, hour: 10, required: false, suggested: false },
  { title: 'Blood pressure screening', provider: 'Google Calendar', daysFromNow: 13, hour: 14, required: true, suggested: false },
]

const RECOMMENDED_APPOINTMENTS = [
  { id: 'rec-bp', title: 'Blood pressure review', provider: 'Recommended', daysFromNow: 5, required: true, suggested: false },
  { id: 'rec-ultrasound', title: 'Ultrasound follow-up', provider: 'Recommended', daysFromNow: 12, required: false, suggested: true },
  { id: 'rec-birth-plan', title: 'Birth plan consult', provider: 'Recommended', daysFromNow: 21, required: false, suggested: true },
]

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile, appointments, latestVital, latestCheckIn, loading } = useDashboardData()
  const [profileModalDismissed, setProfileModalDismissed] = useState(false)
  const [localAppointments, setLocalAppointments] = useState([])
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [appointmentSyncing, setAppointmentSyncing] = useState(false)
  const [appointmentError, setAppointmentError] = useState('')

  // Show the "finish your health profile" modal whenever the user
  // hasn't completed onboarding (incl. when their profile row is missing entirely).
  const showProfileModal =
    !loading
    && !!user
    && !profile?.onboarding_completed
    && !profileModalDismissed

  // Reset dismissal whenever the profile changes (e.g. user just completed it)
  useEffect(() => {
    if (profile?.onboarding_completed) setProfileModalDismissed(false)
  }, [profile?.onboarding_completed])

  const firstName =
    profile?.full_name?.split(' ')[0] ??
    user?.user_metadata?.full_name?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there'

  const greeting = greetingForHour(new Date().getHours())

  const due = profile?.due_date ? new Date(profile.due_date) : null
  const pregnancy = calculatePregnancy(due)
  const wearableProvider = profile?.wearable_provider
  const syncLabel = latestVital
    ? `Last reading ${timeAgo(latestVital.recorded_at)}`
    : wearableProvider
      ? 'Waiting for first reading'
      : 'Not connected'
  const recommendedAppointments = buildRecommendedAppointments()
  const calendarAppointments = mergeAppointments(appointments, localAppointments, recommendedAppointments)
  const bookedAppointments = calendarAppointments.filter((appt) => !appt.recommended)
  const recommendedUpcoming = calendarAppointments.filter((appt) => appt.recommended)

  const addAppointment = async (payload) => {
    setAppointmentError('')
    const appointment = {
      user_id: user.id,
      title: payload.title,
      provider: payload.provider || null,
      location: payload.location || null,
      scheduled_at: payload.scheduled_at,
      required: payload.kind === 'required',
      suggested: payload.kind === 'suggested',
    }

    const { data, error } = await supabaseInsertAppointment(appointment)
    if (error) {
      setAppointmentError(error.message ?? 'Could not add appointment.')
      return false
    }

    setLocalAppointments((current) => [...current, data ?? { ...appointment, id: `local-${Date.now()}` }])
    return true
  }

  const syncGoogleCalendar = async () => {
    setAppointmentError('')
    setAppointmentSyncing(true)
    try {
      const synced = GOOGLE_SYNC_APPOINTMENTS.map((appt) => ({
        user_id: user.id,
        title: appt.title,
        provider: appt.provider,
        location: 'Google Calendar',
        scheduled_at: appointmentDate(appt.daysFromNow, appt.hour).toISOString(),
        required: appt.required,
        suggested: appt.suggested,
      }))

      await new Promise((resolve) => window.setTimeout(resolve, 700))
      const saved = await Promise.all(synced.map(async (appt, index) => {
        const { data, error } = await supabaseInsertAppointment(appt)
        if (error) throw error
        return data ?? { ...appt, id: `google-${Date.now()}-${index}` }
      }))
      setLocalAppointments((current) => mergeAppointments(current, saved))
    } catch (err) {
      setAppointmentError(err.message ?? 'Could not sync Google Calendar.')
    } finally {
      setAppointmentSyncing(false)
    }
  }

  return (
    <div className="page">
      <NavBar profile={profile} />

      {showProfileModal && (
        <ProfileIncompleteModal
          onFinish={() => navigate('/onboarding')}
          onDismiss={() => setProfileModalDismissed(true)}
        />
      )}

      <main className="dash">
        {/* ---------- Header row ---------- */}
        <div className="dash__head">
          <div>
            <p className="dash__greeting">{greeting}, {firstName}</p>
            <h1 className="dash__title">
              {pregnancy
                ? `Week ${pregnancy.currentWeek} · ${pregnancy.trimesterLabel} trimester`
                : 'Welcome to HeartToMom'}
            </h1>
          </div>
          <span className="pill pill--ok"><span className="pill__dot" />All readings normal</span>
        </div>

        {/* ---------- Due-date card ---------- */}
        <section className="card due">
          <div className="due__left">
            <p className="card__eyebrow">DUE DATE</p>
            <p className="due__date">
              {due ? formatDueDate(due) : 'None scheduled'}
            </p>
          </div>

          {due && pregnancy && (
            <div className="due__right">
              <p className="due__weeks">{pregnancy.weeksToGo} weeks to go</p>
              <p className="due__pct">{pregnancy.percent}% there</p>
            </div>
          )}

          {due && pregnancy && (
            <div className="track">
              <div className="track__bar">
                <div className="track__fill" style={{ width: `${pregnancy.percent}%` }} />
                <span className="track__tick" style={{ left: '32.5%' }} aria-hidden />
                <span className="track__tick" style={{ left: '67.5%' }} aria-hidden />
                <span
                  className="track__dot"
                  style={{ left: `calc(${pregnancy.percent}% - 8px)` }}
                  aria-hidden
                />
              </div>
              <div className="track__labels">
                <span>Trimester 1</span>
                <span>Trimester 2</span>
                <span>Trimester 3</span>
                <span>Delivery</span>
              </div>
            </div>
          )}
        </section>

        {/* ---------- Two-column grid ---------- */}
        <div className="dash__grid">
          {/* LEFT — Appointments */}
          <section className="card appts">
            <div className="appts__head">
              <h2 className="card__title">Upcoming appointments</h2>
              <button
                className="appts__add"
                onClick={() => setAppointmentModalOpen(true)}
                aria-label="Add appointment"
              >
                +
              </button>
            </div>

            <MonthCalendar appointments={calendarAppointments} />

            <div className="appt-sections">
              {loading ? (
                <p className="appt-list__empty">Loading…</p>
              ) : calendarAppointments.length === 0 ? (
                <p className="appt-list__empty">No upcoming appointments</p>
              ) : (
                <>
                  <AppointmentSection
                    title="Booked"
                    empty="No booked appointments yet"
                    appointments={bookedAppointments.slice(0, 4)}
                  />
                  <AppointmentSection
                    title="Recommended appointments"
                    empty="No recommendations right now"
                    appointments={recommendedUpcoming.slice(0, 4)}
                  />
                </>
              )}
            </div>
          </section>

          {/* RIGHT — stacked cards */}
          <div className="dash__right">
            <section className="card vitals">
              <div className="card__head">
                <h2 className="card__title card__title--sm">Today’s vitals</h2>
                <span className="vitals__sync">
                  <span className="vitals__sync-dot" />
                  {latestVital ? `synced ${timeAgo(latestVital.recorded_at)}` : 'no data yet'}
                </span>
              </div>
              <div className="vitals__grid">
                <Stat
                  label="BLOOD PRESSURE"
                  value={latestVital ? `${latestVital.systolic}` : '—'}
                  unit={latestVital ? `/${latestVital.diastolic}` : ''}
                />
                <Stat
                  label="HEART RATE"
                  value={latestVital ? `${latestVital.heart_rate}` : '—'}
                  unit={latestVital ? 'bpm' : ''}
                />
              </div>
            </section>

            <section className="card wearable-status">
              <div>
                <p className="card__eyebrow">WEARABLE SYNC</p>
                <h2 className="wearable-status__title">
                  {wearableProvider || 'No device connected'}
                </h2>
                <p className="wearable-status__meta">{syncLabel}</p>
              </div>
              <button className="wearable-status__btn" onClick={() => navigate('/sync-wearable')}>
                {wearableProvider ? 'Manage sync' : 'Connect device'}
              </button>
            </section>

            <section className="card risk">
              <h2 className="card__title card__title--sm">Risk score</h2>
              <p className={`risk__value risk__value--${latestCheckIn?.risk_score ?? 'none'}`}>
                {latestCheckIn?.risk_score
                  ? capitalize(latestCheckIn.risk_score)
                  : 'No data'}
                {latestCheckIn?.risk_score && (
                  <span className="risk__trend"> ↓ from last week</span>
                )}
              </p>
              <div className={`risk__bar risk__bar--${latestCheckIn?.risk_score ?? 'none'}`}>
                <div className="risk__bar-fill" />
              </div>
              <p className="risk__note">
                {latestCheckIn
                  ? 'Based on yesterday’s questionnaire and 7-day vitals trend.'
                  : 'Complete a daily check-in to see your risk trend.'}
              </p>
            </section>

            <section className="card checkin">
              <h2 className="card__title card__title--sm">Daily check-in</h2>
              <p className="checkin__sub">Takes about 90 seconds</p>
              <button className="checkin__btn" onClick={() => navigate('/track-health')}>
                Start questionnaire →
              </button>
            </section>
          </div>
        </div>
      </main>

      {appointmentModalOpen && (
        <AppointmentModal
          error={appointmentError}
          syncing={appointmentSyncing}
          onAdd={addAppointment}
          onSync={syncGoogleCalendar}
          onClose={() => {
            setAppointmentModalOpen(false)
            setAppointmentError('')
          }}
        />
      )}
    </div>
  )
}

/* ---------------------------------- Bits ---------------------------------- */

function AppointmentRow({ appt }) {
  const date = new Date(appt.scheduled_at)
  const monthDay = `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const tag = appt.recommended ? 'suggested' : appt.required ? 'required' : appt.suggested ? 'suggested' : 'normal'

  return (
    <li className={`appt appt--${tag}`}>
      <span className="appt__bar" aria-hidden />
      <div className="appt__body">
        <p className="appt__title">{appt.title}</p>
        <p className="appt__meta">
          {monthDay} · {time}{appt.provider ? ` · ${appt.provider}` : appt.location ? ` · ${appt.location}` : ''}
        </p>
      </div>
      {(tag !== 'normal' || appt.recommended) && (
        <span className={`pill pill--${tag}`}>{appt.recommended ? 'Recommended' : capitalize(tag)}</span>
      )}
    </li>
  )
}

function AppointmentSection({ title, empty, appointments }) {
  return (
    <section className="appt-section">
      <div className="appt-section__head">
        <h3>{title}</h3>
        <span>{appointments.length}</span>
      </div>
      {appointments.length === 0 ? (
        <p className="appt-section__empty">{empty}</p>
      ) : (
        <ul className="appt-list">
          {appointments.map((appt) => (
            <AppointmentRow key={appt.id} appt={appt} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AppointmentModal({ error, syncing, onAdd, onSync, onClose }) {
  const [mode, setMode] = useState('manual')
  const [form, setForm] = useState({
    title: '',
    provider: '',
    location: '',
    date: '',
    time: '',
    kind: 'booked',
  })
  const [saving, setSaving] = useState(false)

  const canSave = form.title.trim() && form.date && form.time
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    const ok = await onAdd({
      ...form,
      scheduled_at: new Date(`${form.date}T${form.time}`).toISOString(),
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="appointment-modal-title">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__card appt-modal">
        <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="appointment-modal-title" className="modal__title">Add appointment</h2>

        <div className="appt-modal__tabs">
          <button className={mode === 'manual' ? 'is-active' : ''} onClick={() => setMode('manual')}>Add manually</button>
          <button className={mode === 'sync' ? 'is-active' : ''} onClick={() => setMode('sync')}>Sync to calendar</button>
        </div>

        {mode === 'manual' ? (
          <div className="appt-form">
            <label>
              <span>Appointment title</span>
              <input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Prenatal checkup" />
            </label>
            <label>
              <span>Provider</span>
              <input value={form.provider} onChange={(e) => update('provider', e.target.value)} placeholder="Dr. Lee" />
            </label>
            <label>
              <span>Location</span>
              <input value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Clinic or telehealth" />
            </label>
            <div className="appt-form__row">
              <label>
                <span>Date</span>
                <input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} />
              </label>
              <label>
                <span>Time</span>
                <input type="time" value={form.time} onChange={(e) => update('time', e.target.value)} />
              </label>
            </div>
            <label>
              <span>Type</span>
              <select value={form.kind} onChange={(e) => update('kind', e.target.value)}>
                <option value="booked">Booked</option>
                <option value="required">Booked · required</option>
                <option value="suggested">Booked · suggested</option>
              </select>
            </label>
            {error && <p className="appt-modal__error">{error}</p>}
            <div className="modal__actions">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={!canSave || saving} onClick={submit}>
                {saving ? 'Saving…' : 'Add appointment'}
              </button>
            </div>
          </div>
        ) : (
          <div className="appt-sync">
            <div className="appt-sync__mark" aria-hidden>G</div>
            <h3>Sync Google Calendar</h3>
            <p>Connect your Google Calendar to bring upcoming prenatal visits into HeartToMom.</p>
            <button className="btn-primary" onClick={onSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Google Calendar'}
            </button>
            {error && <p className="appt-modal__error">{error}</p>}
            <p className="appt-sync__note">Demo sync imports two upcoming appointments from Google Calendar.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, unit }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className="stat__value">
        <span>{value}</span>
        {unit && <span className="stat__unit">{unit}</span>}
      </p>
    </div>
  )
}

function MonthCalendar({ appointments }) {
  const today = new Date()
  const [{ year, month }, setYM] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  })

  // Bounds: ±12 months from "today" (the day the component first mounted)
  const minStamp = today.getFullYear() * 12 + today.getMonth() - 12
  const maxStamp = today.getFullYear() * 12 + today.getMonth() + 12
  const curStamp = year * 12 + month

  const shift = (delta) => {
    const next = curStamp + delta
    if (next < minStamp || next > maxStamp) return
    const y = Math.floor(next / 12)
    const m = next - y * 12
    setYM({ year: y, month: m })
  }

  const canPrev = curStamp > minStamp
  const canNext = curStamp < maxStamp

  const first = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0).getDate()
  const startWeekday = first.getDay() // 0 = Sun

  // Build 6×7 grid (42 cells), padded with prev/next month's tail.
  const cells = []
  const prevLast = new Date(year, month, 0).getDate()
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ day: prevLast - i, inMonth: false })
  }
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ day: d, inMonth: true })
  }
  while (cells.length < 42) {
    cells.push({ day: cells.length - lastDay - startWeekday + 1, inMonth: false })
  }

  // Map day → highest-priority appt class
  const dayTags = {}
  for (const a of appointments) {
    const d = new Date(a.scheduled_at)
    if (d.getFullYear() !== year || d.getMonth() !== month) continue
    const tag = a.required ? 'required' : a.suggested ? 'suggested' : 'normal'
    const existing = dayTags[d.getDate()]
    if (!existing || rank(tag) > rank(existing)) dayTags[d.getDate()] = tag
  }

  return (
    <div className="cal">
      <div className="cal__nav">
        <button
          className="cal__arrow"
          onClick={() => shift(-1)}
          disabled={!canPrev}
          aria-label="Previous month"
        >‹</button>
        <span className="cal__title">{MONTHS[month]} {year}</span>
        <button
          className="cal__arrow"
          onClick={() => shift(1)}
          disabled={!canNext}
          aria-label="Next month"
        >›</button>
      </div>
      <div className="cal__head">
        {WEEKDAYS.map((d, i) => (<span key={i}>{d}</span>))}
      </div>
      <div className="cal__grid">
        {cells.map((c, i) => {
          const tag = c.inMonth ? dayTags[c.day] : null
          return (
            <span
              key={i}
              className={[
                'cal__day',
                !c.inMonth && 'cal__day--muted',
                tag && `cal__day--${tag}`,
              ].filter(Boolean).join(' ')}
            >
              {c.day}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function ProfileIncompleteModal({ onFinish, onDismiss }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
      <div className="modal__backdrop" onClick={onDismiss} />
      <div className="modal__card">
        <button className="modal__close" onClick={onDismiss} aria-label="Close">×</button>
        <span className="modal__emoji" aria-hidden>🌸</span>
        <h2 id="profile-modal-title" className="modal__title">Finish your health profile</h2>
        <p className="modal__lede">
          A few more details unlocks personalized risk monitoring,
          smarter appointment suggestions, and a more accurate due-date timeline.
        </p>
        <div className="modal__actions">
          <button className="btn-ghost" onClick={onDismiss}>Maybe later</button>
          <button className="btn-primary" onClick={onFinish}>Finish profile →</button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------- Helpers -------------------------------- */

async function supabaseInsertAppointment(appointment) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .insert(appointment)
      .select('*')
      .single()
    return { data, error }
  } catch (error) {
    return { data: null, error }
  }
}

function buildRecommendedAppointments() {
  return RECOMMENDED_APPOINTMENTS.map((appt) => ({
    id: appt.id,
    title: appt.title,
    provider: appt.provider,
    scheduled_at: appointmentDate(appt.daysFromNow, 9).toISOString(),
    required: appt.required,
    suggested: appt.suggested,
    recommended: true,
  }))
}

function mergeAppointments(...groups) {
  const seen = new Set()
  return groups
    .flat()
    .filter(Boolean)
    .filter((appt) => {
      const key = `${appt.title}-${appt.scheduled_at}-${appt.provider ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
}

function appointmentDate(daysFromNow, hour) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  date.setHours(hour, 0, 0, 0)
  return date
}

function rank(tag) { return tag === 'required' ? 3 : tag === 'suggested' ? 2 : 1 }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

function greetingForHour(h) {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatDueDate(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function calculatePregnancy(due) {
  if (!due) return null
  const now = new Date()
  const msLeft = due - now
  if (msLeft <= 0) return null
  const weeksToGo = Math.max(0, Math.ceil(msLeft / MS_PER_WEEK))
  const currentWeek = Math.max(1, Math.min(TOTAL_WEEKS, TOTAL_WEEKS - weeksToGo))
  const percent = Math.round((currentWeek / TOTAL_WEEKS) * 100)
  const trimesterLabel =
    currentWeek <= 13 ? 'First' : currentWeek <= 27 ? 'Second' : 'Third'
  return { weeksToGo, currentWeek, percent, trimesterLabel }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
