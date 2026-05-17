import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import './pages-common.css'
import './Prepare.css'

const POSTS = [
  {
    id: 1,
    category: 'Birth plan',
    title: 'Writing a flexible birth plan you’ll actually use',
    excerpt: 'A real birth plan covers your top 3 priorities — not 30 micro-decisions. Here’s how to draft one in 20 minutes.',
    read: '6 min read',
    color: 'rose',
  },
  {
    id: 2,
    category: 'Hospital bag',
    title: 'The hospital bag checklist for week 36',
    excerpt: 'Pack early so you can grab and go. We organized the list by who uses it: you, baby, partner.',
    read: '4 min read',
    color: 'cream',
  },
  {
    id: 3,
    category: 'Nutrition',
    title: 'Iron-rich meals for the third trimester',
    excerpt: 'Why iron needs jump in T3 — and a week of meals that hit the target without supplements.',
    read: '5 min read',
    color: 'green',
  },
  {
    id: 4,
    category: 'Mental health',
    title: 'Spotting prenatal anxiety vs. normal worry',
    excerpt: 'Some unease is expected. These four patterns are worth flagging to your provider.',
    read: '7 min read',
    color: 'rose',
  },
  {
    id: 5,
    category: 'Newborn care',
    title: 'The first 48 hours at home',
    excerpt: 'Sleep windows, feeding cadence, when to call the pediatrician — a calm walkthrough.',
    read: '8 min read',
    color: 'cream',
  },
  {
    id: 6,
    category: 'Postpartum',
    title: 'What recovery actually looks like after a C-section',
    excerpt: 'Weeks 1, 2, 4, and 6 — what’s normal, what to watch, and what no one warns you about.',
    read: '6 min read',
    color: 'green',
  },
]

export default function Prepare() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [user])

  return (
    <div className="page">
      <NavBar profile={profile} />

      <main className="page__main">
        <header className="page__head">
          <p className="page__eyebrow">RESOURCES</p>
          <h1 className="page__title">Prepare for motherhood</h1>
          <p className="page__lede">
            Short reads picked for your trimester, plus a focused checklist for what to do next.
          </p>
        </header>

        <div className="pr__grid">
          {POSTS.map((p) => (
            <article key={p.id} className="card pr__post">
              <div className={`pr__cover pr__cover--${p.color}`} aria-hidden>
                <span className="pr__cover-label">{p.category}</span>
              </div>
              <div className="pr__body">
                <p className="pr__category">{p.category}</p>
                <h2 className="pr__title">{p.title}</h2>
                <p className="pr__excerpt">{p.excerpt}</p>
                <div className="pr__meta">
                  <span>{p.read}</span>
                  <span className="pr__arrow" aria-hidden>→</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  )
}

