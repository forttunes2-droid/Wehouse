import { useState, useEffect } from 'react';
import { signUpWithEmail, signInWithEmail, signInWithGoogle, resetPassword, runDiagnostics } from '@/lib/supabase';
import { Input } from '@/components/ui/input';

interface LoginProps {
  onLoginSuccess: (authId: string, email: string, role?: 'user' | 'worker') => void;
  serverError: string;
}

type Mode = 'choose' | 'choose_role' | 'signin' | 'signup' | 'forgot';

// ─── ERROR TRANSLATION ─────────────────────────────
function friendlyError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes('api key') || msg.includes('invalid key')) {
    return 'Authentication service not configured. Please contact support.';
  }
  if (msg.includes('deleted') || msg.includes('this account has been deleted')) {
    return 'This account has been deleted. Please contact support if you believe this is an error.';
  }
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Invalid email or password. Please check and try again.';
  }
  if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }
  if (msg.includes('user already registered') || msg.includes('already registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (msg.includes('user not found')) {
    return 'No account found with this email. Please sign up first.';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
    return 'Connection failed. Please check your internet and try again.';
  }
  if (msg.includes('timeout')) {
    return 'Request timed out. Please try again.';
  }
  if (msg.includes('password') && msg.includes('weak')) {
    return 'Password is too weak. Use at least 6 characters.';
  }
  if (msg.includes('for security')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return raw.length > 120 ? 'Something went wrong. Please try again.' : raw;
}

// ─── PASSWORD VISIBILITY ICON ──────────────────────

function EyeIcon({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-[#8B8DA0] transition-colors p-1"
      aria-label={visible ? 'Hide password' : 'Show password'}
    >
      {visible ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
          <path d="M9.88 9.88l4.24 4.24M14.12 9.88l-4.24 4.24" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────

export default function Login({ onLoginSuccess, serverError }: LoginProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [signupRole, setSignupRole] = useState<'user' | 'worker'>('user');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [diag, setDiag] = useState<string | null>(null);

  // Run diagnostics once on mount — log to console, don't block UI
  useEffect(() => {
    runDiagnostics().then((result) => {
      console.log('[WeHouse Diagnostics]', result);
      if (result.authTest !== 'ok') {
        setDiag(`Auth: ${result.authTest}${result.authError ? ` — ${result.authError}` : ''}`);
      }
    });
  }, []);

  const displayError = error || serverError;

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))]);
  }

  async function handleSubmit(e: React.FormEvent, isSignup: boolean) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email.includes('@')) { setError('Enter a valid email address'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setWorking(true);

    try {
      if (isSignup) {
        const { data, error: err } = await withTimeout(signUpWithEmail(email.trim(), password), 15000);
        if (err) {
          console.error('[WeHouse SignUp Error]', err.message);
          setError(friendlyError(err.message));
        } else if (data.session?.user) {
          onLoginSuccess(data.session.user.id, data.session.user.email || email, signupRole);
        } else if (data.user) {
          setInfo('Account created! Check your email to confirm.');
        } else {
          setError('Signup incomplete. Please try again.');
        }
      } else {
        const { data, error: err } = await withTimeout(signInWithEmail(email.trim(), password), 15000);
        if (err) {
          console.error('[WeHouse SignIn Error]', err.message);
          setError(friendlyError(err.message));
        } else if (data.session?.user) {
          onLoginSuccess(data.session.user.id, data.session.user.email || email);
        } else {
          setError('Login failed. Please try again.');
        }
      }
    } catch (err: any) {
      console.error('[WeHouse Login Catch]', err);
      setError(friendlyError(err?.message || 'Connection timeout'));
    } finally {
      setWorking(false);
    }
  }

  async function handleGoogle() {
    setWorking(true);
    const { error: err } = await signInWithGoogle();
    if (err) {
      console.error('[WeHouse Google Error]', err.message);
      setError(friendlyError(err.message));
      setWorking(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) { setError('Enter a valid email address'); return; }
    setWorking(true);
    const { error: err } = await resetPassword(email.trim());
    if (err) {
      console.error('[WeHouse Forgot Error]', err.message);
      setError(friendlyError(err.message));
    } else {
      setInfo('Reset link sent! Check your email inbox.');
    }
    setWorking(false);
  }

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center px-5">
      <div className="w-full max-w-[360px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center mx-auto mb-4 glow-blue">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">WeHouse</h1>
          <p className="text-xs text-[#5C5E72] mt-1">We make living easy</p>
        </div>

        {/* Diagnostic info (subtle, for debugging) */}
        {diag && (
          <details className="mb-3">
            <summary className="text-[10px] text-[#5C5E72] cursor-pointer hover:text-[#8B8DA0]">Debug info</summary>
            <div className="mt-1 p-2 rounded-lg bg-[#1A1A24] border border-[#232330] text-[10px] text-[#5C5E72] font-mono break-all">
              {diag}
            </div>
          </details>
        )}

        {/* Messages */}
        {displayError && (
          <div className={`mb-4 p-3 rounded-xl border text-xs text-center leading-relaxed ${
            displayError.toLowerCase().includes('deleted')
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            <p className="mb-2">{displayError}</p>
            {displayError.toLowerCase().includes('deleted') && (
              <div className="flex gap-2 justify-center pt-1">
                <button
                  type="button"
                  onClick={() => { setMode('choose_role'); setError(''); setEmail(''); setPassword(''); }}
                  className="px-3 py-1.5 rounded-lg bg-[#3B82F6] text-white text-[10px] font-medium hover:bg-[#2563EB] transition-colors"
                >
                  Create New Account
                </button>
                <button
                  type="button"
                  onClick={() => setError('')}
                  className="px-3 py-1.5 rounded-lg bg-[#1A1A24] border border-[#232330] text-[#8A8B9C] text-[10px] font-medium hover:text-white transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
        {info && (
          <div className="mb-4 p-3 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-[#3B82F6] text-xs text-center leading-relaxed">
            {info}
          </div>
        )}

        {/* Choose */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <button onClick={handleGoogle} disabled={working} className="w-full h-12 rounded-xl bg-white text-[#0A0A0F] font-medium text-sm flex items-center justify-center gap-2 hover:bg-white/90 transition-colors disabled:opacity-50">
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
              Continue with Google
            </button>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
              <div className="relative flex justify-center"><span className="bg-[#0A0A0F] px-4 text-[10px] text-[#5C5E72] uppercase tracking-wider">or</span></div>
            </div>

            <button onClick={() => { setMode('signin'); setError(''); }} className="w-full h-12 rounded-xl bg-[#1A1A24] text-white font-medium text-sm border border-[#232330] hover:border-[#3B82F6]/50 hover:bg-[#1E1E2C] transition-all">
              Sign In with Email
            </button>
            <button onClick={() => { setMode('choose_role'); setError(''); }} className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm hover:bg-[#2563EB] transition-colors glow-blue-sm">
              Create Account
            </button>
          </div>
        )}

        {/* Choose Role */}
        {mode === 'choose_role' && (
          <div className="space-y-3">
            <p className="text-xs text-[#5C5E72] text-center mb-2">I want to...</p>

            <button onClick={() => { setSignupRole('user'); setMode('signup'); setError(''); }}
              className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-left card-hover group">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center group-hover:bg-[#3B82F6]/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Find Housing</div>
                <div className="text-[10px] text-[#5C5E72]">Browse listings, roommates, services</div>
              </div>
            </button>

            <button onClick={() => { setSignupRole('worker'); setMode('signup'); setError(''); }}
              className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-left card-hover group">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Offer Services</div>
                <div className="text-[10px] text-[#5C5E72]">Register as a service provider</div>
              </div>
            </button>

            <button type="button" onClick={() => { setMode('choose'); setError(''); }} className="w-full text-center text-xs text-[#5C5E72] hover:text-[#8B8DA0] transition-colors pt-2">
              Back
            </button>
          </div>
        )}

        {/* Forms */}
        {(mode === 'signin' || mode === 'signup') && (
          <form onSubmit={(e) => handleSubmit(e, mode === 'signup')} className="space-y-4">
            <div>
              <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-12 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20"
              />
            </div>
            <div className="relative">
              <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Password</label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                className="h-12 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20 pr-10"
              />
              <EyeIcon visible={showPassword} onClick={() => setShowPassword(!showPassword)} />
            </div>
            <button
              type="submit"
              disabled={working}
              className={`w-full h-12 rounded-xl font-medium text-sm btn-press transition-all ${
                mode === 'signup' ? 'bg-[#3B82F6] text-white hover:bg-[#2563EB] glow-blue-sm' : 'bg-[#1A1A24] text-white border border-[#232330] hover:border-[#3B82F6]/50'
              } disabled:opacity-50`}
            >
              {working ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
            </button>
            {mode === 'signin' && (
              <button type="button" onClick={() => { setMode('forgot'); setError(''); }} className="w-full text-center text-xs text-[#5C5E72] hover:text-[#3B82F6] transition-colors">
                Forgot password?
              </button>
            )}
            <button type="button" onClick={() => { setMode('choose'); setError(''); setInfo(''); }} className="w-full text-center text-xs text-[#5C5E72] hover:text-[#8B8DA0] transition-colors">
              Back
            </button>
          </form>
        )}

        {/* Forgot */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-12 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20" />
            </div>
            <button type="submit" disabled={working} className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm hover:bg-[#2563EB] transition-colors glow-blue-sm disabled:opacity-50">
              {working ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button type="button" onClick={() => { setMode('signin'); setError(''); }} className="w-full text-center text-xs text-[#5C5E72] hover:text-[#8B8DA0] transition-colors">
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
