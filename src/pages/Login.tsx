import { useState } from 'react';
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resetPassword,
} from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

  function resetForm() {
    setError('');
    setInfo('');
    setEmail('');
    setPassword('');
  }

  // Timeout wrapper for login operations
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), ms)),
    ]);
  }

  async function handleSubmit(e: React.FormEvent, isSignup: boolean) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setWorking(true);

    try {
      if (isSignup) {
        const { data, error: err } = await withTimeout(signUpWithEmail(email.trim(), password), 12000);
        if (err) {
          setError(err.message);
        } else if (data.session?.user) {
          onLoginSuccess(data.session.user.id, data.session.user.email || email);
        } else if (data.user) {
          setInfo('Account created! Please check your email and click the confirmation link.');
        } else {
          setError('Signup incomplete. Please try again.');
        }
      } else {
        const { data, error: err } = await withTimeout(signInWithEmail(email.trim(), password), 12000);
        if (err) {
          setError(err.message);
        } else if (data.session?.user) {
          onLoginSuccess(data.session.user.id, data.session.user.email || email);
        } else {
          setError('Login failed. Please try again.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Connection timeout. Please check your internet and try again.');
    } finally {
      setWorking(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setInfo('');
    setWorking(true);

    const { error: err } = await signInWithGoogle();
    if (err) {
      setError(err.message);
      setWorking(false);
    }
    // OAuth redirect handles the rest
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    setWorking(true);
    const { error: err } = await resetPassword(email.trim());
    if (err) {
      setError(err.message);
    } else {
      setInfo('Password reset email sent! Check your inbox.');
    }
    setWorking(false);
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-[360px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#0F1724] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C8A45A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#0F1724]">WeHouse</h1>
          <p className="text-xs text-[#8B8680] mt-1">We make living easy</p>
        </div>

        {/* Messages */}
        {displayError && (
          <Alert variant="destructive" className="mb-4 rounded-xl text-xs">
            <AlertDescription>{displayError}</AlertDescription>
          </Alert>
        )}

        {info && (
          <Alert className="mb-4 rounded-xl text-xs border-green-200 bg-green-50 text-green-700">
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        )}

        {/* Choose mode */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <Button
              onClick={handleGoogle}
              disabled={working}
              className="w-full h-11 rounded-xl bg-white text-[#0F1724] border border-[#e5e2dd] hover:bg-gray-50 font-medium text-sm"
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#e5e2dd]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-[#8B8680]">or</span>
              </div>
            </div>

            <Button
              onClick={() => { setMode('signin'); resetForm(); }}
              className="w-full h-11 rounded-xl bg-[#0F1724] text-white hover:bg-[#1a2435] font-medium text-sm"
            >
              Sign In with Email
            </Button>

            <Button
              onClick={() => { setMode('signup'); resetForm(); }}
              className="w-full h-11 rounded-xl bg-[#C8A45A] text-[#0F1724] hover:bg-[#b8944a] font-medium text-sm"
            >
              Create Account
            </Button>
          </div>
        )}

        {/* Sign In / Sign Up form */}
        {(mode === 'signin' || mode === 'signup') && (
          <form
            onSubmit={(e) => handleSubmit(e, mode === 'signup')}
            className="space-y-4"
          >
            <div>
              <Label className="text-xs text-[#8B8680] mb-1.5 block">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-11 rounded-xl border-[#e5e2dd] text-sm"
              />
            </div>

            <div>
              <Label className="text-xs text-[#8B8680] mb-1.5 block">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                className="h-11 rounded-xl border-[#e5e2dd] text-sm"
              />
            </div>

            <Button
              type="submit"
              disabled={working}
              className={`w-full h-11 rounded-xl font-medium text-sm ${
                mode === 'signup'
                  ? 'bg-[#C8A45A] text-[#0F1724] hover:bg-[#b8944a]'
                  : 'bg-[#0F1724] text-white hover:bg-[#1a2435]'
              }`}
            >
              {working ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
            </Button>

            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); resetForm(); }}
                className="w-full text-center text-xs text-[#8B8680] hover:text-[#C8A45A] transition-colors"
              >
                Forgot password?
              </button>
            )}

            <button
              type="button"
              onClick={() => { setMode('choose'); resetForm(); }}
              className="w-full text-center text-xs text-[#8B8680] hover:text-[#0F1724] transition-colors"
            >
              Back
            </button>
          </form>
        )}

        {/* Forgot password */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div>
              <Label className="text-xs text-[#8B8680] mb-1.5 block">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-11 rounded-xl border-[#e5e2dd] text-sm"
              />
            </div>

            <Button
              type="submit"
              disabled={working}
              className="w-full h-11 rounded-xl bg-[#0F1724] text-white hover:bg-[#1a2435] font-medium text-sm"
            >
              {working ? 'Sending...' : 'Send Reset Link'}
            </Button>

            <button
              type="button"
              onClick={() => { setMode('signin'); resetForm(); }}
              className="w-full text-center text-xs text-[#8B8680] hover:text-[#0F1724] transition-colors"
            >
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
