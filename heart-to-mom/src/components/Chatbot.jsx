import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

export default function Chatbot() {
    const { user } = useAuth()
    const [checkedInToday, setCheckedInToday] = useState(false)
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
        const newMessages = [...messages, { role: 'user', content: input }]
        setMessages(newMessages)
        setInput('')
        setLoading(true)

        const groqMessages = newMessages.filter((m, i) => !(m.role === 'assistant' && i === 0))

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system', content: `You are a warm, caring, and deeply empathetic assistant for HeartToMom, a pregnancy health tracking app.
You speak gently and kindly at all times — like a trusted friend who happens to know a lot about pregnancy and maternal health.

The user has ${checkedInToday ? 'already completed' : 'NOT yet completed'} their daily check-in today.
${!checkedInToday ? 'Gently remind them to complete their daily check-in before answering health questions — it only takes 90 seconds and helps personalize care 💗' : 'They have completed their check-in, so answer their questions normally.'}

When a user describes symptoms, never downplay or dismiss them. Take every symptom seriously and acknowledge how the user is feeling before responding. Always validate their concern first, then provide helpful information.
If symptoms sound serious (like heavy bleeding, severe headache, no fetal movement, chest pain, or sudden swelling), clearly and kindly encourage them to contact their healthcare provider or go to the ER immediately.

Always be encouraging, never clinical or cold. You are here to support, not to diagnose.`
                    },
                    ...groqMessages
                ],
            }),
        })
        const data = await res.json()
        setMessages([...newMessages, { role: 'assistant', content: data.choices[0].message.content }])
        setLoading(false)
    }

    return (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            {open && (
                <div style={{ width: 320, background: '#fff', borderRadius: 16, border: '1px solid #ede5e0', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
                    <div style={{ background: 'var(--rose-500)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>♥</div>
                        <div>
                            <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>HeartToMom Assistant</div>
                            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>Powered by Groq AI</div>
                        </div>
                    </div>
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--cream-50)', minHeight: 200, maxHeight: 300, overflowY: 'auto' }}>
                        {messages.map((m, i) => (
                            <div key={i} style={{
                                maxWidth: '80%', fontSize: 13, lineHeight: 1.45, padding: '8px 11px', borderRadius: 12,
                                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                background: m.role === 'user' ? 'var(--rose-500)' : '#fff',
                                color: m.role === 'user' ? '#fff' : 'var(--ink)',
                                border: m.role === 'user' ? 'none' : '1px solid #ede5e0',
                            }}>
                                {m.content}
                            </div>
                        ))}
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