import { useEffect } from 'react';
import type { Profile } from '@/types';

interface ActivityProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  onGoToChat?: (convId: string) => void;
}

// Compatibility bridge for old saved `activity` routes. Activity is a view
// inside Inbox, never a separate customer destination.
export default function Activity({ onNavigate }: ActivityProps) {
  useEffect(() => {
    onNavigate('notifications');
  }, [onNavigate]);

  return <div className="min-h-[60dvh] bg-[#09090D]" aria-label="Opening Inbox Activity"/>;
}
