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
    title: 'How to Write a Birth Plan',
    excerpt: 'Make a birth plan to outline your preferences for labor, delivery, and newborn care to help guide your care team.',
    read: '6 min read',
    color: 'rose',
    link: 'https://www.babylist.com/hello-baby/how-to-write-a-birth-plan?msockid=01ed304136296ec034c0261c37f46f60',
  },
  {
    id: 2,
    category: 'Hospital bag',
    title: 'Hospital Bag Checklist: The Ultimate List of What to Pack for Mom, Baby & Partner',
    excerpt: 'Pack early so you can grab and go. We organized the list by who uses it: you, baby, partner.',
    read: '8 min read',
    color: 'cream',
    link: 'https://www.thebump.com/a/checklist-packing-a-hospital-bag'
  },
  {
    id: 3,
    category: 'Nutrition',
    title: 'Iron-rich meals for the third trimester',
    excerpt: 'Healthy pregnancy nutrition supports baby development and maternal health.',
    read: '7 min read',
    color: 'green',
    link: 'https://www.hopkinsmedicine.org/health/wellness-and-prevention/nutrition-during-pregnancy'
  },
  {
    id: 4,
    category: 'Mental health',
    title: 'Emotional Support During Pregnancy: Essential Strategies for a Healthy Journey',
    excerpt: 'Emotional support during pregnancy improves mental well-being and coping.',
    read: '7 min read',
    color: 'rose',
    link: 'https://neurolaunch.com/emotional-support-during-pregnancy/',
  },
  {
    id: 5,
    category: 'Newborn care',
    title: '10 tips for taking care of a newborn',
    excerpt: 'The first days with a newborn focus on feeding, sleep, and learning your baby’s cues.',
    read: '6 min read',
    color: 'cream',
    link: 'https://www.osfhealthcare.org/blog/first-days-of-newborn-care'
  },
  {
    id: 6,
    category: 'Postpartum',
    title: 'What recovery actually looks like after childbirth',
    excerpt: 'Recovery comes with physical healing, hormonal shifts, and emotional changes.',
    read: '7 min read',
    color: 'green',
    link: 'https://my.clevelandclinic.org/health/articles/postpartum'
  },
]

export default function Prepare() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!user) return

    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
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
            Short reads picked for your trimester. Tap any card to read.
          </p>
        </header>

        <div className="pr__grid">
          {POSTS.map((p) => (
            <a
              key={p.id}
              href={p.link || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="card pr__post"
            >
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
            </a>
          ))}
        </div>
      </main>
    </div>
  )
}
