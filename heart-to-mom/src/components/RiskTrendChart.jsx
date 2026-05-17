import './RiskTrendChart.css'

/**
 * Compact SVG line chart of the user's overall risk score over the past month.
 * Expects `assessments` sorted oldest → newest.
 */
export default function RiskTrendChart({ assessments }) {
  // Filter valid + collapse to ONE point per calendar day (latest edit wins).
  const valid = (assessments ?? []).filter(
    (a) => a.created_at && typeof a.overall_score === 'number'
  )
  const byDay = new Map()
  for (const a of valid) {
    const d = new Date(a.created_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const existing = byDay.get(key)
    if (!existing || new Date(existing.created_at) < d) byDay.set(key, a)
  }
  const dayPoints = [...byDay.values()].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  )

  if (dayPoints.length === 0) {
    return (
      <section className="card trend">
        <header className="trend__head">
          <div>
            <h2 className="card__title">Risk trend · last 30 days</h2>
            <p className="trend__sub">No assessments yet. Submit a daily check-in to start the trend.</p>
          </div>
        </header>
      </section>
    )
  }

  // Geometry — fixed 30-day window so spacing is always proportionate,
  // regardless of how often the user checks in.
  const W = 560, H = 180, PAD_L = 32, PAD_R = 16, PAD_T = 12, PAD_B = 28
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const DAY_MS = 24 * 60 * 60 * 1000
  const today = startOfDay(new Date())
  const windowEnd   = today.getTime()
  const windowStart = windowEnd - 29 * DAY_MS // 30-day window inclusive of today

  const projectX = (t) => {
    const clamped = Math.max(windowStart, Math.min(windowEnd, t))
    return PAD_L + ((clamped - windowStart) / (29 * DAY_MS)) * innerW
  }
  const projectY = (score) => PAD_T + (1 - Math.max(0, Math.min(100, score)) / 100) * innerH

  const points = dayPoints.map((a) => {
    const dayStart = startOfDay(new Date(a.created_at)).getTime()
    return {
      x: projectX(dayStart),
      y: projectY(a.overall_score),
      score: a.overall_score,
      risk: a.overall_risk,
      date: new Date(a.created_at),
    }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  // Threshold lines (Low <33, Moderate 33-66, High >66)
  const yLow  = projectY(33)
  const yHigh = projectY(66)

  // Trend analysis (use per-day points so edits in the same day don't double-count)
  const first = dayPoints[0].overall_score
  const last  = dayPoints[dayPoints.length - 1].overall_score
  const delta = last - first
  const trend =
    Math.abs(delta) < 3 ? 'flat' :
    delta < 0           ? 'down' :
                          'up'
  const trendLabel =
    trend === 'down' ? `↓ Down ${Math.abs(delta)} points` :
    trend === 'up'   ? `↑ Up ${delta} points` :
                       'Stable'
  const trendColor =
    trend === 'down' ? '#4a6b3f' :
    trend === 'up'   ? '#8a2b2b' :
                       'var(--muted)'

  const fmt = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const lineStroke = trend === 'down' ? '#8aa37e' : trend === 'up' ? '#b66565' : '#9b8da2'

  return (
    <section className="card trend">
      <header className="trend__head">
        <div>
          <h2 className="card__title">Risk trend · last 30 days</h2>
          <p className="trend__sub">
            {dayPoints.length} day{dayPoints.length === 1 ? '' : 's'} of data
            {' · '}
            <span style={{ color: trendColor, fontWeight: 600 }}>{trendLabel}</span>
          </p>
        </div>
        <div className="trend__legend">
          <span><i style={{ background: '#8aa37e' }} /> Low</span>
          <span><i style={{ background: '#c9a35c' }} /> Moderate</span>
          <span><i style={{ background: '#b66565' }} /> High</span>
        </div>
      </header>

      <svg className="trend__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Threshold bands */}
        <rect x={PAD_L} y={PAD_T}        width={innerW} height={yHigh - PAD_T}        fill="#fae6e7" opacity="0.6" />
        <rect x={PAD_L} y={yHigh}        width={innerW} height={yLow - yHigh}         fill="#faf2dc" opacity="0.6" />
        <rect x={PAD_L} y={yLow}         width={innerW} height={PAD_T + innerH - yLow} fill="#eaf1e3" opacity="0.7" />

        {/* Y-axis labels */}
        <text x="4" y={PAD_T + 4}        fontSize="10" fill="var(--muted-2)">100</text>
        <text x="4" y={yHigh + 3}        fontSize="10" fill="var(--muted-2)">66</text>
        <text x="4" y={yLow + 3}         fontSize="10" fill="var(--muted-2)">33</text>
        <text x="4" y={PAD_T + innerH}   fontSize="10" fill="var(--muted-2)">0</text>

        {/* Line */}
        {points.length > 1 && (
          <path d={path} fill="none" stroke={lineStroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y} r={points.length === 1 ? 5 : 3.5}
            fill="#fff"
            stroke={colorForRisk(p.risk)}
            strokeWidth="2"
          >
            <title>{`${fmt(p.date)} — ${p.score}/100 (${p.risk})`}</title>
          </circle>
        ))}

        {/* X-axis labels — fixed window bounds, plus a "today" marker */}
        <text x={PAD_L} y={H - 8} fontSize="10" fill="var(--muted-2)" textAnchor="start">
          {fmt(new Date(windowStart))}
        </text>
        <text x={PAD_L + innerW / 2} y={H - 8} fontSize="10" fill="var(--muted-2)" textAnchor="middle">
          {fmt(new Date(windowStart + 14.5 * DAY_MS))}
        </text>
        <text x={W - PAD_R} y={H - 8} fontSize="10" fill="var(--muted-2)" textAnchor="end">
          Today
        </text>
      </svg>
    </section>
  )
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function colorForRisk(level) {
  return level === 'high'     ? '#b66565'
       : level === 'moderate' ? '#c9a35c'
       :                        '#8aa37e'
}
