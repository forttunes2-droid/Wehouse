import { useEffect } from 'react';
import type { Profile } from '@/types';

interface ActivityProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  onGoToChat?: (convId: string) => void;
}

// Compatibility bridge for old saved `activity` routes.
// Platform audit history now belongs only in Creator > Analytics > Activity.
export default function Activity({ onNavigate }: ActivityProps) {
  useEffect(() => {
    onNavigate('profile');
  }, [onNavigate]);

  return <div className="grid min-h-[60dvh] place-items-center bg-[#09090D] text-white"><div className="text-center"><div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/><p className="mt-3 text-xs text-[#6B6E7F]">Opening Account…</p></div></div>;
}
