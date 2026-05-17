import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import RiskScoreCard from '../components/RiskScoreCard.jsx'
import RiskTrendChart from '../components/RiskTrendChart.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { triggerRiskAssessment } from '../lib/useRiskAssessment.js'
import './pages-common.css'
import './TrackHealth.css'

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

const QUESTIONS = [
  { id: 'mood',     label: 'How are you feeling today?',    options: ['Great', 'Okay', 'Tired', 'Unwell'] },
  { id: 'movement', label: 'Have you felt baby movement?',  options: ['Yes, normal', 'Less than usual', 'No movement today', 'Postpartum (delivered)', 'N/A'] },
  { id: 'symptoms', label: 'Any new symptoms? (select all that apply)', options: ['None', 'Headache', 'Nausea', 'Swelling', 'Spotting', 'Cramping', 'Shortness of breath', 'Sweating', 'Fainting', 'Persistent sadness'], multi: true },
  { id: 'sleep',    label: 'How did you sleep?',            options: ['Well', 'Okay', 'Poorly'] },
  { id: 'meds',     label: 'Took your prenatal today?',     options: ['Yes', 'Not yet', 'Forgot'] },
]

export default function TrackHealth() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [latestAssessment, setLatestAssessment] = useState(null)
  const [trendAssessments, setTrendAssessments] = useState([])
  const [latestCheckIn, setLatestCheckIn] = useState(null)
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [assessmentSignal, setAssessmentSignal] = useState(0)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
    supabase.from('risk_assessments').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setLatestAssessment(data ?? null))

    // Fetch the last 30 days of assessments for the trend chart (oldest → newest)
    const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    supabase.from('risk_assessments')
      .select('created_at, overall_score, overall_risk')
      .eq('user_id', user.id)
      .gte('created_at', THIRTY_DAYS_AGO)
      .order('created_at', { ascending: true })
      .then(({ data }) => setTrendAssessments(data ?? []))

    // Pull the most recent check-in. If it's within the 12-hour cooldown,
    // pre-fill the form with its answers and switch to edit mode.
    supabase.from('check_ins').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        setLatestCheckIn(data ?? null)
        if (data && isRecent(data) && data.answers) {
          setAnswers(normalizeAnswers(data.answers))
        }
      })
  }, [user, assessmentSignal])

  // The movement answer the form should DISPLAY (and submit), computed every
  // render from profile.is_postpartum so it can never go out of sync.
  const effectiveMovement = profile?.is_postpartum
    ? 'Postpartum (delivered)'
    : (answers.movement === 'Postpartum (delivered)' || !answers.movement)
      ? 'N/A'
      : answers.movement

  const editMode = latestCheckIn && isRecent(latestCheckIn)

  const allAnswered = QUESTIONS.every((q) => {
    const v = answers[q.id]
    return q.multi ? Array.isArray(v) && v.length > 0 : !!v
  })

  const toggleAnswer = (q, opt) => {
    setSavedMsg('')
    if (q.multi) {
      setAnswers((a) => {
        const current = Array.isArray(a[q.id]) ? a[q.id] : []
        // "None" is mutually exclusive with everything else
        if (opt === 'None') return { ...a, [q.id]: current.includes('None') ? [] : ['None'] }
        const without_none = current.filter((x) => x !== 'None')
        const next = without_none.includes(opt)
          ? without_none.filter((x) => x !== opt)
          : [...without_none, opt]
        return { ...a, [q.id]: next }
      })
    } else {
      setAnswers((a) => ({ ...a, [q.id]: opt }))
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setSavedMsg('')
    try {
      // Use effective movement (forced to "Postpartum (delivered)" when postpartum)
      // so the saved answer always matches the user's current status.
      const submitAnswers = { ...answers, movement: effectiveMovement }
      const risk = deriveRisk(submitAnswers)
      const payload = { user_id: user.id, answers: submitAnswers, risk_score: risk }

      if (editMode) {
        await supabase
          .from('check_ins')
          .update(payload)
          .eq('id', latestCheckIn.id)
      } else {
        await supabase.from('check_ins').insert(payload)
      }

      // Kick off the AI assessment based on the new/updated check-in.
      setAnalyzing(true)
      const result = await triggerRiskAssessment('check_in')
      setAnalyzing(false)
      if (!result.ok) {
        console.warn('Risk assessment failed:', result.error)
      } else if (result.data) {
        // Update the UI immediately from the response, so the donut/trend
        // reflect the new score without waiting for a refetch.
        const fresh = { ...result.data, created_at: result.data.generated_at }
        setLatestAssessment(fresh)
        setTrendAssessments((prev) => [...prev, fresh])
      }

      // Refresh local state so editMode reflects the new check-in,
      // and as a safety net re-fetches everything from the DB.
      setAssessmentSignal((n) => n + 1)
      setSubmitted(true)
    } catch (err) {
      console.warn('Check-in submit failed:', err)
      setSavedMsg('Could not save. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const nextWindow = latestCheckIn?.created_at
    ? new Date(new Date(latestCheckIn.created_at).getTime() + TWELVE_HOURS_MS)
    : null

  const exportProviderReport = () => {
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setSavedMsg('Could not open the export window. Please allow pop-ups and try again.')
      return
    }

    reportWindow.document.write(buildProviderReportHtml({
      assessment: latestAssessment,
      trendAssessments,
      profile,
    }))
    reportWindow.document.close()
    reportWindow.focus()
    setTimeout(() => reportWindow.print(), 250)
  }

  return (
    <div className="page">
      <NavBar profile={profile} />

      <main className="page__main">
        <header className="page__head">
          <p className="page__eyebrow">YOUR HEALTH</p>
          <h1 className="page__title">Track your health</h1>
          <p className="page__lede">
            See what's driving your risk score and complete your daily check-in.
          </p>
        </header>

        {/* Risk score breakdown — donut + factor bars driven by the latest AI assessment */}
        <RiskScoreCard assessment={latestAssessment} />

        <p className="th__disclaimer">
          Powered by Gemini AI · Always consult your provider.
        </p>

        <div className="th__grid">
          {/* Daily questionnaire */}
          <section className="card th__quiz">
            <div className="card__head">
              <h2 className="card__title">Daily check-in</h2>
              <span className="card__sub">
                {editMode
                  ? `Editing today's check-in · next window opens ${nextWindow?.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
                  : '~90 seconds'}
              </span>
            </div>

            {submitted ? (
              <div className="th__done">
                <p className="th__done-emoji" aria-hidden>✓</p>
                <p className="th__done-title">
                  {editMode ? 'Updated — risk assessment refreshed.' : 'Thanks — check-in saved.'}
                </p>
                <p className="th__done-note">Your risk score has been updated above.</p>
                <button
                  type="button"
                  className="btn-ghost th__edit-again"
                  onClick={() => setSubmitted(false)}
                >
                  Edit check-in
                </button>
              </div>
            ) : (
              <>
                <div className="th__quiz-list">
                  {QUESTIONS.map((q) => (
                    <div key={q.id} className="th__quiz-q">
                      <p className="th__quiz-label">{q.label}</p>
                      <div className="th__quiz-options">
                        {q.options.map((opt) => {
                          // For the movement question, use the effective value
                          // (forced to "Postpartum (delivered)" when postpartum).
                          const v = q.id === 'movement' ? effectiveMovement : answers[q.id]
                          const isSelected = q.multi
                            ? Array.isArray(v) && v.includes(opt)
                            : v === opt
                          // Disable non-postpartum options when user is postpartum
                          const disabled =
                            q.id === 'movement'
                            && profile?.is_postpartum
                            && opt !== 'Postpartum (delivered)'
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={disabled}
                              className={`pill-btn ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => toggleAnswer(q, opt)}
                            >
                              {opt}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  className="btn-primary th__submit"
                  disabled={!allAnswered || submitting || analyzing}
                  onClick={submit}
                >
                  {analyzing
                    ? 'Analyzing your data…'
                    : submitting
                      ? 'Saving…'
                      : editMode
                        ? 'Update check-in'
                        : 'Submit check-in'}
                </button>

                {savedMsg && (
                  <p className={`th__saved ${savedMsg.startsWith('Could not') ? 'th__saved--error' : ''}`}>
                    {savedMsg}
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <div className="th__bottom-grid">
          {/* 30-day trend line — placed last so users see it after submitting */}
          <RiskTrendChart assessments={trendAssessments} />

          <section className="card th__provider-export">
            <div>
              <h2 className="card__title">Provider export</h2>
              <p className="th__provider-copy">
                Download a PDF-ready report with your current score, score breakdown,
                and 30-day risk trend for your healthcare provider.
              </p>
            </div>

            <button
              type="button"
              className="btn-primary th__export-provider"
              onClick={exportProviderReport}
            >
              Export to your healthcare provider
            </button>
          </section>
        </div>
      </main>
    </div>
  )
}

/* ---------------------------- helpers ---------------------------- */

function isRecent(checkIn) {
  if (!checkIn?.created_at) return false
  return Date.now() - new Date(checkIn.created_at).getTime() < TWELVE_HOURS_MS
}

// Older check-ins stored 'symptoms' as a string; new ones store it as an array.
function normalizeAnswers(raw) {
  const out = { ...raw }
  for (const q of QUESTIONS) {
    if (!q.multi) continue
    const v = out[q.id]
    if (typeof v === 'string') out[q.id] = v ? [v] : []
    else if (!Array.isArray(v)) out[q.id] = []
  }
  return out
}

function deriveRisk(answers) {
  // Flag moderate/high based on any concerning answer (now handles arrays for multi-select).
  const high = ['No movement today', 'Spotting', 'Fainting']
  const moderate = [
    'Less than usual', 'Headache', 'Swelling', 'Cramping',
    'Shortness of breath', 'Sweating', 'Persistent sadness',
    'Poorly', 'Unwell',
  ]
  const values = Object.values(answers).flatMap((v) => (Array.isArray(v) ? v : [v]))
  if (values.some((v) => high.includes(v))) return 'high'
  if (values.some((v) => moderate.includes(v))) return 'moderate'
  return 'low'
}

function buildProviderReportHtml({ assessment, trendAssessments, profile }) {
  const generatedAt = new Date()
  const conditions = sortReportConditions(assessment?.conditions ?? [])
  const trend = getReportTrendPoints(trendAssessments)
  const score = typeof assessment?.overall_score === 'number' ? assessment.overall_score : null
  const risk = assessment?.overall_risk ? cap(assessment.overall_risk) : 'No assessment'
  const summary = assessment?.summary || 'No assessment summary is available yet.'
  const patientName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Patient'

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Risk score report</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; color: #2c2528; font-family: Inter, Arial, sans-serif; background: #fffaf4; }
    .sheet { max-width: 820px; margin: 0 auto; padding: 32px; background: #fff; border: 1px solid #eadfd7; border-radius: 8px; }
    .top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #eadfd7; padding-bottom: 18px; margin-bottom: 24px; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 6px; font-size: 28px; }
    h2 { margin-bottom: 14px; font-size: 18px; }
    .meta { color: #766b70; font-size: 13px; line-height: 1.5; text-align: right; }
    .grid { display: grid; grid-template-columns: 220px 1fr; gap: 24px; align-items: center; }
    .score { width: 180px; height: 180px; border-radius: 50%; border: 14px solid ${scoreColor(assessment?.overall_risk)}; display: grid; place-items: center; text-align: center; }
    .score strong { display: block; font-size: 34px; }
    .score span { display: block; color: #766b70; font-size: 13px; }
    .summary { color: #4b4246; line-height: 1.5; }
    .section { margin-top: 28px; }
    .conditions { display: grid; gap: 12px; }
    .condition { break-inside: avoid; padding: 12px; border: 1px solid #eadfd7; border-radius: 8px; }
    .condition-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; font-weight: 700; }
    .bar { height: 9px; border-radius: 999px; background: #f2ece7; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: inherit; }
    .reason { margin: 8px 0 0; color: #5f555a; font-size: 13px; line-height: 1.45; }
    .trend-card { padding: 16px; border: 1px solid #eadfd7; border-radius: 8px; }
    .trend-empty { color: #766b70; }
    .note { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eadfd7; color: #766b70; font-size: 12px; line-height: 1.45; }
    @page { margin: 0.45in; }
    @media print {
      body { padding: 0; background: #fff; }
      .sheet { border: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="top">
      <div>
        <h1>Risk Score Report</h1>
        <p class="summary">Prepared for healthcare provider review.</p>
      </div>
      <div class="meta">
        <strong>${escapeHtml(patientName)}</strong><br />
        Generated ${escapeHtml(generatedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}<br />
        Latest assessment ${escapeHtml(formatDateTime(assessment?.created_at || assessment?.generated_at))}
      </div>
    </header>

    <section class="grid">
      <div class="score">
        <div>
          <strong>${score == null ? '--' : escapeHtml(String(score))}</strong>
          <span>${escapeHtml(risk)} risk</span>
          <span>${score == null ? 'No score' : '/ 100'}</span>
        </div>
      </div>
      <div>
        <h2>Current score</h2>
        <p class="summary">${escapeHtml(summary)}</p>
      </div>
    </section>

    <section class="section">
      <h2>Risk trend - last 30 days</h2>
      <div class="trend-card">
        ${buildTrendSvg(trend)}
      </div>
    </section>

    <section class="section">
      <h2>Score breakdown</h2>
      <div class="conditions">
        ${conditions.length ? conditions.map(renderCondition).join('') : '<p class="trend-empty">No condition breakdown available.</p>'}
      </div>
    </section>

    <p class="note">
      This report summarizes app-generated risk information and is not a diagnosis.
      Please review alongside clinical judgment and the patient's full medical history.
    </p>
  </main>
</body>
</html>`
}

function renderCondition(c) {
  const score = Math.max(0, Math.min(100, c.score ?? 0))
  const level = c.risk_level || 'low'
  return `<article class="condition">
    <div class="condition-head">
      <span>${escapeHtml(c.name || 'Condition')}</span>
      <span>${escapeHtml(cap(level))} - ${escapeHtml(String(score))}/100</span>
    </div>
    <div class="bar"><div class="bar-fill" style="width: ${score}%; background: ${scoreColor(level)};"></div></div>
    ${c.reasoning ? `<p class="reason">${escapeHtml(c.reasoning)}</p>` : ''}
  </article>`
}

function buildTrendSvg(dayPoints) {
  if (dayPoints.length === 0) {
    return '<p class="trend-empty">No assessment trend is available yet.</p>'
  }

  const W = 720, H = 220, PAD_L = 38, PAD_R = 18, PAD_T = 18, PAD_B = 32
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const DAY_MS = 24 * 60 * 60 * 1000
  const today = startOfDay(new Date())
  const windowEnd = today.getTime()
  const windowStart = windowEnd - 29 * DAY_MS
  const projectX = (t) => PAD_L + ((Math.max(windowStart, Math.min(windowEnd, t)) - windowStart) / (29 * DAY_MS)) * innerW
  const projectY = (s) => PAD_T + (1 - Math.max(0, Math.min(100, s)) / 100) * innerH
  const points = dayPoints.map((a) => ({
    x: projectX(startOfDay(new Date(a.created_at)).getTime()),
    y: projectY(a.overall_score),
    score: a.overall_score,
    risk: a.overall_risk,
  }))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const yLow = projectY(33)
  const yHigh = projectY(66)

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="220" role="img" aria-label="Risk trend over the last 30 days">
    <rect x="${PAD_L}" y="${PAD_T}" width="${innerW}" height="${yHigh - PAD_T}" fill="#fae6e7" opacity="0.65" />
    <rect x="${PAD_L}" y="${yHigh}" width="${innerW}" height="${yLow - yHigh}" fill="#faf2dc" opacity="0.8" />
    <rect x="${PAD_L}" y="${yLow}" width="${innerW}" height="${PAD_T + innerH - yLow}" fill="#eaf1e3" opacity="0.8" />
    <text x="4" y="${PAD_T + 4}" font-size="11" fill="#766b70">100</text>
    <text x="8" y="${yHigh + 4}" font-size="11" fill="#766b70">66</text>
    <text x="8" y="${yLow + 4}" font-size="11" fill="#766b70">33</text>
    <text x="14" y="${PAD_T + innerH}" font-size="11" fill="#766b70">0</text>
    ${points.length > 1 ? `<path d="${path}" fill="none" stroke="#8a6d84" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />` : ''}
    ${points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#fff" stroke="${scoreColor(p.risk)}" stroke-width="2" />`).join('')}
    <text x="${PAD_L}" y="${H - 8}" font-size="11" fill="#766b70">${escapeHtml(formatShortDate(new Date(windowStart)))}</text>
    <text x="${W - PAD_R}" y="${H - 8}" font-size="11" fill="#766b70" text-anchor="end">Today</text>
  </svg>`
}

function getReportTrendPoints(assessments) {
  const valid = (assessments ?? []).filter((a) => a.created_at && typeof a.overall_score === 'number')
  const byDay = new Map()
  for (const a of valid) {
    const d = new Date(a.created_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const existing = byDay.get(key)
    if (!existing || new Date(existing.created_at) < d) byDay.set(key, a)
  }
  return [...byDay.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

function sortReportConditions(list) {
  const rank = (name) => {
    const i = REPORT_CONDITION_ORDER.findIndex((known) => name?.toLowerCase().includes(known.toLowerCase()))
    return i === -1 ? REPORT_CONDITION_ORDER.length : i
  }
  return [...list].sort((a, b) => rank(a.name) - rank(b.name))
}

const REPORT_CONDITION_ORDER = [
  'Cardiovascular disease',
  'Preeclampsia',
  'Gestational diabetes',
  'Preterm labor',
  'Stillbirth',
  'Postpartum depression',
  'Postpartum cardiovascular',
  'Postpartum preeclampsia',
  'Postpartum hemorrhage',
  'Postpartum thyroiditis',
  'Breastfeeding',
]

function scoreColor(level) {
  return level === 'high' ? '#b66565'
    : level === 'moderate' ? '#c9a35c'
      : '#8aa37e'
}

function formatDateTime(value) {
  if (!value) return 'not available'
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function formatShortDate(value) {
  return value.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }
