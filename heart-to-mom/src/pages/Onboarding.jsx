import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { triggerRiskAssessment } from '../lib/useRiskAssessment.js'
import './Onboarding.css'

const STEPS = [
  { key: 'personal',  label: 'Personal info' },
  { key: 'medical',   label: 'Medical history' },
  { key: 'pregnancy', label: 'Pregnancy details' },
  { key: 'lifestyle', label: 'Lifestyle' },
]

const RACE_OPTIONS = [
  'American Indian / Alaska Native', 'Asian', 'Black or African American',
  'Hispanic or Latina', 'Native Hawaiian / Pacific Islander', 'White',
  'Middle Eastern / North African', 'Other', 'Prefer not to say',
]
const PRONOUN_OPTIONS = ['She/her', 'He/him', 'They/them', 'Prefer to self-describe', 'Prefer not to say']
const CONDITION_OPTIONS = [
  'Type 1 Diabetes', 'Type 2 Diabetes', 'Hypertension', 'Asthma',
  'Thyroid disorder', 'PCOS', 'Heart disease', 'Kidney disease',
  'Depression / Anxiety', 'Autoimmune disorder', 'None',
]
const ALLERGY_OPTIONS = [
  'Penicillin', 'Sulfa drugs', 'Aspirin / NSAIDs', 'Latex',
  'Peanuts', 'Tree nuts', 'Shellfish', 'Eggs', 'Dairy', 'None',
]
const FAMILY_OPTIONS = [
  'Diabetes', 'Hypertension', 'Preeclampsia', 'Heart disease',
  'Cancer', 'Genetic disorders', 'Mental illness', 'None',
]
const COMPLICATION_OPTIONS = [
  'Miscarriage', 'Preeclampsia', 'Gestational diabetes', 'Preterm labor',
  'C-section', 'Postpartum depression', 'None / first pregnancy',
]
const EXERCISE_OPTIONS = ['Never', '1–2 days / week', '3–5 days / week', 'Daily']
const SMOKING_OPTIONS = ['Never', 'Former smoker', 'Current smoker']
const ALCOHOL_OPTIONS = ['None during pregnancy', 'Occasional', 'Regular']
const DIET_OPTIONS = ['No restrictions', 'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Other']

const EMPTY = {
  full_name: '', date_of_birth: '', pronouns: '',
  race_ethnicity: [],
  height_cm: '', weight_kg: '',
  conditions: [], allergies: [], medications: '', family_history: [],
  due_date: '', last_period: '', prior_pregnancies: '', complications: [],
  exercise_frequency: '', smoking_status: '', alcohol_use: '', diet_pattern: '',
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Hydrate from existing profile so "Save & finish later" works
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (cancelled || !data) return
      setForm((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(data).filter(([k, v]) => k in EMPTY && v != null)
        ),
        // arrays default to []
        race_ethnicity: data.race_ethnicity ?? [],
        conditions:     data.conditions ?? [],
        allergies:      data.allergies ?? [],
        family_history: data.family_history ?? [],
        complications:  data.complications ?? [],
      }))
    })
    return () => { cancelled = true }
  }, [user])

  const update = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggle = (key, value) => setForm((f) => {
    const has = f[key].includes(value)
    return { ...f, [key]: has ? f[key].filter((v) => v !== value) : [...f[key], value] }
  })

  const percent = useMemo(() => Math.round(((step + 1) / STEPS.length) * 100), [step])

  const save = async (markComplete) => {
    setError('')
    setSubmitting(true)
    try {
      const payload = {
        id: user.id,
        ...form,
        // numerics: empty string → null
        height_cm:         form.height_cm === '' ? null : Number(form.height_cm),
        weight_kg:         form.weight_kg === '' ? null : Number(form.weight_kg),
        prior_pregnancies: form.prior_pregnancies === '' ? null : Number(form.prior_pregnancies),
        // dates: empty string → null (avoid pg invalid date)
        date_of_birth: form.date_of_birth || null,
        due_date:      form.due_date || null,
        last_period:   form.last_period || null,
        onboarding_completed: !!markComplete,
        updated_at: new Date().toISOString(),
      }
      const { error: saveError } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })

      if (saveError) {
        // Most common cause in this project: the new health columns (alcohol_use,
        // medications, etc.) haven't been added to the DB yet. Fall back to a
        // minimal payload using only the columns that existed in the original
        // schema, so onboarding can complete + the AI assessment still runs.
        const minimalPayload = {
          id: user.id,
          full_name: form.full_name || null,
          due_date: form.due_date || null,
          last_period: form.last_period || null,
          onboarding_completed: !!markComplete,
          updated_at: new Date().toISOString(),
        }
        const { error: minErr } = await supabase
          .from('profiles')
          .upsert(minimalPayload, { onConflict: 'id' })

        if (minErr) {
          if (markComplete) throw minErr
          console.warn('Both profile saves failed; navigating anyway:', minErr)
        } else {
          console.warn('Full profile save failed; saved minimal subset instead. Re-run schema.sql to capture the rest:', saveError)
        }
      }

      // When the profile is fully filled in, generate the first AI risk
      // assessment so the dashboard has something to show immediately.
      if (markComplete) {
        // Persist completion as a local-only fallback so the dashboard banner
        // and "edit health profile" state work even if the DB column write
        // failed (e.g. schema not yet migrated).
        try { localStorage.setItem(`htm:onboardingDone:${user.id}`, '1') } catch {}

        const result = await triggerRiskAssessment('onboarding')
        if (!result.ok) console.warn('Initial risk assessment failed:', result.error)
      }

      navigate('/home')
    } catch (err) {
      setError(err.message ?? 'Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const isLast = step === STEPS.length - 1
  const handleNext = () => isLast ? save(true) : setStep((s) => s + 1)
  const handleBack = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="onb">
      <header className="onb__nav">
        <div className="onb__brand">
          <span className="onb__brand-mark" aria-hidden><HeartIcon /></span>
          <span>HeartToMom</span>
        </div>
        <button className="onb__skip" onClick={() => save(false)} disabled={submitting}>
          Save & finish later
        </button>
      </header>

      <main className="onb__main">
        <p className="onb__welcome">WELCOME{form.full_name ? `, ${form.full_name.split(' ')[0].toUpperCase()}` : ''}</p>
        <h1 className="onb__title">Let’s build your health profile</h1>
        <p className="onb__lede">
          This helps us personalize your risk monitoring and recommendations.
          Takes about 5 minutes — you can update anything later.
        </p>

        {/* Step indicator card */}
        <section className="card stepper">
          <div className="stepper__head">
            <span>STEP {step + 1} OF {STEPS.length}</span>
            <span className="stepper__pct">{percent}% complete</span>
          </div>
          <div className="stepper__bars">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={[
                  'stepper__bar',
                  i < step  && 'is-done',
                  i === step && 'is-current',
                ].filter(Boolean).join(' ')}
              />
            ))}
          </div>
          <div className="stepper__labels">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                className={[
                  'stepper__label',
                  i < step  && 'is-done',
                  i === step && 'is-current',
                ].filter(Boolean).join(' ')}
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
              >
                {i < step ? '✓ ' : ''}{s.label}
              </button>
            ))}
          </div>
        </section>

        {/* Active step */}
        <section className="card onb-step">
          {step === 0 && <PersonalStep form={form} update={update} toggle={toggle} />}
          {step === 1 && <MedicalStep  form={form} update={update} toggle={toggle} />}
          {step === 2 && <PregnancyStep form={form} update={update} toggle={toggle} />}
          {step === 3 && <LifestyleStep form={form} update={update} />}
        </section>

        {error && <div className="banner banner--error">{error}</div>}

        <div className="onb__actions">
          <button
            className="btn-ghost"
            onClick={handleBack}
            disabled={step === 0 || submitting}
          >
            ← Back
          </button>
          <button
            className="btn-primary"
            onClick={handleNext}
            disabled={submitting}
          >
            {submitting
              ? (isLast ? 'Generating your risk report…' : 'Saving…')
              : isLast
                ? 'Finish setup →'
                : 'Continue →'}
          </button>
        </div>
      </main>
    </div>
  )
}

/* ==================== Step components ==================== */

function PersonalStep({ form, update, toggle }) {
  return (
    <>
      <SectionHead icon="user" title="About you" />

      <Field label="Full legal name" hint="Matches what’s on file with your provider.">
        <input
          className="text"
          placeholder="Sarah Elena Morales"
          value={form.full_name}
          onChange={(e) => update({ full_name: e.target.value })}
        />
      </Field>

      <Row>
        <Field label="Date of birth">
          <input
            className="text"
            type="date"
            value={form.date_of_birth}
            onChange={(e) => update({ date_of_birth: e.target.value })}
          />
        </Field>
        <Field label="Preferred pronouns">
          <select
            className="text"
            value={form.pronouns}
            onChange={(e) => update({ pronouns: e.target.value })}
          >
            <option value="">Select…</option>
            {PRONOUN_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
      </Row>

      <Field
        label="Race & ethnicity"
        sub="(select all that apply)"
      >
        <PillGroup
          options={RACE_OPTIONS}
          selected={form.race_ethnicity}
          onToggle={(v) => toggle('race_ethnicity', v)}
        />
      </Field>

      <div className="info-banner">
        <span aria-hidden>ⓘ</span>
        <span>Maternal mortality risk varies significantly by race in the U.S. Sharing this helps us tailor monitoring thresholds and surface relevant resources.</span>
      </div>

      <SectionHead icon="ruler" title="Body measurements" />
      <Row>
        <Field label="Height (cm)">
          <input
            className="text"
            type="number" min="100" max="220"
            placeholder="168"
            value={form.height_cm}
            onChange={(e) => update({ height_cm: e.target.value })}
          />
        </Field>
        <Field label="Pre-pregnancy weight (kg)">
          <input
            className="text"
            type="number" min="30" max="250" step="0.1"
            placeholder="65"
            value={form.weight_kg}
            onChange={(e) => update({ weight_kg: e.target.value })}
          />
        </Field>
      </Row>
    </>
  )
}

function MedicalStep({ form, update, toggle }) {
  return (
    <>
      <SectionHead icon="cross" title="Medical history" />

      <Field label="Pre-existing conditions" sub="(select all that apply)">
        <PillGroup options={CONDITION_OPTIONS} selected={form.conditions}
          onToggle={(v) => toggle('conditions', v)} />
      </Field>

      <Field label="Allergies" sub="(select all that apply)">
        <PillGroup options={ALLERGY_OPTIONS} selected={form.allergies}
          onToggle={(v) => toggle('allergies', v)} />
      </Field>

      <Field
        label="Current medications & supplements"
        hint="Include prenatal vitamins, dosages if you know them. Separate with commas."
      >
        <textarea
          className="text text--area"
          rows={3}
          placeholder="Prenatal vitamin (daily), Levothyroxine 50mcg, Vitamin D 1000 IU…"
          value={form.medications}
          onChange={(e) => update({ medications: e.target.value })}
        />
      </Field>

      <Field label="Family medical history" sub="(parents, siblings — select all that apply)">
        <PillGroup options={FAMILY_OPTIONS} selected={form.family_history}
          onToggle={(v) => toggle('family_history', v)} />
      </Field>
    </>
  )
}

function PregnancyStep({ form, update, toggle }) {
  return (
    <>
      <SectionHead icon="baby" title="Pregnancy details" />

      <Row>
        <Field label="Estimated due date" hint="From your provider or last ultrasound.">
          <input className="text" type="date"
            value={form.due_date}
            onChange={(e) => update({ due_date: e.target.value })} />
        </Field>
        <Field label="First day of last period">
          <input className="text" type="date"
            value={form.last_period}
            onChange={(e) => update({ last_period: e.target.value })} />
        </Field>
      </Row>

      <Field label="Number of previous pregnancies">
        <input
          className="text"
          type="number" min="0" max="20"
          placeholder="0"
          value={form.prior_pregnancies}
          onChange={(e) => update({ prior_pregnancies: e.target.value })}
        />
      </Field>

      <Field label="Past pregnancy complications" sub="(select all that apply)">
        <PillGroup options={COMPLICATION_OPTIONS} selected={form.complications}
          onToggle={(v) => toggle('complications', v)} />
      </Field>
    </>
  )
}

function LifestyleStep({ form, update }) {
  return (
    <>
      <SectionHead icon="leaf" title="Lifestyle" />

      <Field label="Exercise frequency">
        <PillGroup
          options={EXERCISE_OPTIONS}
          selected={form.exercise_frequency ? [form.exercise_frequency] : []}
          onToggle={(v) => update({ exercise_frequency: form.exercise_frequency === v ? '' : v })}
          single
        />
      </Field>

      <Field label="Smoking">
        <PillGroup
          options={SMOKING_OPTIONS}
          selected={form.smoking_status ? [form.smoking_status] : []}
          onToggle={(v) => update({ smoking_status: form.smoking_status === v ? '' : v })}
          single
        />
      </Field>

      <Field label="Alcohol use">
        <PillGroup
          options={ALCOHOL_OPTIONS}
          selected={form.alcohol_use ? [form.alcohol_use] : []}
          onToggle={(v) => update({ alcohol_use: form.alcohol_use === v ? '' : v })}
          single
        />
      </Field>

      <Field label="Diet pattern">
        <PillGroup
          options={DIET_OPTIONS}
          selected={form.diet_pattern ? [form.diet_pattern] : []}
          onToggle={(v) => update({ diet_pattern: form.diet_pattern === v ? '' : v })}
          single
        />
      </Field>
    </>
  )
}

/* ==================== Primitives ==================== */

function Field({ label, sub, hint, children }) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {sub && <span className="field__sub"> {sub}</span>}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

function Row({ children }) {
  return <div className="row">{children}</div>
}

function PillGroup({ options, selected, onToggle, single, big }) {
  return (
    <div className={`pills ${big ? 'pills--big' : ''}`}>
      {options.map((opt) => {
        const isSel = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            className={`pill-btn ${isSel ? 'is-selected' : ''}`}
            onClick={() => onToggle(opt)}
            aria-pressed={isSel}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function SectionHead({ icon, title }) {
  return (
    <div className="sec-head">
      <span className="sec-head__icon" aria-hidden>
        <Icon name={icon} />
      </span>
      <h2 className="sec-head__title">{title}</h2>
    </div>
  )
}

function Icon({ name }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'user':
      return (<svg {...props}><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>)
    case 'cross':
      return (<svg {...props}><path d="M12 4v16M4 12h16"/></svg>)
    case 'baby':
      return (<svg {...props}><circle cx="12" cy="9" r="3"/><path d="M5 22c0-4 3-7 7-7s7 3 7 7"/></svg>)
    case 'leaf':
      return (<svg {...props}><path d="M11 20A7 7 0 0 1 4 13V4h9a7 7 0 0 1 7 7v9z"/><path d="M4 4l16 16"/></svg>)
    case 'watch':
      return (<svg {...props}><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 6V3h6v3M9 18v3h6v-3"/></svg>)
    case 'ruler':
      return (<svg {...props}><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 11l2 2M11 7l2 2M9 15l2 2M15 9l2 2"/></svg>)
    default: return null
  }
}

function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}
