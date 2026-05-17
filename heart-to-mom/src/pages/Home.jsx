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

// Per-condition recommendation templates. The function below picks ones that
// match the latest AI risk assessment.
const CONDITION_RECS = {
  cardiovascular: {
    high:     { title: 'Cardiology consult',           daysFromNow: 2,  hour: 10, urgent: true  },
    moderate: { title: 'Heart-rate baseline visit',    daysFromNow: 10, hour: 10, urgent: false },
  },
  preeclampsia: {
    high:     { title: 'Urgent BP monitoring visit',   daysFromNow: 2,  hour: 9,  urgent: true  },
    moderate: { title: 'Blood pressure review',        daysFromNow: 7,  hour: 9,  urgent: false },
  },
  gestational: {
    high:     { title: 'Glucose tolerance test',       daysFromNow: 3,  hour: 8,  urgent: true  },
    moderate: { title: 'Glucose screening',            daysFromNow: 10, hour: 8,  urgent: false },
  },
  preterm: {
    high:     { title: 'Preterm labor evaluation',     daysFromNow: 2,  hour: 11, urgent: true  },
    moderate: { title: 'Cervical length check',        daysFromNow: 12, hour: 11, urgent: false },
  },
  stillbirth: {
    high:     { title: 'Fetal monitoring (NST/BPP)',   daysFromNow: 1,  hour: 14, urgent: true  },
    moderate: { title: 'Extra growth ultrasound',      daysFromNow: 10, hour: 14, urgent: false },
  },
  postpartum: {
    high:     { title: 'Mental health check-in',       daysFromNow: 3,  hour: 13, urgent: true  },
    moderate: { title: 'Prenatal counseling visit',    daysFromNow: 14, hour: 13, urgent: false },
  },
}

