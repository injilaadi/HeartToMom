import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

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
        const newMessages = [...messages, { role: 'user', content: input }]
        setMessages(newMessages)
        setInput('')
        setLoading(true)

        const shouldRemind = !checkedInToday && !reminderGiven
        if (shouldRemind) setReminderGiven(true)

        // Drop the initial canned assistant greeting so it doesn't count as conversation
        const chatMessages = newMessages.filter((m, i) => !(m.role === 'assistant' && i === 0))

        try {
            const res = await fetch('/api/chatbot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatMessages, shouldRemind }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
            if (!data.content) throw new Error('Empty response from AI')
            setMessages([...newMessages, { role: 'assistant', content: data.content }])
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
                        {messages.map((m, i) => (
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