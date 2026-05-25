import { useState } from 'react';
import { signUpWithEmail, signInWithEmail, signInWithGoogle, resetPassword } from '@/lib/supabase';
import { Input } from '@/components/ui/input';

interface LoginProps {
  onLoginSuccess: (authId: string, email: string) => void;
  serverError: string;
}

type Mode = 'choose' | 'signin' | 'signup' | 'forgot';

export default function Login({ onLoginSuccess, serverError }: LoginProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const displayError = error || serverError;

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))]);
  }

  async function handleSubmit(e: React.FormEvent, isSignup: boolean) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email.includes('@')) { setError('Enter a valid email'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setWorking(true);

    try {
      if (isSignup) {
        const { data, error: err } = await withTimeout(signUpWithEmail(email.trim(), password), 12000);
        if (err) { setError(err.message); }
        else if (data.session?.user) { onLoginSuccess(data.session.user.id, data.session.user.email || email); }
        else if (data.user) { setInfo('Account created! Check your email to confirm.'); }
        else { setError('Signup incomplete'); }
      } else {
        const { data, error: err } = await withTimeout(signInWithEmail(email.trim(), password), 12000);
        if (err) { setError(err.message); }
        else if (data.session?.user) { onLoginSuccess(data.session.user.id, data.session.user.email || email); }
        else { setError('Login failed'); }
      }
    } catch (err: any) {
      setError(err?.message || 'Connection timeout. Try again.');
    } finally {
      setWorking(false);
    }
  }

  async function handleGoogle() {
    setWorking(true);
    const { error: err } = await signInWithGoogle();
    if (err) { setError(err.message); setWorking(false); }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) { setError('Enter a valid email'); return; }
    setWorking(true);
    const { error: err } = await resetPassword(email.trim());
    if (err) setError(err.message);
    else setInfo('Reset link sent! Check your email.');
    setWorking(false);
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-5">
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

        {/* Messages */}
        {displayError && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
            {displayError}
          </div>
        )}
        {info && (
          <div className="mb-4 p-3 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-[#3B82F6] text-xs text-center">
            {info}
          </div>
        )}

        {/* Choose */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <button onClick={handleGoogle} disabled={working} className="w-full h-12 rounded-xl bg-white text-[#0A0A0F] font-medium text-sm flex items-center justify-center gap-2 hover:bg-white/90 transition-colors">
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
            <button onClick={() => { setMode('signup'); setError(''); }} className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm hover:bg-[#2563EB] transition-colors glow-blue-sm">
              Create Account
            </button>
          </div>
        )}

        {/* Forms */}
        {(mode === 'signin' || mode === 'signup') && (
          <form onSubmit={(e) => handleSubmit(e, mode === 'signup')} className="space-y-4">
            <div>
              <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-12 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20" />
            </div>
            <div>
              <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} className="h-12 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20" />
            </div>
            <button type="submit" disabled={working} className={`w-full h-12 rounded-xl font-medium text-sm btn-press transition-all ${
              mode === 'signup' ? 'bg-[#3B82F6] text-white hover:bg-[#2563EB] glow-blue-sm' : 'bg-[#1A1A24] text-white border border-[#232330] hover:border-[#3B82F6]/50'
            } disabled:opacity-50`}>
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
