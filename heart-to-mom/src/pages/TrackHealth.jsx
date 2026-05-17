import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import RiskScoreCard from '../components/RiskScoreCard.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { triggerRiskAssessment } from '../lib/useRiskAssessment.js'
import './pages-common.css'
import './TrackHealth.css'

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

const QUESTIONS = [
  { id: 'mood',     label: 'How are you feeling today?',    options: ['Great', 'Okay', 'Tired', 'Unwell'] },
  { id: 'movement', label: 'Have you felt baby movement?',  options: ['Yes, normal', 'Less than usual', 'No movement today', 'N/A'] },
  { id: 'symptoms', label: 'Any new symptoms? (select all that apply)', options: ['None', 'Headache', 'Swelling', 'Spotting', 'Cramping'], multi: true },
  { id: 'sleep',    label: 'How did you sleep?',            options: ['Well', 'Okay', 'Poorly'] },
  { id: 'meds',     label: 'Took your prenatal today?',     options: ['Yes', 'Not yet', 'Forgot'] },
]

export default function TrackHealth() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [latestAssessment, setLatestAssessment] = useState(null)
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
      const risk = deriveRisk(answers)
      const payload = { user_id: user.id, answers, risk_score: risk }

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
      if (!result.ok) console.warn('Risk assessment failed:', result.error)

      // Refresh local state so editMode reflects the new check-in
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
                          const v = answers[q.id]
                          const isSelected = q.multi
                            ? Array.isArray(v) && v.includes(opt)
                            : v === opt
                          return (
                            <button
                              key={opt}
                              type="button"
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
  const high = ['No movement today', 'Spotting']
  const moderate = ['Less than usual', 'Headache', 'Swelling', 'Cramping', 'Poorly', 'Unwell']
  const values = Object.values(answers).flatMap((v) => (Array.isArray(v) ? v : [v]))
  if (values.some((v) => high.includes(v))) return 'high'
  if (values.some((v) => moderate.includes(v))) return 'moderate'
  return 'low'
}
