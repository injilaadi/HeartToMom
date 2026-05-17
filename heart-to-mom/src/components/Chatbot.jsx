import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { triggerRiskAssessment } from '../lib/useRiskAssessment.js'

// Matches user-typed symptom mentions back to the daily check-in option labels.
const SYMPTOM_KEYWORDS = {
  'headache':            'Headache',
  'head ache':           'Headache',
  'migraine':            'Headache',
  'swelling':            'Swelling',
  'swollen':             'Swelling',
  'spotting':            'Spotting',
  'bleeding':            'Spotting',
  'cramp':               'Cramping',
  'shortness of breath': 'Shortness of breath',
  'short of breath':     'Shortness of breath',
  'sob':                 'Shortness of breath',
  "can't breathe":       'Shortness of breath',
  'sweating':            'Sweating',
  'sweaty':              'Sweating',
  'night sweats':        'Sweating',
  'fainting':            'Fainting',
  'fainted':             'Fainting',
  'passed out':          'Fainting',
  'dizzy':               'Fainting',
  'sad':                 'Persistent sadness',
  'depressed':           'Persistent sadness',
  'depression':          'Persistent sadness',
}

function detectSymptoms(text) {
  const lower = (text ?? '').toLowerCase()
  const found = new Set()
  for (const [keyword, label] of Object.entries(SYMPTOM_KEYWORDS)) {
    if (lower.includes(keyword)) found.add(label)
  }
  return [...found]
}

// Mirrors deriveRisk in TrackHealth.jsx so the locally-saved risk_score field
// stays consistent. The AI assessment is the authoritative score.
function deriveRisk(answers) {
  const high = ['No movement today', 'Spotting', 'Fainting']
  const moderate = [
    'Less than usual', 'Headache', 'Swelling', 'Cramping',
    'Shortness of breath', 'Sweating', 'Persistent sadness',
    'Poorly', 'Unwell',
  ]
  const values = Object.values(answers).flatMap((v) => (Array.isArray(v) ? v : [v]))
  if (values.some((v) => high.includes(v))) return 'high'
  if (values.some((v) => moderate.includes(v))) return 'moderate'
  return 'low'
}

