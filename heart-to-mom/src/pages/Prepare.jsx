import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import './pages-common.css'
import './Prepare.css'

const HEALTH_INFO_CARDS = [
  {
    title: 'Shortness of breath',
    desc: 'Can be common in pregnancy, but persistent or sudden breathlessness may indicate strain on the heart or lungs and should be monitored.',
  },
  {
    title: 'Swelling in legs',
    desc: 'Mild swelling is normal in pregnancy, but sudden or severe swelling could relate to circulation or blood pressure changes.',
  },
  {
    title: 'Chest discomfort',
    desc: 'Occasional discomfort can happen due to physical changes, but chest pain should always be evaluated by a medical professional.',
  },
  {
    title: 'Rapid heartbeat',
    desc: 'Heart rate can increase during pregnancy, but consistent palpitations may signal stress or cardiovascular changes.',
  },
  {
    title: 'Fatigue',
    desc: 'Very common in pregnancy, but extreme fatigue may sometimes indicate anemia or other underlying conditions.',
  },
]

const POSTS = [
  {
    id: 1,
    category: 'Birth plan',
    title: 'How to Write a Birth Plan',
    excerpt: 'Make a birth plan to outline your preferences for labor, delivery, and newborn care to help guide your care team.',
    read: '6 min read',
    color: 'rose',
    link: 'https://www.babylist.com/hello-baby/how-to-write-a-birth-plan?msockid=01ed304136296ec034c0261c37f46f60',
    image: 'https://images.babylist.com/image/upload/f_auto,q_auto:best,c_scale,w_1536/v1702413582/hello-baby/howto_write_birthplan_header.jpg',
  },
  {
    id: 2,
    category: 'Hospital bag',
    title: 'Hospital Bag Checklist: The Ultimate List of What to Pack for Mom, Baby & Partner',
    excerpt: 'Pack early so you can grab and go. We organized the list by who uses it: you, baby, partner.',
    read: '8 min read',
    color: 'cream',
    link: 'https://www.thebump.com/a/checklist-packing-a-hospital-bag',
    image: 'https://images.ctfassets.net/6m9bd13t776q/2IQXluIQy0RMxAMVfaI8qS/43fb18a7c2bc490820f5f03c77428506/hospital-bag-checklist-update-Stocksy-4118966.png?fm=webp&q=90'
  },
  {
    id: 3,
    category: 'Nutrition',
    title: 'Iron-rich meals for the third trimester',
    excerpt: 'Healthy pregnancy nutrition supports baby development and maternal health.',
    read: '7 min read',
    color: 'green',
    link: 'https://www.hopkinsmedicine.org/health/wellness-and-prevention/nutrition-during-pregnancy',
    image: 'https://images.unsplash.com/photo-1490818387583-1baba5e638af?auto=format&fit=crop&w=800&q=80'
  },
  {
    id: 4,
    category: 'Mental health',
    title: 'Emotional Support During Pregnancy: Essential Strategies for a Healthy Journey',
    excerpt: 'Emotional support during pregnancy improves mental well-being and coping.',
    read: '7 min read',
    color: 'rose',
    link: 'https://neurolaunch.com/emotional-support-during-pregnancy/',
    image: 'https://neurolaunch.com/wp-content/uploads/2024/10/emotional-support-during-pregnancy-essential-strategies-for-a-healthy-journey.webp'
  },
  {
    id: 5,
    category: 'Newborn care',
    title: '10 tips for taking care of a newborn',
    excerpt: 'The first days with a newborn focus on feeding, sleep, and learning your baby’s cues.',
    read: '6 min read',
    color: 'cream',
    link: 'https://www.osfhealthcare.org/blog/first-days-of-newborn-care',
    image: 'https://osf-blog.live.imagescape.com/blog/wp-content/uploads/2024/02/shutterstock_1377908249.jpg'
  },
  {
    id: 6,
    category: 'Postpartum',
    title: 'What recovery actually looks like after childbirth',
    excerpt: 'Recovery comes with physical healing, hormonal shifts, and emotional changes.',
    read: '7 min read',
    color: 'green',
    link: 'https://my.clevelandclinic.org/health/articles/postpartum',
    image: 'https://my.clevelandclinic.org/-/scassets/images/org/health/articles/postpartum'
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
            Short reads picked for your trimester, plus a focused checklist for what to do next.
          </p>
        </header>

        <section className="pr__info-strip">
          <h2 className="pr__info-title">Health awareness signals</h2>

          <div className="pr__info-scroll">
            {HEALTH_INFO_CARDS.map((card, idx) => (
              <div key={idx} className="pr__info-card">
                <h3>{card.title}</h3>
                <p>{card.desc}</p>
              </div>
            ))}
          </div>
        </section>






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
                <img
                  src={p.image || 'https://via.placeholder.com/600x400?text=No+Image'}
                  alt={p.category}
                  className="pr__image"
                />
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
