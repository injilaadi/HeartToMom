import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import './Auth.css'

const FEATURES = [
  { icon: 'pulse',    label: 'Continuous BP and heart rate monitoring' },
  { icon: 'shield',   label: 'Early-warning risk detection' },
  { icon: 'calendar', label: 'Smart appointment recommendations' },
]

export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' | 'create'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [keepLoggedIn, setKeepLoggedIn] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const { signIn, signUp, signInWithOAuth } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate('/home')
      } else {
        const { data, error } = await signUp(email, password, { full_name: name })
        if (error) throw error
        // If email confirmations are on in Supabase, session will be null until the user confirms.
        if (data.session) navigate('/home')
        else setInfo('Check your email to confirm your account, then log in.')
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleOAuth = async (provider) => {
    setError('')
    setSubmitting(true)
    try {
      const { error } = await signInWithOAuth(provider)
      if (error) throw error
      // OAuth triggers a redirect; nothing to do here.
    } catch (err) {
      setError(err.message ?? `Could not sign in with ${provider}.`)
      setSubmitting(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <div className="auth">
      {/* Left marketing panel */}
      <aside className="auth__left">
        <span className="auth__bubble auth__bubble--top" aria-hidden />
        <span className="auth__bubble auth__bubble--bottom" aria-hidden />

        <header className="brand">
          <span className="brand__mark" aria-hidden>
            <HeartIcon />
          </span>
          <span className="brand__name">HeartToMom</span>
        </header>

        <div className="auth__pitch">
          <h1 className="auth__headline">
            Your pregnancy, with you every step.
          </h1>
          <p className="auth__sub">
            Track your health, sync your wearable, and get personalized
            guidance from week one to delivery.
          </p>

          <ul className="features">
            {FEATURES.map((f) => (
              <li key={f.label} className="features__item">
                <span className="features__icon" aria-hidden>
                  <FeatureIcon name={f.icon} />
                </span>
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="hipaa">
          <LockIcon />
          <span>HIPAA-compliant · your data stays private</span>
        </div>
      </aside>

      {/* Right auth panel */}
      <section className="auth__right">
        <div className="auth__card">
          <div className="tabs" role="tablist" aria-label="Authentication mode">
            <button
              role="tab"
              aria-selected={isLogin}
              className={`tabs__btn ${isLogin ? 'is-active' : ''}`}
              onClick={() => setMode('login')}
            >
              Log in
            </button>
            <button
              role="tab"
              aria-selected={!isLogin}
              className={`tabs__btn ${!isLogin ? 'is-active' : ''}`}
              onClick={() => setMode('create')}
            >
              Create account
            </button>
          </div>

          <h2 className="auth__title">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="auth__lede">
            {isLogin
              ? 'Pick up where you left off.'
              : 'Start tracking your pregnancy journey today.'}
          </p>

          <form className="form" onSubmit={handleSubmit}>
            {!isLogin && (
              <label className="field">
                <span className="field__label">Full name</span>
                <span className="field__input">
                  <UserIcon />
                  <input
                    type="text"
                    placeholder="Sarah Mitchell"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </span>
              </label>
            )}

            <label className="field">
              <span className="field__label">Email</span>
              <span className="field__input">
                <MailIcon />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </span>
            </label>

            <label className="field">
              <span className="field__label-row">
                <span className="field__label">Password</span>
                {isLogin && (
                  <button type="button" className="link-rose">
                    Forgot password?
                  </button>
                )}
              </span>
              <span className="field__input">
                <LockIcon small />
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="field__eye"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showPw} />
                </button>
              </span>
            </label>

            {isLogin ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={keepLoggedIn}
                  onChange={(e) => setKeepLoggedIn(e.target.checked)}
                />
                <span>Keep me logged in on this device</span>
              </label>
            ) : (
              <p className="tos">
                By creating an account you agree to our{' '}
                <a href="#terms" className="link-rose">Terms</a> and{' '}
                <a href="#privacy" className="link-rose">Privacy Policy</a>.
              </p>
            )}

            {error && <div className="banner banner--error">{error}</div>}
            {info && <div className="banner banner--info">{info}</div>}

            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting
                ? (isLogin ? 'Logging in…' : 'Creating account…')
                : (isLogin ? 'Log in' : 'Create account')}
            </button>
          </form>

          <div className="divider">
            <span>or continue with</span>
          </div>

          <div className="social">
            <button
              type="button"
              className="social__btn"
              onClick={() => handleOAuth('google')}
              disabled={submitting}
            >
              <GoogleIcon /> Google
            </button>
            <button
              type="button"
              className="social__btn"
              onClick={() => handleOAuth('apple')}
              disabled={submitting}
            >
              <AppleIcon /> Apple
            </button>
          </div>

          <p className="switch">
            {isLogin ? (
              <>
                New to HeartToMom?{' '}
                <button
                  type="button"
                  className="link-rose link-rose--bold"
                  onClick={() => setMode('create')}
                >
                  Create an account →
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="link-rose link-rose--bold"
                  onClick={() => setMode('login')}
                >
                  Log in →
                </button>
              </>
            )}
          </p>
        </div>
      </section>
    </div>
  )
}

/* ------- Inline SVG icons (kept local for zero deps) ------- */

function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function FeatureIcon({ name }) {
  if (name === 'pulse') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    )
  }
  if (name === 'shield') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <path d="M12 14v4M10 16h4" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg className="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  )
}

function UserIcon() {
  return (
    <svg className="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function LockIcon({ small }) {
  const s = small ? 18 : 16
  return (
    <svg className={small ? 'ico' : ''} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}

function EyeIcon({ open }) {
  if (!open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <path d="M1 1l22 22"/>
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44c-.28 1.48-1.12 2.73-2.39 3.58v2.98h3.86c2.26-2.08 3.58-5.15 3.58-8.8z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.93l-3.86-2.98c-1.07.72-2.44 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/>
      <path fill="#FBBC05" d="M5.27 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29A11.97 11.97 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09z"/>
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 12.04c-.03-2.81 2.3-4.16 2.41-4.23-1.32-1.93-3.36-2.19-4.09-2.22-1.74-.18-3.39 1.02-4.27 1.02-.89 0-2.24-1-3.69-.97-1.9.03-3.65 1.1-4.62 2.8-1.97 3.41-.5 8.45 1.41 11.22.94 1.36 2.05 2.88 3.5 2.83 1.41-.06 1.94-.91 3.64-.91 1.7 0 2.18.91 3.66.88 1.51-.03 2.47-1.38 3.4-2.74 1.07-1.57 1.51-3.1 1.54-3.18-.03-.01-2.95-1.13-2.98-4.5zM14.3 3.78c.78-.94 1.3-2.25 1.16-3.55-1.12.05-2.48.75-3.28 1.69-.72.83-1.35 2.17-1.18 3.45 1.25.1 2.52-.64 3.3-1.59z"/>
    </svg>
  )
}
