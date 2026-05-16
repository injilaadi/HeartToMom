import './RiskScoreCard.css'

export default function RiskScoreCard({ latestCheckIn }) {
  const level = latestCheckIn?.risk_score ?? 'low'
  // For a hackathon, derive a deterministic-looking score from the level
  const score = level === 'high' ? 78 : level === 'moderate' ? 52 : 22

  const factors = [
    { label: 'Blood pressure trend',    level: 'low',      pct: 28 },
    { label: 'Heart rate variability',  level: 'low',      pct: 34 },
    { label: 'Reported symptoms',       level: level === 'low' ? 'moderate' : level, pct: level === 'low' ? 58 : 75 },
    { label: 'Sleep quality',           level: 'moderate', pct: 62 },
    { label: 'Medical history factors', level: 'low',      pct: 30 },
  ]

  return (
    <section className="card rs">
      <div className="rs__inner">
        <div className="rs__ring-wrap">
          <ScoreRing score={score} level={level} />
          <p className="rs__trend">↘ Down 4 points this week</p>
        </div>

        <div className="rs__bars">
          <h2 className="card__title rs__title">What goes into your score</h2>
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
  const offset = circumference * (1 - Math.min(1, Math.max(0, score / 100)))

  const color =
    level === 'high'     ? '#b66565' :
    level === 'moderate' ? '#c9a35c' :
                           '#8aa37e'

  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size/2} cy={size/2} r={radius}
        fill="none" stroke="var(--cream-200)" strokeWidth={stroke}
      />
      <circle
        cx={size/2} cy={size/2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size/2} ${size/2})`}
      />
      <text x="50%" y="40%" textAnchor="middle"
        fontSize="13" fill="var(--muted)" letterSpacing="0.12em">
        RISK
      </text>
      <text x="50%" y="58%" textAnchor="middle"
        fontSize="42" fontWeight="700" fill={color}>
        {cap(level)}
      </text>
      <text x="50%" y="72%" textAnchor="middle"
        fontSize="14" fill="var(--muted)">
        {score} / 100
      </text>
    </svg>
  )
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }
