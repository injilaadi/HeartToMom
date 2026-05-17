import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      ?? process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY

// JSON schema constraints the model's output so the UI can parse it safely.
const RISK_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    overall_risk:  { type: SchemaType.STRING, enum: ['low', 'moderate', 'high'] },
    overall_score: { type: SchemaType.INTEGER, description: '0-100 composite risk score (0 = no risk)' },
    summary:       { type: SchemaType.STRING,  description: '2-3 sentence plain-language overview for the patient' },
    conditions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name:            { type: SchemaType.STRING },
          risk_level:      { type: SchemaType.STRING, enum: ['low', 'moderate', 'high'] },
          score:           { type: SchemaType.INTEGER, description: '0-100' },
          reasoning:       { type: SchemaType.STRING, description: '1-2 sentences citing actual patient data' },
          data_points:     { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          recommendations: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          common_symptoms: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '4-6 common early symptoms of this condition (plain language)',
          },
          warning_signs: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '3-5 red-flag warning signs that warrant urgent medical attention',
          },
        },
        required: ['name', 'risk_level', 'score', 'reasoning', 'data_points', 'recommendations', 'common_symptoms', 'warning_signs'],
      },
    },
    discuss_with_provider: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    disclaimer:            { type: SchemaType.STRING },
  },
  required: ['overall_risk', 'overall_score', 'summary', 'conditions', 'discuss_with_provider', 'disclaimer'],
}

const PREGNANCY_CONDITIONS = `Conditions you MUST assess in this exact order (always include all six, even if data is sparse — say "insufficient data" in reasoning if so):
1. Cardiovascular disease (pregnancy-related)
2. Preeclampsia
3. Gestational diabetes
4. Preterm labor
5. Stillbirth (risk factors only — never diagnose)
6. Postpartum depression`

const POSTPARTUM_CONDITIONS = `The patient is POSTPARTUM (already delivered). Reframe the assessment around postpartum risks. Conditions you MUST assess in this exact order (always include all six, even if data is sparse — say "insufficient data" in reasoning if so):
1. Postpartum cardiovascular disease (peripartum cardiomyopathy, late postpartum cardiac risk)
2. Postpartum preeclampsia / hypertension (can occur up to 6 weeks postpartum)
3. Postpartum hemorrhage / anemia (late bleeding, low iron)
4. Postpartum depression
5. Postpartum thyroiditis or other endocrine recovery issues
6. Breastfeeding complications (mastitis, low supply) and pelvic / wound recovery`

const buildSystemPrompt = ({ isPostpartum }) => `You are a maternal-health risk-assessment assistant for a pregnancy tracking app called HeartToMom.

Your job: review a patient's health profile and recent check-in / vitals data, then produce a structured risk estimate.

${isPostpartum ? POSTPARTUM_CONDITIONS : PREGNANCY_CONDITIONS}

Rules:
- Base every assessment on established medical risk factors (maternal age, BMI, BP trends, history, AND race/ethnicity-based risk where clinically established — see explicit guidance below).
- Cite specific data points from the patient (e.g., "BP 132/85 on 2026-05-10", "Family history includes hypertension", "Prior preeclampsia"). Never fabricate numbers.
- If a key data point is missing, say so in 'data_points' (e.g., "No BP readings logged") rather than guessing.
- recommendations should be actionable, balanced (lifestyle + clinical), and ${isPostpartum ? 'postpartum-appropriate (consider lochia, recovery timeline, sleep deprivation, mental load).' : 'trimester-appropriate.'} Avoid alarmist language.
- For EVERY condition, also list:
    common_symptoms — 4-6 typical early symptoms in plain patient-facing language
    warning_signs   — 3-5 RED-FLAG signs that warrant urgent medical attention (heavier bleeding, severe headache, etc.)
- Overall score: weight conditions reasonably; if any one is high, overall is at least moderate.
- Disclaimer text must clearly say this is educational, not a diagnosis, and they should consult their provider.

Race & ethnicity as a risk factor (MANDATORY when 'race_ethnicity' is present in the profile):
- You MUST evaluate the patient's race/ethnicity against established maternal-health disparities for EACH condition.
- When the patient's race/ethnicity is associated with statistically elevated risk for a condition, you MUST:
    (a) raise that condition's score and risk_level accordingly,
    (b) explicitly cite the disparity in 'reasoning' (e.g., "Black women face a 3–4x higher rate of pregnancy-related mortality and preeclampsia in the U.S., which raises baseline risk."),
    (c) include the race-based risk factor as an entry in 'data_points' (e.g., "Race/ethnicity: Black or African American — elevated baseline preeclampsia and maternal mortality risk").
- Established disparities to apply (U.S. clinical literature — use these when relevant):
    • Black / African American — 3–4x higher pregnancy-related mortality; higher rates of preeclampsia, severe maternal morbidity, preterm labor, stillbirth, and postpartum cardiovascular complications.
    • American Indian / Alaska Native — ~2x higher pregnancy-related mortality; higher rates of preeclampsia and postpartum hemorrhage.
    • Native Hawaiian / Pacific Islander — elevated gestational diabetes and preeclampsia risk.
    • Asian (especially South / Southeast Asian) — elevated gestational diabetes risk at lower BMIs.
    • Hispanic / Latina — elevated gestational diabetes risk; higher postpartum depression underdiagnosis.
    • Middle Eastern / North African — limited disaggregated data; flag if combined with other risk factors.
    • White / "Prefer not to say" / "Other" — apply other risk factors normally; do not invent a race-based elevation.
- If the patient selected multiple races/ethnicities, apply the disparities that intersect with each.
- Never use race to LOWER a risk score — only to raise it where evidence supports it, or leave it unchanged.
- If race/ethnicity is missing or "Prefer not to say", note it in 'data_points' as "Race/ethnicity not provided — race-based risk modifiers not applied" and do not speculate.

Return JSON matching the provided schema exactly. No markdown, no preamble.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: 'Server misconfigured. Missing GEMINI_API_KEY or Supabase env vars.',
    })
  }

  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }

  try {
    // User-scoped client — RLS keeps queries to this user's rows only.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return res.status(401).json({ error: 'Invalid auth token' })
    }

    // Try to parse the trigger label from the request body (optional).
    let triggeredBy = 'manual'
    let bodyParsed = {}
    try {
      bodyParsed = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      if (bodyParsed.trigger) triggeredBy = String(bodyParsed.trigger).slice(0, 32)
    } catch { /* ignore — keep default */ }

    // Fetch the patient data first — we need profile.updated_at to decide
    // whether the cache is still valid.
    const [{ data: profile }, { data: checkIns }, { data: vitals }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('check_ins').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(7),
      supabase.from('vitals').select('*').eq('user_id', user.id)
        .order('recorded_at', { ascending: false }).limit(7),
    ])

    // Every check-in submit and every health-profile resubmit should produce a
    // fresh assessment — we don't cache those. Cache only kicks in for an
    // explicit 'manual' trigger (currently unused) so the option stays open.
    const SKIP_CACHE_TRIGGERS = new Set(['check_in', 'onboarding'])
    if (!SKIP_CACHE_TRIGGERS.has(triggeredBy)) {
      const TEN_MIN_AGO = new Date(Date.now() - 10 * 60_000).toISOString()
      const { data: recent } = await supabase
        .from('risk_assessments')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', TEN_MIN_AGO)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recent) {
        return res.status(200).json({
          ...recent,
          cached: true,
          generated_at: recent.created_at,
        })
      }
    }

    const prompt = buildUserPrompt({ profile, checkIns: checkIns ?? [], vitals: vitals ?? [] })

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: buildSystemPrompt({ isPostpartum: !!profile?.is_postpartum }),
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RISK_SCHEMA,
        temperature: 0.3,
      },
    })

    let result
    try {
      result = await model.generateContent(prompt)
    } catch (err) {
      const msg = err.message ?? String(err)
      // Translate Gemini rate-limit errors into a clear 429 for the client.
      if (/429|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg)) {
        return res.status(429).json({
          error: 'Gemini rate limit reached (15 requests/min on free tier). Wait ~60 seconds and try again.',
        })
      }
      // 404 = bad model name; 401/403 = bad API key
      if (/404|not found/i.test(msg)) {
        return res.status(502).json({ error: `Gemini model unavailable: ${msg}` })
      }
      if (/401|403|API key|unauthorized/i.test(msg)) {
        return res.status(502).json({ error: 'Gemini API key rejected. Check GEMINI_API_KEY env var.' })
      }
      throw err
    }

    const text = result.response.text()

    let assessment
    try {
      assessment = JSON.parse(text)
    } catch {
      return res.status(502).json({ error: 'AI returned malformed JSON', raw: text })
    }

    const dataUsed = {
      profile_present: !!profile,
      check_ins_count: checkIns?.length ?? 0,
      vitals_count:    vitals?.length ?? 0,
    }

    // Persist this assessment so the dashboard + track-health pages can read it later.
    const { data: saved, error: saveErr } = await supabase
      .from('risk_assessments')
      .insert({
        user_id:       user.id,
        overall_risk:  assessment.overall_risk,
        overall_score: assessment.overall_score,
        summary:       assessment.summary,
        conditions:    assessment.conditions,
        discuss_with_provider: assessment.discuss_with_provider ?? [],
        disclaimer:    assessment.disclaimer,
        triggered_by:  triggeredBy,
        data_used:     dataUsed,
      })
      .select()
      .maybeSingle()

    if (saveErr) {
      // Don't fail the whole request just because persistence failed —
      // still hand the assessment back to the UI.
      console.warn('Failed to persist risk_assessment:', saveErr)
    }

    return res.status(200).json({
      ...assessment,
      id: saved?.id,
      generated_at: saved?.created_at ?? new Date().toISOString(),
      triggered_by: triggeredBy,
      data_used: dataUsed,
    })
  } catch (err) {
    console.error('risk-assessment error:', err)
    return res.status(500).json({ error: err.message ?? 'Internal error' })
  }
}

function buildUserPrompt({ profile, checkIns, vitals }) {
  return [
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Patient health profile',
    profile ? JSON.stringify(redactedProfile(profile), null, 2) : '(no profile data yet)',
    '',
    `## Recent daily check-ins (last ${checkIns.length})`,
    checkIns.length
      ? JSON.stringify(checkIns.map((row) => stripFields(row, ['id', 'user_id'])), null, 2)
      : '(no check-in data yet)',
    '',
    `## Recent vitals (last ${vitals.length})`,
    vitals.length
      ? JSON.stringify(vitals.map((row) => stripFields(row, ['id', 'user_id'])), null, 2)
      : '(no vitals data yet)',
    '',
    'Now produce the JSON risk assessment.',
  ].join('\n')
}

// Strip fields the model doesn't need to reduce tokens + leak surface
function redactedProfile(p) {
  return stripFields(p, ['id', 'created_at', 'updated_at', 'onboarding_completed'])
}

function stripFields(row, fields) {
  const copy = { ...row }
  fields.forEach((field) => delete copy[field])
  return copy
}
