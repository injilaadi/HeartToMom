import { useEffect } from 'react'
import { useLatestAssessment } from '../lib/useRiskAssessment.js'
import './RiskAssessment.css'

/**
 * Shows the latest AI-generated risk assessment. No manual run button —
 * assessments are triggered automatically when the user finishes their
 * health profile or submits a daily check-in. If the parent passes
 * `refreshSignal`, this component re-fetches whenever that value changes.
 */
export default function RiskAssessment({ refreshSignal }) {
  const { assessment, loading, refresh } = useLatestAssessment()

  // Re-fetch whenever the parent says it just triggered a new assessment
  useEffect(() => {
    if (refreshSignal != null) refresh()
  }, [refreshSignal, refresh])

  return (
    <section className="card ra">
      <header className="ra__head">
        <div>
          <h2 className="card__title">AI risk assessment</h2>
          <p className="ra__sub">
            Updated automatically when you finish onboarding or submit a daily check-in.
          </p>
        </div>
      </header>

      {loading && <LoadingSkeleton />}

      {!loading && !assessment && (
        <p className="ra__placeholder">
          No assessment yet. Complete your health profile, or submit a daily
          check-in, and one will be generated automatically.
        </p>
      )}

      {!loading && assessment && (
        <>
          <OverallCard assessment={assessment} />

          <div className="ra__grid">
            {(assessment.conditions ?? []).map((c) => (
              <ConditionCard key={c.name} c={c} />
            ))}
          </div>

          {assessment.discuss_with_provider?.length > 0 && (
            <section className="ra__discuss">
              <h3>Discuss with your provider</h3>
              <ul>
                {assessment.discuss_with_provider.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {assessment.disclaimer && (
            <p className="ra__disclaimer">⚠ {assessment.disclaimer}</p>
          )}

          <p className="ra__meta">
            Generated {formatWhen(assessment.created_at ?? assessment.generated_at)}
            {assessment.triggered_by ? ` · triggered by ${assessment.triggered_by.replace('_', ' ')}` : ''}
            {assessment.data_used
              ? ` · used ${assessment.data_used.check_ins_count ?? 0} check-in(s) and ${assessment.data_used.vitals_count ?? 0} vital reading(s)`
              : ''}
          </p>
        </>
      )}
    </section>
  )
}

/* -------------------- subcomponents -------------------- */

function OverallCard({ assessment }) {
  const { overall_risk, overall_score, summary } = assessment
  return (
    <div className={`ra__overall ra__overall--${overall_risk}`}>
      <div className="ra__overall-score">
        <span className="ra__overall-num">{overall_score}</span>
        <span className="ra__overall-of">/ 100</span>
      </div>
      <div>
        <p className="ra__overall-kicker">OVERALL RISK</p>
        <h3 className="ra__overall-level">{cap(overall_risk)}</h3>
        {summary && <p className="ra__overall-summary">{summary}</p>}
      </div>
    </div>
  )
}

function ConditionCard({ c }) {
  return (
    <article className={`ra__cond ra__cond--${c.risk_level}`}>
      <header className="ra__cond-head">
        <h4>{c.name}</h4>
        <span className={`ra__chip ra__chip--${c.risk_level}`}>
          {cap(c.risk_level)} · {c.score}
        </span>
      </header>

      <p className="ra__cond-reason">{c.reasoning}</p>

      {c.data_points?.length > 0 && (
        <div className="ra__cond-section">
          <p className="ra__cond-label">Data considered</p>
          <ul className="ra__chip-list">
            {c.data_points.map((dp, i) => (<li key={i}>{dp}</li>))}
          </ul>
        </div>
      )}

      {c.recommendations?.length > 0 && (
        <div className="ra__cond-section">
          <p className="ra__cond-label">Recommendations</p>
          <ul className="ra__rec-list">
            {c.recommendations.map((rec, i) => (<li key={i}>{rec}</li>))}
          </ul>
        </div>
      )}
    </article>
  )
}

function LoadingSkeleton() {
  return (
    <div className="ra__loading">
      <div className="ra__loading-spin" />
      <p>Loading your latest assessment…</p>
    </div>
  )
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

function formatWhen(iso) {
  if (!iso) return 'just now'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
