import './RiskScoreCard.css'

/**
 * Donut + condition-factor bars driven by the latest persisted AI risk assessment.
 * Renders an empty state when no assessment has been generated yet.
 */
export default function RiskScoreCard({ assessment }) {
  if (!assessment) return <EmptyState />

  const level = assessment.overall_risk
  const score = assessment.overall_score
  const factors = (assessment.conditions ?? []).map((c) => ({
    label: c.name,
    level: c.risk_level,
    pct:   Math.max(4, Math.min(100, c.score ?? 0)),
  }))

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
              No condition breakdown available for this assessment.
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