export default function Chatbot() {
    const { user, loading: authLoading } = useAuth()
    const [checkedInToday, setCheckedInToday] = useState(false)
    const [reminderGiven, setReminderGiven] = useState(false)
    const [open, setOpen] = useState(false)
    const [messages, setMessages] = useState([
        { role: 'assistant', content: 'Hi! I\'m here to help with any health-related or pregnancy questions. What\'s on your mind?' }
    ])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!user) return
        const today = new Date().toISOString().split('T')[0]
        supabase
            .from('check_ins')
            .select('created_at')
            .eq('user_id', user.id)
            .gte('created_at', `${today}T00:00:00`)
            .limit(1)
            .maybeSingle()
            .then(({ data }) => setCheckedInToday(!!data))
    }, [user])

    const send = async () => {
        if (!input.trim()) return
        const userMsg = input
        const newMessages = [...messages, { role: 'user', content: userMsg }]
        setMessages(newMessages)
        setInput('')
        setLoading(true)

        const shouldRemind = !checkedInToday && !reminderGiven
        if (shouldRemind) setReminderGiven(true)

        // Detect symptoms mentioned in the user's message
        const symptoms = detectSymptoms(userMsg)

        // Drop the initial canned assistant greeting so it doesn't count as conversation
        const chatMessages = newMessages.filter((m, i) => !(m.role === 'assistant' && i === 0))

        try {
            const res = await fetch('/api/chatbot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: chatMessages,
                    shouldRemind,
                    detectedSymptoms: symptoms,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
            if (!data.content) throw new Error('Empty response from AI')

            // Append assistant reply, plus an action card if we detected symptoms
            const next = [...newMessages, { role: 'assistant', content: data.content }]
            if (symptoms.length > 0) {
                next.push({ role: 'system-action', symptoms, status: 'idle' })
            }
            setMessages(next)
        } catch (err) {
            console.error('Chatbot error:', err)
            setMessages([
                ...newMessages,
                {
                    role: 'assistant',
                    content: `Sorry — I couldn't reach the AI service. ${err.message ?? ''}`.trim(),
                },
            ])
        } finally {
            setLoading(false)
        }
    }

    // Adds the detected symptoms to today's check-in (or creates one with
    // neutral defaults), then triggers a fresh AI risk assessment.
    const handleLogSymptoms = async (msgIndex, symptoms) => {
        setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, status: 'loading' } : m))

        try {
            // Fetch profile (for is_postpartum default) + latest check-in
            const [{ data: profile }, { data: latest }] = await Promise.all([
                supabase.from('profiles').select('is_postpartum').eq('id', user.id).maybeSingle(),
                supabase.from('check_ins').select('*').eq('user_id', user.id)
                    .order('created_at', { ascending: false }).limit(1).maybeSingle(),
            ])

            const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000
            const recent = latest && (Date.now() - new Date(latest.created_at).getTime() < TWELVE_HOURS_MS)

            let answers
            if (recent && latest.answers) {
                // Merge with existing — strip "None" if present, add new symptoms
                const existing = Array.isArray(latest.answers.symptoms) ? latest.answers.symptoms : []
                const merged = [...new Set([...existing.filter(s => s !== 'None'), ...symptoms])]
                answers = { ...latest.answers, symptoms: merged }
                await supabase.from('check_ins').update({
                    answers,
                    risk_score: deriveRisk(answers),
                }).eq('id', latest.id)
            } else {
                // Fresh check-in with neutral defaults + the detected symptoms
                answers = {
                    mood: 'Okay',
                    movement: profile?.is_postpartum ? 'Postpartum (delivered)' : 'N/A',
                    symptoms,
                    sleep: 'Okay',
                    meds: 'Yes',
                }
                await supabase.from('check_ins').insert({
                    user_id: user.id,
                    answers,
                    risk_score: deriveRisk(answers),
                })
            }

            // Trigger the AI to recompute the risk score
            const result = await triggerRiskAssessment('check_in')

            const resultMsg = result.ok && result.data
                ? `Logged ${symptoms.join(', ')}. Your risk is now **${result.data.overall_risk.toUpperCase()}** (${result.data.overall_score}/100). View the breakdown on the Track your health page.`
                : `Logged ${symptoms.join(', ')}, but I couldn't refresh your risk score: ${result.error ?? 'unknown error'}.`

            setMessages(prev => prev.map((m, i) => i === msgIndex
                ? { ...m, status: 'done', result: resultMsg }
                : m
            ))
        } catch (err) {
            console.error('handleLogSymptoms error:', err)
            setMessages(prev => prev.map((m, i) => i === msgIndex
                ? { ...m, status: 'error', error: err.message ?? 'Could not log symptoms.' }
                : m
            ))
        }
    }

    // Only show the assistant for signed-in users
    if (authLoading || !user) return null

    return (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            {open && (
                <div style={{ width: 320, background: '#fff', borderRadius: 16, border: '1px solid #ede5e0', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
                    <div style={{ background: 'var(--rose-500)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>♥</div>
                        <div>
                            <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>HeartToMom Assistant</div>
                            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>Powered by Gemini AI</div>
                        </div>
                    </div>
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--cream-50)', minHeight: 200, maxHeight: 300, overflowY: 'auto' }}>
                        {messages.map((m, i) => {
                            if (m.role === 'system-action') {
                                const isDone = m.status === 'done'
                                const isLoading = m.status === 'loading'
                                const isError = m.status === 'error'
                                return (
                                    <div key={i} style={{
                                        alignSelf: 'stretch', padding: '10px 12px', borderRadius: 12,
                                        background: isError ? '#fae6e7' : isDone ? '#eaf1e3' : '#faf2dc',
                                        border: `1px dashed ${isError ? '#ecc4c7' : isDone ? '#c9dec6' : '#ecdaa6'}`,
                                        fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
                                    }}>
                                        {isDone ? (
                                            <span>✓ {m.result}</span>
                                        ) : isError ? (
                                            <span>⚠ {m.error}</span>
                                        ) : isLoading ? (
                                            <span>Updating your risk score…</span>
                                        ) : (
                                            <>
                                                <div style={{ marginBottom: 8 }}>
                                                    I noticed you mentioned <strong>{m.symptoms.join(', ')}</strong>. Want me to log it and refresh your risk score?
                                                </div>
                                                <button
                                                    onClick={() => handleLogSymptoms(i, m.symptoms)}
                                                    style={{
                                                        background: 'var(--rose-500)', color: '#fff', border: 'none',
                                                        borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Log &amp; update score
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )
                            }
                            return (
                                <div key={i} style={{
                                    maxWidth: '80%', fontSize: 13, lineHeight: 1.45, padding: '8px 11px', borderRadius: 12,
                                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    background: m.role === 'user' ? 'var(--rose-500)' : '#fff',
                                    color: m.role === 'user' ? '#fff' : 'var(--ink)',
                                    border: m.role === 'user' ? 'none' : '1px solid #ede5e0',
                                }}>
                                    {m.content.split('\n').map((line, j) => (
                                        <span key={j}>{line}{j < m.content.split('\n').length - 1 && <br />}</span>
                                    ))}
                                </div>
                            )
                        })}
                        {loading && <div style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'flex-start' }}>Typing…</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderTop: '1px solid #ede5e0', background: '#fff' }}>
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && send()}
                            placeholder="Ask a question…"
                            style={{ flex: 1, background: 'var(--cream-50)', border: '1px solid #ede5e0', borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none' }}
                        />
                        <button onClick={send} style={{ width: 32, height: 32, background: 'var(--rose-500)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 16 }}>→</button>
                    </div>
                </div>
            )}
            <button
                onClick={() => setOpen(!open)}
                style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--rose-500)', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', boxShadow: '0 3px 12px rgba(201,123,127,0.35)' }}
            >
                {open ? '✕' : '♥'}
            </button>
        </div>
    )
}