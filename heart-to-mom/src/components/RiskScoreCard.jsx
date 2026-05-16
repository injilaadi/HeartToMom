import './RiskScoreCard.css'

/**
 * Renders the donut + factor breakdown for the user's most recent check-in.
 * Shows a real empty state when there is no check-in (no mock data).
 * When a check-in exists, all numbers are derived from its actual answers.
 */
export default function RiskScoreCard({ latestCheckIn }) {
  if (!latestCheckIn) return <EmptyState />

  const level = latestCheckIn.risk_score ?? null
  const answers = latestCheckIn.answers ?? {}
  const score = scoreFromAnswers(answers)
  const factors = factorsFromAnswers(answers)

  return (
    <section className="card rs">
      <div className="rs__inner">
        <div className="rs__ring-wrap">
          <ScoreRing score={score} level={level} />
        </div>

        <div className="rs__bars">
          <h2 className="card__title rs__title">What goes into your score</h2>
          {factors.length === 0 ? (
            <p className="rs__factor-empty">
              Your last check-in didn’t include any contributing factors.
            </p>
          ) : (
            <ul className="rs__factor-list">
              {factors.map((f) => (
                <li key={f.label} className="rs__factor">
                  <div className="rs__factor-row">
                    <span className="rs__factor-label">{f.label}</span>
                    <span className={`rs__factor-level rs__factor-level--${f.level}`}>
                      {cap(f.level)}
                    </span>
                  </div>
                  <div className="rs__bar">
                    <div
                      className={`rs__bar-fill rs__bar-fill--${f.level}`}
                      style={{ width: `${f.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <section className="card rs rs--empty">
      <div className="rs__inner">
        <div className="rs__ring-wrap">
          <ScoreRing score={null} level={null} />
        </div>
        <div className="rs__bars">
          <h2 className="card__title rs__title">What goes into your score</h2>
          <p className="rs__factor-empty">
            No check-in data yet. Complete a daily check-in below to see your risk
            score and what's driving it.
          </p>
        </div>
      </div>
    </section>
  )
}

function ScoreRing({ score, level }) {
  const size = 220
  const stroke = 16
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  const hasData = level != null && score != null
  const fillPct = hasData ? Math.min(1, Math.max(0, score / 100)) : 0
  const offset = circumference * (1 - fillPct)

  const color =
    !hasData             ? 'var(--muted-2)' :
    level === 'high'     ? '#b66565' :
    level === 'moderate' ? '#c9a35c' :
                           '#8aa37e'

  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size/2} cy={size/2} r={radius}
        fill="none" stroke="var(--cream-200)" strokeWidth={stroke}
      />
      {hasData && (
        <circle
          cx={size/2} cy={size/2} r={radius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
        />
      )}
      <text x="50%" y="40%" textAnchor="middle"
        fontSize="13" fill="var(--muted)" letterSpacing="0.12em">
        RISK
      </text>
      <text x="50%" y="58%" textAnchor="middle"
        fontSize="40" fontWeight="700" fill={color}>
        {hasData ? cap(level) : 'None'}
      </text>
      <text x="50%" y="72%" textAnchor="middle"
        fontSize="14" fill="var(--muted)">
        {hasData ? `${score} / 100` : 'No data'}
      </text>
    </svg>
  )
}

/* ---------------- Score derivation from real answers ---------------- */
/* These mappings match the QUESTIONS list in TrackHealth.jsx.        */

const ANSWER_WEIGHTS = {
  'No movement today':   25, 'Spotting':           25,
  'Unwell':              18, 'Forgot':             10,
  'Less than usual':     15, 'Headache':           12,
  'Swelling':            12, 'Cramping':           12,
  'Poorly':              12, 'Tired':              8,
  'Not yet':             5,  'Okay':               3,
  // everything else (Great, Yes, None, Well, etc.) contributes 0
}

function scoreFromAnswers(answers) {
  return Object.values(answers).reduce(
    (sum, v) => Math.min(100, sum + (ANSWER_WEIGHTS[v] ?? 0)),
    0,
  )
}

const QUESTION_LABELS = {
  mood:     'Mood',
  movement: 'Baby movement',
  symptoms: 'Reported symptoms',
  sleep:    'Sleep quality',
  meds:     'Medication adherence',
}

function factorsFromAnswers(answers) {
  return Object.entries(answers)
    .filter(([k]) => QUESTION_LABELS[k])
    .map(([k, v]) => {
      const weight = ANSWER_WEIGHTS[v] ?? 0
      const level = weight >= 18 ? 'high' : weight >= 8 ? 'moderate' : 'low'
      // Bar width as a share of "worst-possible-for-this-factor" (25 = full bar)
      const pct = Math.min(100, Math.round((weight / 25) * 100))
      return { label: QUESTION_LABELS[k], level, pct, value: v }
    })
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }
