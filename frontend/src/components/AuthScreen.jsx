// AuthScreen.jsx -- sign in / sign up screen shown when user is not logged in
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function AuthScreen() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth()
  const [mode, setMode] = useState('signin')  // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await signInWithEmail(email, password)
        if (error) setError(error.message)
      } else {
        const { error } = await signUpWithEmail(email, password)
        if (error) setError(error.message)
        else setMessage('Check your email for a confirmation link.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    const { error } = await signInWithGoogle()
    if (error) setError(error.message)
  }

  return (
    <div style={s.screen}>
      <div style={s.card}>
        <img src="/logo.jpg" alt="Clean Cart" style={s.logo} />
        <h1 style={s.title}>Clean Cart</h1>
        <p style={s.sub}>Shop clean. Eat better.</p>

        <button style={s.googleBtn} onClick={handleGoogle}>
          <GoogleIcon />
          Continue with Google
        </button>

        <div style={s.divider}><span style={s.dividerText}>or</span></div>

        <form onSubmit={handleEmailSubmit} style={s.form}>
          <input
            style={s.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            style={s.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p style={s.error}>{error}</p>}
          {message && <p style={s.success}>{message}</p>}
          <button style={s.submitBtn} type="submit" disabled={busy}>
            {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button style={s.switchBtn} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null) }}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8, flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

const s = {
  screen: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(160deg, #F7F6F3 0%, #E8F5E9 100%)',
    padding: 20,
  },
  card: {
    background: '#fff',
    borderRadius: 28,
    padding: '44px 28px 36px',
    width: '100%',
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
    animation: 'fadeIn 0.4s ease',
  },
  logo: { width: 68, height: 68, borderRadius: 18, objectFit: 'cover', marginBottom: 14, boxShadow: '0 4px 16px rgba(27,94,32,0.15)' },
  title: { fontSize: 28, fontWeight: 900, color: '#1B5E20', margin: '0 0 4px', letterSpacing: '-0.6px' },
  sub: { fontSize: 15, color: '#999', margin: '0 0 32px', fontWeight: 400 },
  googleBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 20px',
    background: '#fff',
    border: '1.5px solid #E8E6E3',
    borderRadius: 14,
    fontSize: 15,
    fontWeight: 600,
    color: '#333',
    cursor: 'pointer',
    marginBottom: 22,
    transition: 'border-color 0.15s, background 0.15s',
  },
  divider: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    marginBottom: 22,
    gap: 14,
  },
  dividerText: { color: '#D5D5D5', fontSize: 13, whiteSpace: 'nowrap', fontWeight: 500 },
  form: { width: '100%', display: 'flex', flexDirection: 'column', gap: 12 },
  input: {
    width: '100%',
    padding: '14px 16px',
    border: '1.5px solid #E8E6E3',
    borderRadius: 14,
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  },
  error: { color: '#C62828', fontSize: 13, margin: '0', textAlign: 'center', fontWeight: 500 },
  success: { color: '#2E7D32', fontSize: 13, margin: '0', textAlign: 'center', fontWeight: 500 },
  submitBtn: {
    width: '100%',
    padding: '15px',
    background: 'linear-gradient(135deg, #1B5E20 0%, #2E7D32 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 14,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 4,
    boxShadow: '0 4px 20px rgba(27,94,32,0.25)',
    transition: 'transform 0.1s, box-shadow 0.1s',
  },
  switchBtn: {
    marginTop: 22,
    background: 'none',
    border: 'none',
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