// Always-available "evergreen" recs shown when AI has nothing to flag.
const EVERGREEN_RECS = [
  { id: 'evergreen-prenatal', title: 'Routine prenatal checkup', daysFromNow: 14, hour: 10, urgent: false },
]

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile, appointments, latestVital, latestCheckIn, latestAssessment, loading } = useDashboardData()
  const [profileModalDismissed, setProfileModalDismissed] = useState(false)
  const [localAppointments, setLocalAppointments] = useState([])
  const [deletedAppointmentIds, setDeletedAppointmentIds] = useState(() => new Set())
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [appointmentSyncing, setAppointmentSyncing] = useState(false)
  const [appointmentError, setAppointmentError] = useState('')

  // Show the "finish your health profile" modal whenever the user
  // hasn't completed onboarding (incl. when their profile row is missing entirely).
  // Also honor a local fallback flag for users whose DB write of
  // onboarding_completed silently failed (e.g. schema not migrated yet).
  const localCompletedFlag =
    typeof window !== 'undefined' && user
      ? !!window.localStorage.getItem(`htm:onboardingDone:${user.id}`)
      : false

  const showProfileModal =
    !loading
    && !!user
    && !profile?.onboarding_completed
    && !localCompletedFlag
    && !profileModalDismissed

  // Reset dismissal whenever the profile changes (e.g. user just completed it)
  useEffect(() => {
    if (!profile?.onboarding_completed) return undefined
    const timer = window.setTimeout(() => setProfileModalDismissed(false), 0)
    return () => window.clearTimeout(timer)
  }, [profile?.onboarding_completed])

  // Reset per-user local state whenever the signed-in user changes, so a
  // previous account's locally-added or locally-deleted appointments don't
  // bleed into the next session.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocalAppointments([])
      setDeletedAppointmentIds(new Set())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user?.id])

  const firstName =
    profile?.full_name?.split(' ')[0] ??
    user?.user_metadata?.full_name?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there'

  const [renderTimeMs] = useState(() => Date.now())
  const greeting = greetingForHour(new Date(renderTimeMs).getHours())

  const due = profile?.due_date ? new Date(profile.due_date) : null
  // Postpartum either via explicit profile flag OR a due-date in the past.
  const isPostpartum = !!profile?.is_postpartum || (due != null && due.getTime() < renderTimeMs)
  const pregnancy = isPostpartum ? null : calculatePregnancy(due)
  const wearableProvider = profile?.wearable_provider
  const syncLabel = latestVital
    ? `Last reading ${timeAgo(latestVital.recorded_at)}`
    : wearableProvider
      ? 'Waiting for first reading'
      : 'Not connected'
  const recommendedAppointments = buildRecommendedAppointments(latestAssessment, user?.id)
  const visibleSupabaseAppointments = (appointments ?? []).filter((a) => !deletedAppointmentIds.has(a.id))
  const visibleLocalAppointments    = localAppointments.filter((a) => !deletedAppointmentIds.has(a.id))
  const calendarAppointments = mergeAppointments(visibleSupabaseAppointments, visibleLocalAppointments, recommendedAppointments)
  const bookedAppointments = calendarAppointments.filter((appt) => !appt.recommended)
  // Once a recommendation has been added to the calendar (matched by title),
  // hide it from the "Recommended by AI" section.
  const bookedTitles = new Set(bookedAppointments.map((a) => a.title?.toLowerCase()))
  const recommendedUpcoming = calendarAppointments.filter(
    (appt) => appt.recommended && !bookedTitles.has(appt.title?.toLowerCase())
  )

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

  // Delete a booked appointment from Supabase + local state.
  const deleteAppointment = async (appt) => {
    setAppointmentError('')
    if (!window.confirm(`Delete "${appt.title}"?`)) return

    // Try to delete from Supabase first (only if it has a real id)
    if (appt.id && !String(appt.id).startsWith('local-') && !String(appt.id).startsWith('google-')) {
      const { error } = await supabase.from('appointments').delete().eq('id', appt.id)
      if (error) {
        setAppointmentError(error.message ?? 'Could not delete appointment.')
        return
      }
    }
    // Mark as deleted so it disappears from all merged lists immediately
    setDeletedAppointmentIds((prev) => new Set(prev).add(appt.id))
    // Also drop from localAppointments so the booked-titles set updates correctly
    setLocalAppointments((current) => current.filter((a) => a.id !== appt.id))
  }

  // Add a recommended appointment to the user's in-app calendar (Supabase).
  const addRecommendedToCalendar = async (rec) => {
    await addAppointment({
      title: rec.title,
      provider: rec.provider ?? 'Recommended',
      location: rec.location ?? '',
      scheduled_at: rec.scheduled_at,
      kind: rec.required ? 'required' : (rec.suggested ? 'suggested' : 'normal'),
    })
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
              {isPostpartum
                ? 'Congrats on your bundle of joy 🎉'
                : pregnancy
                  ? `Week ${pregnancy.currentWeek} · ${pregnancy.trimesterLabel} trimester`
                  : 'Welcome to HeartToMom'}
            </h1>
          </div>
          <span className="pill pill--ok"><span className="pill__dot" />All readings normal</span>
        </div>

        {/* ---------- Due-date / delivery card ---------- */}
        <section className="card due">
          <div className="due__left">
            <p className="card__eyebrow">{isPostpartum ? 'DELIVERY DATE' : 'DUE DATE'}</p>
            <p className="due__date">
              {due ? formatDueDate(due) : 'None scheduled'}
            </p>
          </div>

          {isPostpartum && (
            <div className="due__right">
              <p className="due__pct">Delivered ✓</p>
            </div>
          )}

          {!isPostpartum && due && pregnancy && (
            <div className="due__right">
              <p className="due__weeks">{pregnancy.weeksToGo} weeks to go</p>
              <p className="due__pct">{pregnancy.percent}% there</p>
            </div>
          )}

          {isPostpartum && (
            <div className="track">
              <div className="track__bar">
                <div className="track__fill" style={{ width: '100%' }} />
                <span className="track__tick" style={{ left: '32.5%' }} aria-hidden />
                <span className="track__tick" style={{ left: '67.5%' }} aria-hidden />
                <span className="track__check" aria-hidden>✓</span>
              </div>
              <div className="track__labels">
                <span>Trimester 1</span>
                <span>Trimester 2</span>
                <span>Trimester 3</span>
                <span>Delivered</span>
              </div>
              <button
                className="btn-primary track__postpartum-btn"
                onClick={() => navigate('/prepare')}
              >
                Check out postpartum resources →
              </button>
            </div>
          )}

          {!isPostpartum && due && pregnancy && (
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
                    onDelete={deleteAppointment}
                  />
                  <AppointmentSection
                    title="Recommended by AI"
                    empty="No recommendations right now"
                    appointments={recommendedUpcoming.slice(0, 4)}
                    onAdd={addRecommendedToCalendar}
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
              <p className={`risk__value risk__value--${latestAssessment?.overall_risk ?? 'none'}`}>
                {latestAssessment
                  ? capitalize(latestAssessment.overall_risk)
                  : 'No data'}
                {latestAssessment && (
                  <span className="risk__trend"> · {latestAssessment.overall_score}/100</span>
                )}
              </p>
              <div className={`risk__bar risk__bar--${latestAssessment?.overall_risk ?? 'none'}`}>
                <div
                  className="risk__bar-fill"
                  style={latestAssessment ? { width: `${latestAssessment.overall_score}%` } : undefined}
                />
              </div>
              <p className="risk__note">
                {latestAssessment
                  ? (latestAssessment.summary ?? 'AI-generated assessment based on your latest data.')
                  : 'Complete your health profile or a daily check-in to generate your first assessment.'}
              </p>
            </section>

            <section className="card checkin">
              <h2 className="card__title card__title--sm">Daily check-in</h2>
              <p className="checkin__sub">
                {isCheckInRecent(latestCheckIn)
                  ? 'Submitted recently — you can edit it'
                  : 'Takes about 90 seconds'}
              </p>
              <button className="checkin__btn" onClick={() => navigate('/track-health')}>
                {isCheckInRecent(latestCheckIn) ? 'Edit check-in →' : 'Start questionnaire →'}
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

function AppointmentRow({ appt, onAdd, onDelete }) {
  const date = new Date(appt.scheduled_at)
  const monthDay = `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  // Distinct visual tag — recommendations are no longer collapsed into 'suggested'
  const tag = appt.recommended
    ? (appt.required ? 'rec-urgent' : 'rec')
    : appt.required ? 'required' : appt.suggested ? 'suggested' : 'normal'

  const chipLabel =
    tag === 'rec-urgent' ? 'AI · Urgent' :
    tag === 'rec'        ? 'AI · Recommended' :
    capitalize(tag)

  return (
    <li className={`appt appt--${tag}`}>
      <span className="appt__bar" aria-hidden />
      <div className="appt__body">
        <p className="appt__title">{appt.title}</p>
        <p className="appt__meta">
          {monthDay} · {time}{appt.provider ? ` · ${appt.provider}` : appt.location ? ` · ${appt.location}` : ''}
        </p>
        {appt.recommended && appt.reason && (
          <p className="appt__reason">{appt.reason}</p>
        )}
      </div>

      <div className="appt__actions">
        {(tag !== 'normal' || appt.recommended) && !appt.recommended && (
          <span className={`pill pill--${tag}`}>{chipLabel}</span>
        )}

        {appt.recommended && onAdd && (
          <button className="appt__add-btn" onClick={() => onAdd(appt)}>
            Add to calendar
          </button>
        )}

        {!appt.recommended && onDelete && (
          <button
            className="appt__delete-btn"
            onClick={() => onDelete(appt)}
            aria-label={`Delete ${appt.title}`}
            title="Delete appointment"
          >
            ×
          </button>
        )}
      </div>
    </li>
  )
}

function AppointmentSection({ title, empty, appointments, onAdd, onDelete }) {
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
            <AppointmentRow key={appt.id} appt={appt} onAdd={onAdd} onDelete={onDelete} />
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
    const tag = a.recommended
      ? (a.required ? 'rec-urgent' : 'rec')
      : a.required ? 'required' : a.suggested ? 'suggested' : 'normal'
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
          const isToday =
            c.inMonth
            && year === today.getFullYear()
            && month === today.getMonth()
            && c.day === today.getDate()
          return (
            <span
              key={i}
              className={[
                'cal__day',
                !c.inMonth && 'cal__day--muted',
                isToday && 'cal__day--today',
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

function buildRecommendedAppointments(latestAssessment, userId) {
  // Don't generate recs at all without a user — prevents any cross-session leakage.
  if (!userId) return []

  const uid = String(userId).slice(0, 8) // short prefix is enough for React key uniqueness

  // Map each elevated condition to a concrete appointment suggestion.
  const conditionRecs = []
  for (const c of latestAssessment?.conditions ?? []) {
    const key = matchConditionKey(c.name)
    if (!key) continue
    const tmpl = CONDITION_RECS[key]?.[c.risk_level]
    if (!tmpl) continue
    conditionRecs.push({
      id: `rec-${uid}-${key}-${c.risk_level}`,
      title: tmpl.title,
      provider: 'Recommended by AI',
      reason: `Based on your ${c.risk_level} ${c.name} score`,
      scheduled_at: appointmentDate(tmpl.daysFromNow, tmpl.hour).toISOString(),
      required: tmpl.urgent,
      suggested: !tmpl.urgent,
      recommended: true,
    })
  }

  // Fall back to evergreen recs if there's nothing risk-based to suggest
  if (conditionRecs.length === 0) {
    return EVERGREEN_RECS.map((appt) => ({
      id: `rec-${uid}-${appt.id}`,
      title: appt.title,
      provider: 'Recommended',
      reason: 'Routine pregnancy care',
      scheduled_at: appointmentDate(appt.daysFromNow, appt.hour).toISOString(),
      required: false,
      suggested: true,
      recommended: true,
    }))
  }

  return conditionRecs
}

function matchConditionKey(name) {
  if (!name) return null
  const n = name.toLowerCase()
  if (n.includes('cardiovascular')) return 'cardiovascular'
  if (n.includes('preeclampsia'))   return 'preeclampsia'
  if (n.includes('gestational') || n.includes('diabetes')) return 'gestational'
  if (n.includes('preterm'))        return 'preterm'
  if (n.includes('stillbirth'))     return 'stillbirth'
  if (n.includes('postpartum') || n.includes('depression')) return 'postpartum'
  return null
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


function isCheckInRecent(checkIn) {
  if (!checkIn?.created_at) return false
  const TWELVE_HOURS = 12 * 60 * 60 * 1000
  return Date.now() - new Date(checkIn.created_at).getTime() < TWELVE_HOURS
}

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
