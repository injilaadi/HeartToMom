import { useState } from 'react'
import './RiskScoreCard.css'

/**
 * Donut + condition-factor bars driven by the latest persisted AI risk assessment.
 * Each condition row is expandable — clicking it reveals an AI-generated summary
 * of why that score was given, common symptoms, and warning signs.
 */
export default function RiskScoreCard({ assessment }) {
  if (!assessment) return <EmptyState />

  const level = assessment.overall_risk
  const score = assessment.overall_score
  const conditions = sortConditions(assessment.conditions ?? [])

  return (
    <section className="card rs">
      <div className="rs__inner">
        <div className="rs__ring-wrap">
          <ScoreRing score={score} level={level} />
        </div>

        <div className="rs__bars">
          <h2 className="card__title rs__title">What goes into your score</h2>
          {conditions.length === 0 ? (
            <p className="rs__factor-empty">
              No condition breakdown available for this assessment.
            </p>
          ) : (
            <ul className="rs__factor-list">
              {conditions.map((c) => (
                <FactorRow key={c.name} c={c} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function FactorRow({ c }) {
  const [open, setOpen] = useState(false)
  const pct = Math.max(4, Math.min(100, c.score ?? 0))

  return (
    <li className="rs__factor">
      <button
        type="button"
        className="rs__factor-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="rs__factor-row">
          <span className="rs__factor-label">
            <span className={`rs__chevron ${open ? 'is-open' : ''}`} aria-hidden>▸</span>
            {c.name}
          </span>
          <span className={`rs__factor-level rs__factor-level--${c.risk_level}`}>
            {cap(c.risk_level)}
          </span>
        </div>
        <div className="rs__bar">
          <div
            className={`rs__bar-fill rs__bar-fill--${c.risk_level}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>

      {open && <ConditionDetails c={c} />}
    </li>
  )
}

function ConditionDetails({ c }) {
  const actionSentence =
    c.risk_level === 'high'
      ? '! URGENT: Immediately contact your health care provider or go see a doctor.'
      : c.risk_level === 'moderate'
        ? 'Bring this up at your next appointment.'
        : null

  return (
    <div className={`rs__detail rs__detail--${c.risk_level}`}>
      {actionSentence && (
        <p className={`rs__action rs__action--${c.risk_level}`}>{actionSentence}</p>
      )}

      {c.reasoning && (
        <div className="rs__detail-block">
          <p className="rs__detail-label">Why this score</p>
          <p className="rs__detail-text">{c.reasoning}</p>
        </div>
      )}

      {c.common_symptoms?.length > 0 && (
        <div className="rs__detail-block">
          <p className="rs__detail-label">Common symptoms</p>
          <ul className="rs__detail-list">
            {c.common_symptoms.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {c.warning_signs?.length > 0 && (
        <div className="rs__detail-block rs__detail-block--warn">
          <p className="rs__detail-label">⚠ Warning signs — seek care if you notice</p>
          <ul className="rs__detail-list">
            {c.warning_signs.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {(!c.common_symptoms?.length && !c.warning_signs?.length) && (
        <p className="rs__detail-text rs__detail-text--muted">
          Symptom + warning-sign detail isn't in this assessment yet. Submit a new
          daily check-in to refresh.
        </p>
      )}
    </div>
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
            No assessment yet. Complete your health profile, or submit a daily
            check-in below, and we'll generate one automatically.
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

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

// Preferred display order — Cardiovascular always first. Anything not in the
// list keeps its relative position after the known ones. Covers both the
// pregnancy and postpartum condition naming.
const CONDITION_ORDER = [
  // pregnancy
  'Cardiovascular disease',
  'Preeclampsia',
  'Gestational diabetes',
  'Preterm labor',
  'Stillbirth',
  'Postpartum depression',
  // postpartum-specific
  'Postpartum cardiovascular',
  'Postpartum preeclampsia',
  'Postpartum hemorrhage',
  'Postpartum thyroiditis',
  'Breastfeeding',
]

function sortConditions(list) {
  const rank = (name) => {
    const i = CONDITION_ORDER.findIndex((known) => name?.toLowerCase().includes(known.toLowerCase()))
    return i === -1 ? CONDITION_ORDER.length : i
  }
  return [...list].sort((a, b) => rank(a.name) - rank(b.name))
}
