import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import './NavBar.css'

const LINKS = [
  { to: '/home',          label: 'Home',                   icon: 'home' },
  { to: '/track-health',  label: 'Track your health',      icon: 'pulse' },
  { to: '/sync-wearable', label: 'Sync wearable',          icon: 'watch' },
  { to: '/prepare',       label: 'Prepare for motherhood', icon: 'stroller' },
]

export default function NavBar({ profile }) {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey   = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // If we somehow render with no signed-in user, don't render the navbar at all —
  // a ProtectedRoute should be redirecting them, but rendering an empty avatar
  // is worse than rendering nothing for the brief render before the redirect.
  if (!user) return null

  const fullName =
    profile?.full_name
    ?? user.user_metadata?.full_name
    ?? user.user_metadata?.name
    ?? user.email?.split('@')[0]
    ?? ''
  const initials = makeInitials(fullName, user.email)
  const displayEmail = user.email ?? ''

  const handleSignOut = async () => {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <header className="nav">
      <NavLink to="/home" className="nav__brand">
        <span className="nav__brand-mark" aria-hidden><HeartIcon /></span>
        <span className="nav__brand-name">HeartToMom</span>
      </NavLink>

      <nav className="nav__links" aria-label="Primary">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `nav__link ${isActive ? 'is-active' : ''}`
            }
          >
            <Icon name={l.icon} />
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="nav__avatar-wrap" ref={ref}>
        <button
          className="nav__avatar"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
        >
          {initials}
        </button>

        {open && (
          <div className="nav__menu" role="menu">
            <div className="nav__menu-head">
              <p className="nav__menu-name">{fullName || displayEmail || 'Account'}</p>
              {displayEmail && fullName !== displayEmail && (
                <p className="nav__menu-email">{displayEmail}</p>
              )}
            </div>
            <button
              className="nav__menu-item"
              role="menuitem"
              onClick={() => { setOpen(false); navigate('/onboarding') }}
            >
              Edit health profile
            </button>
            <button
              className="nav__menu-item nav__menu-item--danger"
              role="menuitem"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

/* ----------- helpers ----------- */

function makeInitials(name, email) {
  const source = (name && name.trim()) || (email && email.split('@')[0]) || '?'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function Icon({ name }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'home':
      return (<svg {...p}><path d="M3 11l9-8 9 8" /><path d="M5 9v12h14V9" /></svg>)
    case 'pulse':
      return (<svg {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>)
    case 'watch':
      return (<svg {...p}><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 6V3h6v3M9 18v3h6v-3"/></svg>)
    case 'stroller':
      return (<svg {...p}><path d="M3 7h7l8 8h-3"/><circle cx="7" cy="20" r="2"/><circle cx="17" cy="20" r="2"/><path d="M3 7l1 8h7"/></svg>)
    default: return null
  }
}
