import { useEffect } from 'react';
import type { Profile } from '@/types';

interface CreatorHomeProps {
  profile: Profile;
  onNavigate: (page: string) => void;
}

export default function CreatorHome({ onNavigate }: CreatorHomeProps) {
  useEffect(() => {
    onNavigate('creator');
  }, [onNavigate]);

  return (
    <div className="grid min-h-[60dvh] place-items-center bg-[#070910] text-white">
      <div className="text-center">
        <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        <p className="mt-3 text-xs text-[#74798B]">Opening Creator workspace…</p>
      </div>
    </div>
  );
}
