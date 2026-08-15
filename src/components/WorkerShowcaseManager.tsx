import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Post = {
  id: string;
  worker_id: string;
  kind: 'story' | 'portfolio';
  media_type: 'image' | 'video';
  storage_path: string;
  caption: string | null;
  booking_id: string | null;
  verified_job: boolean;
  expires_at: string | null;
  created_at: string;
  url?: string;
};

type Job = { id: string; booking_code: string | null; service_type: string | null };

export default function WorkerShowcaseManager({ profile }: { profile: Profile }) {
  const input = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [kind, setKind] = useState<'story' | 'portfolio'>('story');
  const [caption, setCaption] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<Post | null>(null);

  async function load() {
    const [{ data: rows }, { data: completed }] = await Promise.all([
      supabase
        .from('worker_showcase_posts')
        .select('id,worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,expires_at,created_at')
        .eq('worker_id', profile.user_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('worker_bookings')
        .select('id,booking_code,service_type')
        .eq('worker_id', profile.user_id)
        .eq('status', 'approved_released')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    const enriched = await Promise.all(
      (rows || []).map(async (row: any) => {
        const { data } = await supabase.storage.from('worker-showcase').createSignedUrl(row.storage_path, 3600);
        return { ...row, url: data?.signedUrl || '' } as Post;
      }),
    );

    setPosts(enriched);
    setJobs((completed || []) as Job[]);
  }

  useEffect(() => {
    void load();
  }, [profile.user_id]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function chooseFile(selected: File) {
    const isVideo = selected.type.startsWith('video/');
    const isImage = selected.type.startsWith('image/');
    if (!isVideo && !isImage) return toast.error('Choose an image or video');
    if (selected.size > (isVideo ? 50 : 12) * 1024 * 1024) {
      return toast.error(isVideo ? 'Video must be under 50MB' : 'Image must be under 12MB');
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  function clearComposer() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview('');
    setCaption('');
    setBookingId('');
    if (input.current) input.current.value = '';
  }

  async function publish() {
    if (!file) return toast.error('Choose a photo or video first');
    if (profile.worker_status !== 'verified' || !profile.worker_verified) {
      return toast.error('Finish WeHouse professional verification before publishing work');
    }

    const isVideo = file.type.startsWith('video/');
    setBusy(true);
    let path = '';
    try {
      const ext = (file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase();
      path = `${profile.user_id}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('worker-showcase').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc('create_my_worker_showcase_post', {
        p_kind: kind,
        p_media_type: isVideo ? 'video' : 'image',
        p_storage_path: path,
        p_caption: caption.trim() || null,
        p_booking_id: bookingId || null,
      });
      if (error) throw error;

      toast.success(kind === 'story' ? 'Work Status posted for 24 hours' : 'Added to your Portfolio');
      clearComposer();
      await load();
    } catch (error: any) {
      if (path) await supabase.storage.from('worker-showcase').remove([path]).catch(() => {});
      toast.error(error?.message || 'Could not publish work');
    } finally {
      setBusy(false);
    }
  }

  async function remove(post: Post) {
    if (!confirm('Remove this work post?')) return;
    setBusy(true);
    const { data: path, error } = await supabase.rpc('delete_my_worker_showcase_post', { p_post_id: post.id });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    if (path) await supabase.storage.from('worker-showcase').remove([String(path)]);
    setBusy(false);
    setViewer(null);
    await load();
  }

  const stories = posts.filter((post) => post.kind === 'story' && (!post.expires_at || new Date(post.expires_at) > new Date()));
  const portfolio = posts.filter((post) => post.kind === 'portfolio');
  const previewIsVideo = file?.type.startsWith('video/') || false;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">SHOWCASE</p>
          <h2 className="mt-1 text-xl font-bold">Show customers your real work</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#6C7282]">
            Post a 24-hour Work Status like a story, or keep your best work permanently in Portfolio. Link completed WeHouse jobs when the media came from a booking.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-[#6E7483]">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Public professional content</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
        <section className="rounded-3xl border border-white/[.07] bg-[#10141D] p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2">
            <Choice active={kind === 'story'} title="Work Status" detail="Photo/video · disappears after 24 hours" onClick={() => setKind('story')} />
            <Choice active={kind === 'portfolio'} title="Portfolio" detail="Permanent professional work" onClick={() => setKind('portfolio')} />
          </div>

          <button
            type="button"
            onClick={() => input.current?.click()}
            className="mt-4 flex min-h-40 w-full items-center justify-center overflow-hidden rounded-3xl border border-dashed border-white/[.12] bg-black/15 text-center"
          >
            {preview ? (
              previewIsVideo ? (
                <video src={preview} muted playsInline className="max-h-72 w-full object-contain" />
              ) : (
                <img src={preview} alt="Work preview" className="max-h-72 w-full object-contain" />
              )
            ) : (
              <div className="px-5 py-8">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-2xl text-violet-300">＋</div>
                <p className="mt-3 text-xs font-semibold">Choose a work photo or video</p>
                <p className="mt-1 text-[9px] text-[#666D7E]">Preview it here before publishing</p>
              </div>
            )}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) chooseFile(selected);
            }}
          />

          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value.slice(0, 300))}
            rows={3}
            placeholder={kind === 'story' ? 'What are you working on today?' : 'Describe this work'}
            className="mt-3 w-full resize-none rounded-2xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none focus:border-violet-500/35"
          />
          <div className="mt-1 text-right text-[8px] text-[#555C6D]">{caption.length}/300</div>

          <select value={bookingId} onChange={(event) => setBookingId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs">
            <option value="">Not linked to a completed WeHouse job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.booking_code || 'Completed job'} · {job.service_type || 'Service'}</option>
            ))}
          </select>

          <div className="mt-3 flex gap-2">
            {file && (
              <button type="button" onClick={clearComposer} disabled={busy} className="h-12 rounded-2xl border border-white/[.08] px-4 text-[10px] font-semibold text-[#A9AEBB] disabled:opacity-40">Clear</button>
            )}
            <button
              onClick={() => void publish()}
              disabled={busy || !file}
              className="h-12 min-w-0 flex-1 rounded-2xl bg-violet-500 px-4 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Publishing…' : kind === 'story' ? 'Post Work Status' : 'Add to Portfolio'}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-white/[.07] bg-[#10141D] p-4 sm:p-5">
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#646B7A]">HOW CUSTOMERS SEE IT</p>
          <div className="mt-3 space-y-3">
            <Info title="Work Status" text="Appears as a story-style update on your public professional profile for 24 hours." />
            <Info title="Portfolio" text="Stays on your public profile until you remove it." />
            <Info title="WEHOUSE JOB ✓" text="Shown only when you link media to a completed approved WeHouse booking." />
          </div>
        </section>
      </div>

      {stories.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Active Work Status</h3>
              <p className="mt-1 text-[9px] text-[#666D7E]">Visible to customers for 24 hours</p>
            </div>
            <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[8px] font-semibold text-violet-300">{stories.length} LIVE</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stories.map((post) => (
              <button key={post.id} onClick={() => setViewer(post)} className="w-24 shrink-0 text-left">
                <div className="rounded-3xl bg-gradient-to-br from-violet-400 via-blue-500 to-cyan-400 p-[2px]">
                  <Media post={post} className="h-32 w-full rounded-[22px] bg-[#090C12] object-cover" />
                </div>
                <p className="mt-1 truncate text-[9px] text-[#858B9B]">{post.caption || 'Work Status'}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-bold">Portfolio</h3>
          <p className="mt-1 text-[9px] text-[#666D7E]">Your permanent professional work</p>
        </div>
        {portfolio.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {portfolio.map((post) => (
              <button key={post.id} onClick={() => setViewer(post)} className="relative overflow-hidden rounded-2xl border border-white/[.06] bg-[#0D1118] text-left">
                <Media post={post} className="aspect-[4/3] w-full object-cover" />
                {post.verified_job && <span className="absolute left-2 top-2 rounded-full bg-emerald-500 px-2 py-1 text-[7px] font-bold text-[#04100B]">WEHOUSE JOB ✓</span>}
                <div className="p-2"><p className="line-clamp-2 text-[9px] text-[#A0A5B2]">{post.caption || 'Professional work'}</p></div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center text-[10px] text-[#656B7B]">Your permanent Portfolio will appear here.</div>
        )}
      </div>

      {viewer && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/90 p-4" onClick={() => setViewer(null)}>
          <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
            <Media post={viewer} className="max-h-[70dvh] w-full rounded-3xl bg-black object-contain" controls />
            <div className="mt-3 rounded-2xl bg-[#11151D] p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">{viewer.kind === 'story' ? 'Work Status' : 'Portfolio work'}{viewer.verified_job ? ' · Completed through WeHouse ✓' : ''}</p>
                  {viewer.caption && <p className="mt-1 text-[10px] leading-relaxed text-[#858B9A]">{viewer.caption}</p>}
                </div>
                <button onClick={() => void remove(viewer)} className="text-[10px] font-semibold text-red-300">Remove</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Choice({ active, title, detail, onClick }: { active: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border p-3 text-left transition ${active ? 'border-violet-500/30 bg-violet-500/[.08]' : 'border-white/[.07] bg-black/10 hover:bg-white/[.025]'}`}>
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-1 text-[9px] text-[#697080]">{detail}</p>
    </button>
  );
}

function Info({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl border border-white/[.06] bg-black/10 p-4"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-[#717888]">{text}</p></div>;
}

function Media({ post, className, controls = false }: { post: Post; className: string; controls?: boolean }) {
  if (post.media_type === 'video') return <video src={post.url} className={className} controls={controls} playsInline muted={!controls} />;
  return <img src={post.url} alt="Worker work" className={className} />;
}
