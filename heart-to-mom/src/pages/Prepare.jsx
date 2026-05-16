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

const CHECKLISTS = {
  first: [
    'Confirm first prenatal appointment',
    'Start or review prenatal vitamins',
    'Save urgent symptoms to watch for',
  ],
  second: [
    'Schedule anatomy scan',
    'Review blood pressure baseline',
    'Choose a birth support person',
  ],
  third: [
    'Pack hospital bag',
    'Install car seat',
    'Write postpartum support plan',
  ],
  general: [
    'Update emergency contacts',
    'Add provider phone number',
    'Prepare questions for next appointment',
  ],
}

export default function Prepare() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [checked, setChecked] = useState([])

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [user])

  const trimester = getTrimester(profile?.due_date)
  const checklist = CHECKLISTS[trimester.key] ?? CHECKLISTS.general
  const completed = checked.length

  const toggleChecklist = (item) => {
    setChecked((current) => (
      current.includes(item)
        ? current.filter((value) => value !== item)
        : [...current, item]
    ))
  }

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

        <section className="pr__planner">
          <div className="pr__planner-copy">
            <p className="pr__kicker">{trimester.label}</p>
            <h2>{trimester.heading}</h2>
            <p>{trimester.copy}</p>
          </div>

          <div className="pr__checklist">
            <div className="pr__checklist-head">
              <span>Next steps</span>
              <span>{completed}/{checklist.length}</span>
            </div>
            {checklist.map((item) => (
              <button
                key={item}
                className={`pr__check ${checked.includes(item) ? 'is-done' : ''}`}
                onClick={() => toggleChecklist(item)}
              >
                <span aria-hidden>{checked.includes(item) ? '✓' : ''}</span>
                {item}
              </button>
            ))}
          </div>
        </section>

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

function getTrimester(dueDate) {
  if (!dueDate) {
    return {
      key: 'general',
      label: 'PERSONALIZED PREP',
      heading: 'Start with the essentials',
      copy: 'Add your due date in your health profile to unlock trimester-specific planning.',
    }
  }

  const due = new Date(dueDate)
  const now = new Date()
  const weeksToGo = Math.max(0, Math.ceil((due - now) / (7 * 24 * 60 * 60 * 1000)))
  const week = Math.max(1, Math.min(40, 40 - weeksToGo))

  if (week <= 13) {
    return {
      key: 'first',
      label: `WEEK ${week} · FIRST TRIMESTER`,
      heading: 'Build your care foundation',
      copy: 'Focus on appointments, baseline health data, and early symptom awareness.',
    }
  }

  if (week <= 27) {
    return {
      key: 'second',
      label: `WEEK ${week} · SECOND TRIMESTER`,
      heading: 'Plan the support system',
      copy: 'This is a good time to organize scans, daily routines, and birth preferences.',
    }
  }

  return {
    key: 'third',
    label: `WEEK ${week} · THIRD TRIMESTER`,
    heading: 'Prepare for delivery and recovery',
    copy: 'Prioritize hospital logistics, postpartum support, and warning-sign readiness.',
  }
}
