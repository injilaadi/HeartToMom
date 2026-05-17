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
        },
        required: ['name', 'risk_level', 'score', 'reasoning', 'data_points', 'recommendations'],
      },
    },
    discuss_with_provider: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    disclaimer:            { type: SchemaType.STRING },
  },
  required: ['overall_risk', 'overall_score', 'summary', 'conditions', 'discuss_with_provider', 'disclaimer'],
}

const SYSTEM_PROMPT = `You are a maternal-health risk-assessment assistant for a pregnancy tracking app called HeartToMom.

Your job: review a patient's health profile and recent check-in / vitals data, then produce a structured risk estimate for common pregnancy complications.

Conditions you MUST assess (always include all six, even if data is sparse — say "insufficient data" in reasoning if so):
1. Preeclampsia
2. Gestational diabetes
3. Cardiovascular disease (pregnancy-related)
4. Preterm labor
5. Stillbirth (risk factors only — never diagnose)
6. Postpartum depression

Rules:
- Base every assessment on established medical risk factors (maternal age, BMI, BP trends, history, ethnicity-based risk where clinically established).
- Cite specific data points from the patient (e.g., "BP 132/85 on 2026-05-10", "Family history includes hypertension", "Prior preeclampsia"). Never fabricate numbers.
- If a key data point is missing, say so in 'data_points' (e.g., "No BP readings logged") rather than guessing.
- recommendations should be actionable, balanced (lifestyle + clinical), and trimester-appropriate. Avoid alarmist language.
- Overall score: weight conditions reasonably; if any one is high, overall is at least moderate.
- Disclaimer text must clearly say this is educational, not a diagnosis, and they should consult their provider.

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

    const [{ data: profile }, { data: checkIns }, { data: vitals }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('check_ins').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(7),
      supabase.from('vitals').select('*').eq('user_id', user.id)
        .order('recorded_at', { ascending: false }).limit(7),
    ])

    const prompt = buildUserPrompt({ profile, checkIns: checkIns ?? [], vitals: vitals ?? [] })

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RISK_SCHEMA,
        temperature: 0.3,
      },
    })

    const result = await model.generateContent(prompt)
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

    // Try to parse the trigger label from the request body (optional).
    let triggeredBy = 'manual'
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      if (body.trigger) triggeredBy = String(body.trigger).slice(0, 32)
    } catch { /* ignore — keep default */ }

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
      ? JSON.stringify(checkIns.map(({ id, user_id, ...rest }) => rest), null, 2)
      : '(no check-in data yet)',
    '',
    `## Recent vitals (last ${vitals.length})`,
    vitals.length
      ? JSON.stringify(vitals.map(({ id, user_id, ...rest }) => rest), null, 2)
      : '(no vitals data yet)',
    '',
    'Now produce the JSON risk assessment.',
  ].join('\n')
}

// Strip fields the model doesn't need to reduce tokens + leak surface
function redactedProfile(p) {
  const { id, created_at, updated_at, onboarding_completed, ...rest } = p
  return rest
}
