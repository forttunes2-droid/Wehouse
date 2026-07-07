import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; isChunkError: boolean; }

function isChunkError(error: Error): boolean {
  const msg = error?.message || '';
  return msg.includes('Loading chunk') ||
         msg.includes('Failed to fetch dynamically imported module') ||
         msg.includes('dynamically imported module') ||
         msg.includes('Failed to fetch');
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isChunkError: isChunkError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.isChunkError) {
      setTimeout(function() { window.location.reload(); }, 2000);
      return (
        <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-10 h-10 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#5C5E72]">Loading fresh code...</p>
        </div>
      );
    }

    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center gap-4 px-6">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          </div>
          <h2 className="text-lg font-bold text-white">Something went wrong</h2>
          <p className="text-sm text-[#5C5E72] text-center">
            Please refresh the page or clear your browser cache.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="h-11 px-6 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold"
          >
            Refresh Page
          </button>
          {this.state.error && (
            <p className="text-[10px] text-[#5C5E72] mt-4 max-w-xs break-all text-center">
              {this.state.error.message}
            </p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
