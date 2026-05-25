import { useAuth } from '@/hooks/useAuth';
import Login from '@/pages/Login';
import Setup from '@/pages/Setup';
import Dashboard from '@/pages/Dashboard';
import CreatorDashboard from '@/pages/CreatorDashboard';

export default function App() {
  const {
    page,
    profile,
    isLoading,
    error,
    handleLoginSuccess,
    handleSetupComplete,
    logout,
  } = useAuth();

  // ─── Loading ──────────────────────────────────────
  if (isLoading && page === 'loading') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[#8B8680]">Loading WeHouse...</p>
        <p className="text-[10px] text-[#C8A45A]">If stuck, refresh the page</p>
      </div>
    );
  }

  // ─── Login ────────────────────────────────────────
  if (page === 'login') {
    return <Login onLoginSuccess={handleLoginSuccess} serverError={error} />;
  }

  // ─── Setup (profile creation) ─────────────────────
  if (page === 'setup' && profile) {
    return <Setup profile={profile} onSetupComplete={handleSetupComplete} />;
  }

  // ─── User Dashboard ───────────────────────────────
  if (page === 'dashboard' && profile) {
    return <Dashboard profile={profile} onLogout={logout} />;
  }

  // ─── Creator Dashboard ────────────────────────────
  if (page === 'creator' && profile) {
    return <CreatorDashboard profile={profile} onLogout={logout} />;
  }

  // ─── Fallback ─────────────────────────────────────
  return <Login onLoginSuccess={handleLoginSuccess} serverError={error || 'Something went wrong'} />;
}
