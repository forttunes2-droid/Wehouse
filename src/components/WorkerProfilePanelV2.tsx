import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onEdit: () => void;
  onVerification: () => void;
  onShowcase?: () => void;
};

type ShowcasePost = {
  id: string;
  kind: 'story' | 'portfolio';
  media_type: 'image' | 'video';
  storage_path: string;
  caption: string | null;
  verified_job: boolean;
  expires_at: string | null;
  created_at: string;
  url?: string;
};

export default function WorkerProfilePanelV2({ profile, onEdit, onVerification, onShowcase }: Props) {
  const [coverage, setCoverage] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [posts, setPosts] = useState<ShowcasePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [coverageResult, reviewResult, showcaseResult] = await Promise.all([
        supabase.from('worker_service_coverage').select('state,lga,areas').eq('worker_id', profile.user_id).maybeSingle(),
        supabase.from('reviews').select('id,rating,comment,created_at').eq('reviewee_id', profile.user_id).order('created_at', { ascending: false }).limit(6),
        supabase
          .from('worker_showcase_posts')
          .select('id,kind,media_type,storage_path,caption,verified_job,expires_at,created_at')
          .eq('worker_id', profile.user_id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      const showcaseRows = (showcaseResult.data || []) as ShowcasePost[];
      const enriched = await Promise.all(
        showcaseRows.map(async (row) => {
          const { data } = await supabase.storage.from('worker-showcase').createSignedUrl(row.storage_path, 3600);
          return { ...row, url: data?.signedUrl || '' };
        }),
      );

      if (!active) return;
      setCoverage(coverageResult.data || null);
      setReviews(reviewResult.data || []);
      setPosts(enriched);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [profile.user_id]);

  const occupation = profile.worker_occupation
    ? WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation
    : 'Service not set';
  const skills = (profile.worker_skills as string[]) || [];
  const status = String(profile.worker_status || 'pending');
  const verified = status === 'verified' && profile.worker_verified === true;
  const location = [coverage?.lga || profile.local_government || profile.city, coverage?.state || profile.state].filter(Boolean).join(', ') || 'Work location not set';
  const average = reviews.length ? reviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviews.length : 0;
  const cleanAbout = useMemo(() => cleanWorkerBio(profile.worker_bio || ''), [profile.worker_bio]);
  const aboutIsLong = cleanAbout.length > 320;
  const activeStatus = posts.filter((post) => post.kind === 'story' && (!post.expires_at || new Date(post.expires_at) > new Date()));
  const portfolio = posts.filter((post) => post.kind === 'portfolio');
  const preview = portfolio.slice(0, 4);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-white/[.07] bg-[#10131B]">
        <div className="h-20 bg-gradient-to-r from-violet-600/35 via-indigo-500/15 to-transparent" />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="-mt-9 flex items-end justify-between gap-3">
            <div className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-[#10131B] bg-gradient-to-br from-violet-500 to-indigo-600 text-2xl font-bold">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (profile.full_name || profile.username || 'W')[0].toUpperCase()}
            </div>
            <StatusBadge status={status} verified={verified} />
          </div>

          <div className="mt-3 min-w-0">
            <h2 className="truncate text-xl font-bold sm:text-2xl">{profile.full_name || profile.username || 'Your professional profile'}</h2>
            <p className="mt-1 text-xs font-medium text-[#AEB3C1]">{occupation}</p>
            <p className="mt-1 text-[10px] text-[#6F7585]">{location}</p>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={onEdit} className="h-11 flex-1 rounded-xl bg-violet-500 px-4 text-[11px] font-semibold text-white">Edit profile</button>
            {!verified ? (
              <button onClick={onVerification} className="h-11 flex-1 rounded-xl border border-white/[.08] bg-white/[.025] px-4 text-[11px] font-semibold text-[#D4D7DF]">Continue verification</button>
            ) : onShowcase ? (
              <button onClick={onShowcase} className="h-11 flex-1 rounded-xl border border-white/[.08] bg-white/[.025] px-4 text-[11px] font-semibold text-[#D4D7DF]">Manage showcase</button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/[.06] bg-[#0F1219] sm:grid-cols-4">
        <Fact label="Starting from" value={profile.worker_price ? `₦${Number(profile.worker_price).toLocaleString()}` : 'Discuss'} />
        <Fact label="Experience" value={shortExperience(profile.worker_experience)} />
        <Fact label="Reviews" value={reviews.length ? `${average.toFixed(1)} ★` : 'New'} />
        <Fact label="Work status" value={activeStatus.length ? `${activeStatus.length} live` : 'None'} />
      </section>

      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
        <SectionHeading title="Skills & service" />
        <div className="mt-3 flex flex-wrap gap-2">
          {skills.length ? skills.map((skill) => (
            <span key={skill} className="rounded-full border border-violet-500/15 bg-violet-500/[.06] px-3 py-1.5 text-[10px] font-medium text-violet-200">{skill}</span>
          )) : <span className="text-[10px] text-[#666D7E]">Add your specialty from Edit profile.</span>}
        </div>
        {coverage?.areas?.length > 0 && <p className="mt-3 text-[10px] text-[#717888]">Also serving: {coverage.areas.join(' · ')}</p>}
      </section>

      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
        <SectionHeading title="About" action={<button onClick={onEdit} className="text-[9px] font-semibold text-violet-300">Edit</button>} />
        {cleanAbout ? (
          <>
            <p className={`mt-3 whitespace-pre-line text-[11px] leading-5 text-[#969CAA] ${aboutOpen ? '' : 'line-clamp-4'}`}>{cleanAbout}</p>
            {aboutIsLong && <button onClick={() => setAboutOpen((value) => !value)} className="mt-2 text-[9px] font-semibold text-violet-300">{aboutOpen ? 'Show less' : 'Read more'}</button>}
          </>
        ) : (
          <button onClick={onEdit} className="mt-3 text-left text-[10px] text-[#6B7181]">Add a short introduction about your work →</button>
        )}
      </section>

      {verified && (
        <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
          <SectionHeading
            title="Your work"
            action={onShowcase ? <button onClick={onShowcase} className="text-[9px] font-semibold text-violet-300">Manage showcase</button> : undefined}
          />
          <div className="mt-1 flex gap-3 text-[9px] text-[#6C7282]">
            <span>{activeStatus.length} Work Status</span>
            <span>·</span>
            <span>{portfolio.length} Portfolio</span>
          </div>
          {preview.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {preview.map((post) => <WorkPreview key={post.id} post={post} />)}
            </div>
          ) : (
            <button onClick={onShowcase} className="mt-3 w-full rounded-xl border border-dashed border-white/[.08] px-4 py-7 text-center text-[10px] text-[#686F7F]">Add your first Portfolio photo or video →</button>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
        <SectionHeading title="Customer reviews" meta={reviews.length ? `${average.toFixed(1)} ★ · ${reviews.length}` : 'No reviews yet'} />
        {loading ? (
          <Empty text="Loading reviews…" />
        ) : reviews.length === 0 ? (
          <p className="mt-3 text-[10px] text-[#666D7E]">Reviews will appear after completed WeHouse jobs.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {reviews.slice(0, 2).map((review) => (
              <article key={review.id} className="rounded-xl border border-white/[.05] bg-black/10 p-3">
                <p className="text-[10px] text-amber-300">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating || 0))))}</p>
                {review.comment && <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-[#8E94A2]">{review.comment}</p>}
                <p className="mt-2 text-[8px] text-[#525969]">{new Date(review.created_at).toLocaleDateString()}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-b border-r border-white/[.05] p-3 last:border-r-0 sm:border-b-0"><p className="text-[8px] uppercase tracking-wide text-[#5F6676]">{label}</p><p className="mt-1 truncate text-[11px] font-semibold text-[#DDE0E7]">{value}</p></div>;
}

function SectionHeading({ title, action, meta }: { title: string; action?: React.ReactNode; meta?: string }) {
  return <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{title}</h3>{action || (meta ? <span className="text-[9px] text-[#6A7180]">{meta}</span> : null)}</div>;
}

function StatusBadge({ status, verified }: { status: string; verified: boolean }) {
  const label = verified ? 'WeHouse Verified' : status === 'profile_under_review' ? 'Under review' : status === 'rejected' ? 'Needs changes' : 'Not live yet';
  const cls = verified ? 'border-emerald-500/20 bg-emerald-500/[.08] text-emerald-300' : status === 'rejected' ? 'border-red-500/20 bg-red-500/[.08] text-red-300' : 'border-amber-500/20 bg-amber-500/[.08] text-amber-300';
  return <span className={`rounded-full border px-2.5 py-1 text-[8px] font-bold ${cls}`}>{label}</span>;
}

function WorkPreview({ post }: { post: ShowcasePost }) {
  if (!post.url) return <div className="aspect-[4/3] rounded-xl bg-white/[.03]" />;
  return <div className="relative overflow-hidden rounded-xl border border-white/[.05] bg-black/20">{post.media_type === 'video' ? <video src={post.url} muted playsInline className="aspect-[4/3] w-full object-cover" /> : <img src={post.url} alt="Portfolio work" className="aspect-[4/3] w-full object-cover" />}{post.verified_job && <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[6px] font-bold text-[#04100B]">WEHOUSE JOB ✓</span>}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="mt-3 rounded-xl border border-dashed border-white/[.07] px-4 py-6 text-center text-[10px] text-[#666D7E]">{text}</div>;
}

function cleanWorkerBio(value: string) {
  let text = value.trim();
  if (!text) return '';
  text = text.split(/\n\s*Services\s+Offered\s*:/i)[0].trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && /^professional\s+/i.test(lines[0]) && lines[0].length < 80) lines.shift();
  return lines.join('\n\n');
}

function shortExperience(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 'Not added';
  return text.length > 28 ? `${text.slice(0, 25).trim()}…` : text;
}
