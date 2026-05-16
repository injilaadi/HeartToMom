import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import './Home.css'

export default function Home() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  const firstName =
    user?.user_metadata?.full_name?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there'

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="home">
      <header className="home__nav">
        <div className="home__brand">
          <span className="home__brand-mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </span>
          <span>HeartToMom</span>
        </div>

        <button className="home__logout" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <main className="home__main">
        <p className="home__greeting">Good morning, {firstName}</p>
        <h1 className="home__title">Welcome to HeartToMom</h1>
        <p className="home__lede">
          Your dashboard will live here — pregnancy progress, vitals, upcoming
          appointments, and your daily check-in.
        </p>

        <div className="home__placeholder">
          <span aria-hidden>🌸</span>
          <p>Dashboard coming soon</p>
        </div>
      </main>
    </div>
  )
}
