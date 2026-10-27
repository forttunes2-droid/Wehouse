import { Component, type ReactNode } from 'react';
import AppErrorState from '@/components/AppErrorState';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; isChunkError: boolean; }

function isChunkError(error: Error): boolean {
  const msg = error?.message || '';
  return msg.includes('Loading chunk') ||
         msg.includes('Failed to fetch dynamically imported module') ||
         msg.includes('dynamically imported module');
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
    if (this.state.hasError) {
      return <AppErrorState loadFailure={this.state.isChunkError} onRetry={()=>window.location.reload()}/>;
    }
    return this.props.children;
  }
}
