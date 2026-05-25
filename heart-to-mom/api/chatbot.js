import { GoogleGenerativeAI } from '@google/generative-ai'
import { retrieveContext } from './_lib/rag.js'

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
    const { messages = [], shouldRemind = false, detectedSymptoms = [] } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' })
    }

    const reminderClause = shouldRemind
      ? `\n\nAt the start of your response, add one short sentence reminding the user to complete their daily check-in. Do not repeat this reminder again.`
      : ''

    const symptomClause = (Array.isArray(detectedSymptoms) && detectedSymptoms.length > 0)
      ? `\n\nThe user just mentioned these symptoms in their message: ${detectedSymptoms.join(', ')}. Briefly acknowledge them, indicate which (if any) warrant urgent care versus normal pregnancy variation, and end with one sentence inviting the user to log them on their daily check-in so their risk score reflects this.`
      : ''

    // RAG: ground the answer in the vetted knowledge base. Embed the latest user message,
    // retrieve the most relevant passages, and inject them into the system prompt.
    // Fails open — if retrieval errors, the assistant still answers from its own knowledge.
    let contextClause = ''
    try {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUserMessage?.content) {
        const { context } = await retrieveContext(lastUserMessage.content, { apiKey: GEMINI_API_KEY })
        if (context) {
          contextClause = `\n\nGround your answer in the following reference material from HeartToMom's vetted maternal-health knowledge base. Prefer it over your own assumptions. If it doesn't cover the question, answer what you safely can from general knowledge and suggest confirming with their provider. Do not mention that you were given reference material or quote these headings verbatim.\n\n<reference>\n${context}\n</reference>`
        }
      }
    } catch (err) {
      console.error('RAG retrieval failed (continuing without context):', err.message ?? err)
    }

    const systemPrompt = `${SYSTEM_PROMPT_BASE}${reminderClause}${symptomClause}${contextClause}`

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
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
