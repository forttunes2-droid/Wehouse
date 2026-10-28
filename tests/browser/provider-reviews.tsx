import {createRoot} from 'react-dom/client';
import ExperienceReviewPanel from '@/components/ExperienceReviewPanel';import ExperienceReviews from '@/components/ExperienceReviews';import ProviderReviewModeration from '@/components/ProviderReviewModeration';
const mode=(window as any).__reviewTest.mode;
createRoot(document.getElementById('root')!).render(<main className="mx-auto min-h-screen max-w-2xl bg-[var(--wh-bg)] p-4 text-[var(--wh-text)]">{mode==='public'?<ExperienceReviews activityId="bb290000-0000-4000-8000-000000000003"/>:mode==='moderation'?<ProviderReviewModeration reportId="bb290000-0000-4000-8000-000000000001" onChanged={()=>{}}/>:<ExperienceReviewPanel bookingId="bb290000-0000-4000-8000-000000000002"/>}</main>);
