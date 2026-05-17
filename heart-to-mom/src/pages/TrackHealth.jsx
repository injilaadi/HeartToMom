import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import RiskScoreCard from '../components/RiskScoreCard.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { triggerRiskAssessment } from '../lib/useRiskAssessment.js'
import './pages-common.css'
import './TrackHealth.css'

const QUESTIONS = [
  { id: 'mood',     label: 'How are you feeling today?',    options: ['Great', 'Okay', 'Tired', 'Unwell'] },
  { id: 'movement', label: 'Have you felt baby movement?',  options: ['Yes, normal', 'Less than usual', 'No movement today', 'N/A'] },
  { id: 'symptoms', label: 'Any new symptoms?',             options: ['None', 'Headache', 'Swelling', 'Spotting', 'Cramping'] },
  { id: 'sleep',    label: 'How did you sleep?',            options: ['Well', 'Okay', 'Poorly'] },
  { id: 'meds',    label: 'Took your prenatal today?',     options: ['Yes', 'Not yet', 'Forgot'] },
]

export default function TrackHealth() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [latestAssessment, setLatestAssessment] = useState(null)
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [assessmentSignal, setAssessmentSignal] = useState(0)
  const [debugMsg, setDebugMsg] = useState('')

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
    supabase.from('risk_assessments').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setLatestAssessment(data ?? null))
  }, [user, assessmentSignal])

  const allAnswered = QUESTIONS.every((q) => answers[q.id])

  const submit = async () => {
    setSubmitting(true)
    try {
      const risk = deriveRisk(answers)
      await supabase.from('check_ins').insert({
        user_id: user.id,
        answers,
        risk_score: risk,
      })

      // Kick off the AI assessment based on the new check-in.
      setAnalyzing(true)
      const result = await triggerRiskAssessment('check_in')
      setAnalyzing(false)

      if (!result.ok) {
        console.warn('Risk assessment failed:', result.error)
        setDebugMsg(`AI assessment failed: ${result.error}`)
      } else {
        setDebugMsg(`AI assessment succeeded · id=${result.data?.id ?? 'none'} · risk=${result.data?.overall_risk}`)
      }

      // Refresh the donut + the RiskAssessment component
      setAssessmentSignal((n) => n + 1)
      setSubmitted(true)
    } catch (err) {
      console.warn('Check-in submit failed:', err)
    } finally {
      setSubmitting(false)
    }
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

        {debugMsg && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              background: debugMsg.startsWith('AI assessment failed') ? '#fdecec' : '#eef5ec',
              border: `1px solid ${debugMsg.startsWith('AI assessment failed') ? '#f3c2c2' : '#c9dec6'}`,
              color: debugMsg.startsWith('AI assessment failed') ? '#8a2b2b' : '#2f5a36',
              fontSize: 13,
              fontFamily: 'monospace',
              wordBreak: 'break-word',
            }}
          >
            <strong>DEBUG:</strong> {debugMsg}
          </div>
        )}

        <div className="th__grid">
          {/* Daily questionnaire */}
          <section className="card th__quiz">
            <div className="card__head">
              <h2 className="card__title">Daily check-in</h2>
              <span className="card__sub">~90 seconds</span>
            </div>

            {submitted ? (
              <div className="th__done">
                <p className="th__done-emoji" aria-hidden>✓</p>
                <p className="th__done-title">Thanks — check-in saved.</p>
                <p className="th__done-note">Your risk assessment has been updated above.</p>
              </div>
            ) : (
              <>
                <div className="th__quiz-list">
                  {QUESTIONS.map((q) => (
                    <div key={q.id} className="th__quiz-q">
                      <p className="th__quiz-label">{q.label}</p>
                      <div className="th__quiz-options">
                        {q.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={`pill-btn ${answers[q.id] === opt ? 'is-selected' : ''}`}
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                          >
                            {opt}
                          </button>
                        ))}
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
                      : 'Submit check-in'}
                </button>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

function deriveRisk(answers) {
  // Trivial mock — flag moderate/high if any concerning answer
  const high = ['No movement today', 'Spotting']
  const moderate = ['Less than usual', 'Headache', 'Swelling', 'Cramping', 'Poorly', 'Unwell']
  const values = Object.values(answers)
  if (values.some((v) => high.includes(v))) return 'high'
  if (values.some((v) => moderate.includes(v))) return 'moderate'
  return 'low'
}
