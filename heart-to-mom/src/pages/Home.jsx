import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { useDashboardData } from '../lib/useDashboardData.js'
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

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile, appointments, latestVital, latestCheckIn, loading } = useDashboardData()
  const [profileModalDismissed, setProfileModalDismissed] = useState(false)

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
            <h2 className="card__title">Upcoming appointments</h2>

            <MonthCalendar appointments={appointments} />

            <ul className="appt-list">
              {loading ? (
                <li className="appt-list__empty">Loading…</li>
              ) : appointments.length === 0 ? (
                <li className="appt-list__empty">No upcoming appointments</li>
              ) : (
                appointments.slice(0, 4).map((a) => (
                  <AppointmentRow key={a.id} appt={a} />
                ))
              )}
            </ul>
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
    </div>
  )
}

/* ---------------------------------- Bits ---------------------------------- */

function AppointmentRow({ appt }) {
  const date = new Date(appt.scheduled_at)
  const monthDay = `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const tag = appt.required ? 'required' : appt.suggested ? 'suggested' : 'normal'

  return (
    <li className={`appt appt--${tag}`}>
      <span className="appt__bar" aria-hidden />
      <div className="appt__body">
        <p className="appt__title">{appt.title}</p>
        <p className="appt__meta">
          {monthDay} · {time}{appt.provider ? ` · ${appt.provider}` : appt.location ? ` · ${appt.location}` : ''}
        </p>
      </div>
      {tag !== 'normal' && (
        <span className={`pill pill--${tag}`}>{capitalize(tag)}</span>
      )}
    </li>
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
