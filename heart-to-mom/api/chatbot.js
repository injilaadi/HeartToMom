import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

const SYSTEM_PROMPT_BASE = `You are a concise, caring assistant for HeartToMom, a pregnancy and maternal heart health app.
Be warm but brief — no filler phrases like "Of course!", "Great question!", or "I'm here for you!". Get straight to the point.
Use plain language. If a response is more than 4 sentences, add spacing between paragraphs.

Never downplay symptoms. Validate first, then inform. For serious symptoms (heavy bleeding, chest pain, severe headache, no fetal movement, sudden swelling), tell them to contact their provider or go to the ER immediately.

You support, you do not diagnose.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'Server misconfigured. Missing GEMINI_API_KEY env var.',
    })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const { messages = [], shouldRemind = false } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' })
    }

    const systemPrompt = shouldRemind
      ? `${SYSTEM_PROMPT_BASE}\n\nAt the start of your response, add one short sentence reminding the user to complete their daily check-in. Do not repeat this reminder again.`
      : SYSTEM_PROMPT_BASE

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: systemPrompt,
    })

    // Map the client's {role, content} -> Gemini's contents shape
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    let result
    try {
      result = await model.generateContent({ contents })
    } catch (err) {
      const msg = err.message ?? String(err)
      if (/429|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg)) {
        return res.status(429).json({ error: 'AI rate limit reached. Wait ~60 seconds and try again.' })
      }
      if (/404|not found/i.test(msg)) {
        return res.status(502).json({ error: `Gemini model unavailable: ${msg}` })
      }
      if (/401|403|API key|unauthorized/i.test(msg)) {
        return res.status(502).json({ error: 'Gemini API key rejected. Check GEMINI_API_KEY env var.' })
      }
      throw err
    }

    const text = result.response?.text?.()
    if (!text) {
      return res.status(502).json({ error: 'AI returned an empty response' })
    }

    return res.status(200).json({ content: text })
  } catch (err) {
    console.error('chatbot error:', err)
    return res.status(500).json({ error: err.message ?? 'Internal error' })
  }
}
