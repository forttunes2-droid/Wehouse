import Search from '@/pages/Search';
import type { Profile } from '@/types';

interface ExploreProps {
  profile: Profile | null;
  savedIds: Set<string>;
  onToggleSave: (id: string) => void;
  onNavigate: (page: string, id?: string) => void;
}

// Explore is intentionally a compatibility route for the canonical Search page.
// The previous implementation duplicated apartment, hotel, worker and roommate
// discovery with stale schemas and bypassed the dedicated canonical workflows.
export default function Explore({ savedIds, onToggleSave, onNavigate }: ExploreProps) {
  return <Search onNavigate={onNavigate} savedIds={savedIds} onToggleSave={onToggleSave} />;
}
