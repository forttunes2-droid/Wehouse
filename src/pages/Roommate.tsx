import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  checkSearchExpiry,
  getReceivedRoommateInterests,
  getSavedMatchResults,
  refreshRoommateSearch,
  respondToRoommateInterest,
  saveRoommatePreferences,
  startRoommateSearch,
  stopRoommateSearch,
  updateMatchStatus,
} from "@/lib/supabase";
import type {
  ReceivedRoommateInterest,
  RoommateMatchResult,
} from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import RoommatePreferencesPanel from "@/components/RoommatePreferencesPanel";
import type { RoommatePreferenceForm } from "@/components/RoommatePreferencesPanel";
import DiscoveryShell from "@/components/DiscoveryShell";
import SharedHomeLifecyclePanel from "@/components/SharedHomeLifecyclePanel";
import type { Profile, RoommatePreferences } from "@/types";

type Props = {
  profile: Profile;
  onGoToChat?: (id: string) => void;
  onEditProfile?: () => void;
  onOpenListing?: (id: string) => void;
};
type Form = RoommatePreferenceForm;
const EMPTY: Form = {
  gender_preference: "no_preference",
  budget_min: 180000,
  budget_max: 500000,
  cleanliness: "moderate",
  noise_level: "moderate",
  visitors: "sometimes",
  stay_duration: "1_year",
  area_preference: "",
  school_name: "",
  school_match: false,
};
const MATCH_PAGE_SIZE = 24;

export default function RoommateWorkspace({
  profile,
  onGoToChat,
  onEditProfile,
  onOpenListing,
}: Props) {
  const [prefs, setPrefs] = useState<RoommatePreferences | null>(null),
    [matches, setMatches] = useState<RoommateMatchResult[]>([]),
    [received, setReceived] = useState<ReceivedRoommateInterest[]>([]),
    [hasMore, setHasMore] = useState(false),
    [form, setForm] = useState<Form>({
      ...EMPTY,
      school_name: profile.school || "",
    }),
    [editing, setEditing] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [interestBusy, setInterestBusy] = useState<string | null>(null);
  const profileReady =
    Boolean(profile.profile_complete) &&
    Boolean(profile.gender) &&
    Boolean(profile.state);
  const discoveryAllowed =
    profile.privacy_search_visible !== false &&
    profile.privacy_profile_visible !== false;
  const canMatch = profileReady && discoveryAllowed;
  const location = [profile.local_government || profile.city, profile.state]
    .filter(Boolean)
    .join(", ");
  const matchingActive =
    prefs?.search_status === "active" &&
    prefs?.active !== false &&
    discoveryAllowed;
  const matchingLabel = matchingActive
    ? "Active"
    : prefs
      ? "Paused"
      : "Set preferences";

  const load = useCallback(async () => {
    setLoading(true);
    const [{ prefs: p }, incoming] = await Promise.all([
      checkSearchExpiry(),
      getReceivedRoommateInterests(),
    ]);
    let rows: RoommateMatchResult[] = [];
    let more = false;
    if (p?.search_status === "active" && discoveryAllowed) {
      const result = await getSavedMatchResults(MATCH_PAGE_SIZE, 0).catch(
        () => ({
          matches: [] as RoommateMatchResult[],
          hasMore: false,
          error: null,
        }),
      );
      rows = (result.matches || []).filter((row) => {
        if (!p.school_match) return true;
        const wanted = String(p.school_name || profile.school || "").trim().toLocaleLowerCase();
        const candidate = String(row.matched_profile?.school || "").trim().toLocaleLowerCase();
        return Boolean(wanted) && candidate === wanted;
      });
      more = Boolean(result.hasMore);
    }
    setPrefs(p);
    setReceived(incoming.interests || []);
    setMatches(rows);
    setHasMore(more);
    if (p)
      setForm({
        gender_preference: p.gender_preference || "no_preference",
        budget_min: Number(p.budget_min || 180000),
        budget_max: Number(p.budget_max || 500000),
        cleanliness: p.cleanliness || "moderate",
        noise_level: p.noise_level || "moderate",
        visitors: p.visitors || "sometimes",
        stay_duration: p.stay_duration || "1_year",
        area_preference: "",
        school_name: p.school_name || profile.school || "",
        school_match: Boolean(p.school_match),
      });
    setLoading(false);
  }, [profile.school, discoveryAllowed]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel(`roommate-interests:${profile.user_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${profile.user_id}`,
        },
        (payload) => {
          if ((payload.new as { type?: string }).type === "roommate_interest")
            void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile.user_id, load]);

  function applyResult(result: {
    matches?: RoommateMatchResult[];
    hasMore?: boolean;
  }, sourcePrefs = prefs) {
    const rows = (result.matches || []).filter((row) => {
      if (!sourcePrefs?.school_match) return true;
      const wanted = String(sourcePrefs.school_name || profile.school || "").trim().toLocaleLowerCase();
      const candidate = String(row.matched_profile?.school || "").trim().toLocaleLowerCase();
      return Boolean(wanted) && candidate === wanted;
    });
    setMatches(rows);
    setHasMore(Boolean(result.hasMore));
  }
  async function save() {
    if (!profileReady)
      return toast.error("Add your gender and State in Personal details first");
    if (!discoveryAllowed)
      return toast.error(
        "Turn on Roommate discovery and profile visibility in Privacy first",
      );
    if (form.school_match && !form.school_name.trim())
      return toast.error("Enter your school first");
    setBusy(true);
    const gender =
      profile.gender === "male" || profile.gender === "female"
        ? profile.gender
        : undefined;
    const { prefs: p, error } = await saveRoommatePreferences({
      ...form,
      gender,
      active: true,
    });
    if (error || !p) {
      setBusy(false);
      return toast.error(error?.message || "Could not save preferences");
    }
    if (Boolean(p.school_match) !== Boolean(form.school_match)) {
      setBusy(false);
      return toast.error("Same-school choice was not saved. Please try again before matching.");
    }
    setPrefs(p);
    setEditing(false);
    if (p.search_status === "active") {
      const result = await refreshRoommateSearch();
      if (!result.error) applyResult(result, p);
    }
    setBusy(false);
  }
  async function start() {
    if (!canMatch)
      return toast.error(
        "Complete your profile and Roommate privacy settings first",
      );
    setBusy(true);
    const { prefs: p, error } = await startRoommateSearch();
    if (error || !p) {
      setBusy(false);
      return toast.error(error?.message || "Could not start matching");
    }
    const result = await refreshRoommateSearch();
    setBusy(false);
    setPrefs(p);
    if (result.error) return toast.error(result.error.message);
    applyResult(result);
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    const result = await refreshRoommateSearch();
    setBusy(false);
    if (result.error) return toast.error(result.error.message);
    applyResult(result);
  }
  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const result = await getSavedMatchResults(MATCH_PAGE_SIZE, matches.length);
    setLoadingMore(false);
    if (result.error) return toast.error(result.error.message);
    setMatches((current) => {
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...result.matches.filter((row) => !seen.has(row.id))];
    });
    setHasMore(Boolean(result.hasMore));
  }
  async function stop() {
    const { prefs: p, error } = await stopRoommateSearch();
    if (error) return toast.error(error.message);
    setPrefs(p);
    setMatches([]);
    setHasMore(false);
    toast.success("New roommate discovery is off. Existing matches and chats are unchanged.", { id: "roommate-matching" });
  }
  async function interest(
    match: RoommateMatchResult,
    status: "accepted" | "declined",
  ) {
    if (interestBusy) return;
    setInterestBusy(match.id);
    if (status === "accepted") {
      setMatches((current) => current.map((row) => row.id === match.id ? { ...row, status: "accepted" } : row));
    }
    const { conversationId, error } = await updateMatchStatus(match.id, status);
    if (error) {
      if (status === "accepted") {
        setMatches((current) => current.map((row) => row.id === match.id ? { ...row, status: match.status } : row));
      }
      setInterestBusy(null);
      return toast.error(error.message);
    }
    setInterestBusy(null);
    if (status === "declined") {
      setMatches((current) => current.filter((row) => row.id !== match.id));
      toast.success("Passed privately. This profile will not be shown again.");
      return;
    }
    if (conversationId) {
      setMatches((current) =>
        current.map((row) =>
          row.id === match.id
            ? { ...row, status: "accepted", mutual_accepted: true, conversation_id: conversationId }
            : row,
        ),
      );
      toast.success("It’s a match. Tap Message when you’re ready.", {
        id: "roommate-match",
      });
    } else {
      setMatches((current) =>
        current.map((row) =>
          row.id === match.id ? { ...row, status: "accepted" } : row,
        ),
      );
      toast.success(
        `${match.matched_profile.full_name || match.matched_profile.username || "This person"} can now accept or pass your interest.`,
      );
    }
  }
  async function respond(
    item: ReceivedRoommateInterest,
    response: "accepted" | "declined",
  ) {
    if (interestBusy) return;
    setInterestBusy(item.interest_id);
    const { conversationId, error } = await respondToRoommateInterest(
      item.interest_id,
      response,
    );
    setInterestBusy(null);
    if (error) return toast.error(error.message);
    setReceived((current) =>
      current.filter((row) => row.interest_id !== item.interest_id),
    );
    if (response === "declined")
      return toast.success("Passed privately. No conversation was created.");
    toast.success("Interest accepted. Open Inbox when you’re ready.", {
      id: "roommate-match",
    });
    if (conversationId) await refresh();
  }
  function navigate(page: string) {
    try {
      localStorage.setItem("wh_navpage", page);
      window.history.pushState({ page }, "", `#${page}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: { page } }));
    } catch {
      window.location.hash = page;
    }
  }
  if (loading)
    return (
      <div className="min-h-[70dvh] bg-[#0A0A0F]" role="status" aria-label="Loading roommate matches" />
    );

  return (
    <DiscoveryShell
      active="roommates"
      title="Roommates"
      description="Set your preferences and find compatible people in your area."
      onNavigate={navigate}
    >
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6">
        <header className="flex items-center justify-between gap-4 border-b border-white/[.07] pb-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Your roommate search</p>
              <p className="mt-1 text-[10px] text-[#73798A]">
                {location || "Set your location"} · {prefs ? "Preferences saved" : "Preferences required"}
              </p>
            </div>
            <span
              className={`shrink-0 text-[10px] font-semibold ${matchingActive ? "text-emerald-300" : "text-[#777D8D]"}`}
            >
              {matchingLabel}
            </span>
          </div>
        </header>

        {!profileReady && (
          <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4">
            <p className="text-sm font-semibold">Add the basics first</p>
            <p className="mt-1 text-[10px] text-[#9A9EAD]">
              Roommate matching needs your gender and State so it can apply your
              preferences correctly.
            </p>
            {onEditProfile && (
              <button
                onClick={onEditProfile}
                className="mt-3 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white"
              >
                Open personal details
              </button>
            )}
          </section>
        )}
        {profileReady && !discoveryAllowed && (
          <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4">
            <p className="text-sm font-semibold">
              Roommate discovery is private
            </p>
            <p className="mt-1 text-[10px] text-[#9A9EAD]">
              Turn on Roommate discovery and profile visibility before your
              profile can enter matching.
            </p>
            <button
              onClick={() => navigate("privacy")}
              className="mt-3 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white"
            >
              Open Privacy
            </button>
          </section>
        )}
        {received.length > 0 && (
          <ReceivedInterests
            rows={received}
            busyId={interestBusy}
            showSchool={Boolean(prefs?.school_match)}
            onRespond={respond}
          />
        )}
        <SharedHomeLifecyclePanel
          profileId={profile.user_id}
          onOpenConversation={onGoToChat}
          onOpenListing={onOpenListing}
        />

        {!prefs || editing ? (
          <RoommatePreferencesPanel
            form={form}
            setForm={setForm}
            profileSchool={profile.school}
            busy={busy}
            onSave={save}
            onCancel={prefs ? () => setEditing(false) : undefined}
          />
        ) : (
          <>
            <section className="rounded-2xl border border-white/[.07] bg-[#11141C] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#6F7585]">
                    Your match range
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    ₦{Number(prefs.budget_min).toLocaleString()} – ₦
                    {Number(prefs.budget_max).toLocaleString()}
                  </p>
                  {prefs.school_match && (
                    <p className="mt-2 text-[10px] text-violet-300">
                      Same school · {prefs.school_name}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[8px] font-bold ${matchingActive ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#7B8190]"}`}
                >
                  {matchingActive ? "MATCHING ON" : "PAUSED"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="min-h-10 rounded-xl border border-white/[.08] px-4 text-[10px]"
                >
                  Edit preferences
                </button>
                {matchingActive ? (
                  <>
                    <button
                      onClick={() => void refresh()}
                      disabled={busy}
                      className="min-h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40"
                    >
                      {busy ? "Refreshing…" : "Refresh matches"}
                    </button>
                    <button
                      onClick={() => void stop()}
                      className="min-h-10 rounded-xl border border-white/[.08] px-4 text-[10px]"
                    >
                      Stop new discovery
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void start()}
                    disabled={!canMatch || busy}
                    className="min-h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40"
                  >
                    {busy ? "Starting…" : "Find new matches"}
                  </button>
                )}
              </div>
            </section>
            {matchingActive ? (
              <Matches
                rows={matches}
                hasMore={hasMore}
                loadingMore={loadingMore}
                busyId={interestBusy}
                showSchool={Boolean(prefs.school_match)}
                onLoadMore={loadMore}
                onChat={onGoToChat}
                onInterest={interest}
              />
            ) : (
              <section className="py-12 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/[.08] text-xl text-violet-300">
                  Ⅱ
                </div>
                <p className="mt-4 text-base font-semibold">
                  New discovery is paused
                </p>
                <p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#686D7E]">
                  People already interested in you remain above, and existing
                  connections stay in Inbox. Resume when you want to discover
                  new profiles.
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </DiscoveryShell>
  );
}

function matchLabel(score: number) {
  if (score >= 85) return "Best";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Good";
  return "Possible";
}
const SCORE_FACTORS = [
  ["Budget", 30],
  ["Location", 20],
  ["Cleanliness", 15],
  ["Noise", 15],
  ["Visitors", 10],
  ["Stay length", 10],
] as const;
function Matches({
  rows,
  hasMore,
  loadingMore,
  busyId,
  showSchool,
  onLoadMore,
  onChat,
  onInterest,
}: {
  rows: RoommateMatchResult[];
  hasMore: boolean;
  loadingMore: boolean;
  busyId: string | null;
  showSchool: boolean;
  onLoadMore: () => void;
  onChat?: (id: string) => void;
  onInterest: (row: RoommateMatchResult, status: "accepted" | "declined") => void;
}) {
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);
  const openProfile = rows.find((row) => row.id === openProfileId) || null;
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Best matches</h2>
          <p className="mt-1 text-[9px] text-[#6A7080]">
            Ranked by compatibility. Pass removes a profile privately without
            creating a conversation.
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[9px] font-semibold text-violet-300">
          {rows.length} found
        </span>
      </div>
      {rows.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => {
              const p = row.matched_profile,
                score = Number(row.match_score || 0),
                connected = Boolean(row.conversation_id),
                sent = row.status === "accepted",
                matched = connected || (sent && row.mutual_accepted);
              return (
                <article key={row.id} className="min-w-0 overflow-hidden rounded-2xl border border-white/[.07] bg-gradient-to-br from-[#151826] to-[#0E1118] p-4">
                  <div className="flex items-start gap-3">
                    {p.avatar_url ? (
                      <img
                        src={p.avatar_url}
                        alt={p.full_name || p.username || "Roommate match"}
                        className="h-14 w-14 shrink-0 rounded-2xl bg-[#11141C] object-cover"
                      />
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,.45),transparent_35%),linear-gradient(145deg,#191329,#0E1118)] text-xl font-bold text-violet-100">
                        {String(
                          p.full_name || p.username || "W",
                        )[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {p.full_name || `@${p.username || "user"}`}
                          </p>
                          <p className="mt-1 truncate text-[9px] text-[#737889]">
                            {[p.city, p.state].filter(Boolean).join(", ") ||
                              "Nigeria"}
                            {showSchool && p.school ? ` · ${p.school}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 rounded-full bg-violet-500/10 px-2.5 py-1 text-right">
                          <p className="text-[10px] font-bold text-violet-200">{score}% {matchLabel(score)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenProfileId(row.id)}
                        className="mt-2.5 text-[10px] font-semibold text-violet-300"
                      >
                        View profile
                      </button>
                      <p className={`mt-2 text-[8px] font-semibold ${matched?'text-emerald-300':sent?'text-violet-300':'text-[#666D7E]'}`}>{matched?'Connected':sent?'Interest pending':'Available to connect'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-white/[.06] pt-3">
                    {matched && row.conversation_id ? (
                      <button
                        onClick={() => onChat?.(row.conversation_id!)}
                        className="min-h-10 flex-1 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold shadow-lg shadow-violet-950/30 active:scale-[.99]"
                      >
                        Message
                      </button>
                    ) : sent ? (
                      <div className="flex min-h-10 w-full items-center justify-between rounded-xl bg-violet-500/[.07] px-3"><span className="text-[10px] font-semibold text-violet-300">Interest sent</span><span className="text-[8px] text-[#777D8D]">Waiting for a response</span></div>
                    ) : (
                      <>
                        <button
                          disabled={busyId === row.id}
                          onClick={() => void onInterest(row, "accepted")}
                          className="min-h-10 flex-1 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40"
                        >
                          {busyId === row.id ? "Sending…" : "Connect"}
                        </button>
                        <button
                          disabled={busyId === row.id}
                          onClick={() => void onInterest(row, "declined")}
                          className="min-h-10 rounded-xl border border-white/[.08] px-3 text-[9px] font-semibold disabled:opacity-40"
                        >
                          Pass
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {openProfile && <RoommateProfileSheet row={openProfile} showSchool={showSchool} onClose={()=>setOpenProfileId(null)}/>}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void onLoadMore()}
                className="min-h-11 rounded-xl border border-white/[.08] px-5 text-xs font-semibold text-[#D0D4DE] disabled:opacity-50"
              >
                {loadingMore ? "Loading more…" : "Show more matches"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="border-y border-white/[.065] px-3 py-12 text-center">
          <p className="text-sm font-semibold">No compatible matches yet</p>
          <p className="mt-1 text-[10px] text-[#686D7E]">
            Refresh after compatible active profiles enter your range.
          </p>
        </div>
      )}
    </section>
  );
}

function RoommateProfileSheet({row,showSchool,onClose}:{row:RoommateMatchResult;showSchool:boolean;onClose:()=>void}){
  const p=row.matched_profile,score=Number(row.match_score||0);
  return <div className="fixed inset-0 z-[100100] flex items-end bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onClick={onClose}><section className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] border border-white/[.08] bg-[#10131B] p-5 sm:max-w-lg sm:rounded-[28px]" role="dialog" aria-modal="true" aria-label="Roommate profile" onClick={event=>event.stopPropagation()}><div className="flex items-start gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-500/15 text-xl font-bold text-violet-100">{p.avatar_url?<img src={p.avatar_url} alt="" className="h-full w-full object-cover"/>:String(p.full_name||p.username||'W')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><h3 className="truncate text-lg font-bold">{p.full_name||`@${p.username||'user'}`}</h3><p className="mt-1 truncate text-[10px] text-[#737889]">{[p.city,p.state].filter(Boolean).join(', ')||'Nigeria'}</p><p className="mt-2 text-xs font-semibold text-violet-300">{score}% · {matchLabel(score)} match</p></div><button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.05] text-lg" aria-label="Close profile">×</button></div><div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-y border-white/[.06] py-4"><ProfileFact label="Preferred area" value={p.area_preference||'Flexible'}/>{showSchool&&p.school&&<ProfileFact label="School" value={p.school}/>}</div><section className="py-4"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#666D7E]">About</p><p className="mt-2 text-[11px] leading-5 text-[#A2A7B5]">{p.bio||'This person has not added an introduction yet.'}</p></section><section className="border-t border-white/[.06] pt-4"><p className="text-[10px] font-semibold">Why this score</p><div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2">{SCORE_FACTORS.map(([name,weight])=>{const key=name==='Stay length'?'stay':name.toLowerCase();const earned=Number(p.score_factors[key]||0);return <div key={name} className="flex items-center justify-between border-b border-white/[.04] pb-2 text-[9px]"><span className="text-[#666D7E]">{name}</span><span className="font-semibold text-[#AEB3C0]">{earned} / {weight}</span></div>})}</div><p className="mt-3 text-[9px] leading-5 text-[#666D7E]">The score combines budget overlap, location and living preferences. Gender and optional same-school rules decide eligibility first.</p></section></section></div>;
}

function ReceivedInterests({
  rows,
  busyId,
  showSchool,
  onRespond,
}: {
  rows: ReceivedRoommateInterest[];
  busyId: string | null;
  showSchool: boolean;
  onRespond: (
    row: ReceivedRoommateInterest,
    response: "accepted" | "declined",
  ) => void;
}) {
  return (
    <section className="border-y border-violet-500/15 bg-violet-500/[.025] py-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
            INTERESTED IN YOU
          </p>
          <h2 className="mt-1 text-lg font-bold">Roommate requests</h2>
          <p className="mt-1 text-[9px] text-[#747A8B]">
            Accept to open a private chat, or pass without starting a
            conversation.
          </p>
        </div>
        <span className="grid h-7 min-w-7 place-items-center rounded-full bg-violet-500 px-2 text-[9px] font-bold">
          {rows.length}
        </span>
      </div>
      <div className="mt-3 divide-y divide-white/[.06]">
        {rows.map((row) => (
          <article
            key={row.interest_id}
            className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
          >
            {row.avatar_url ? (
              <img
                src={row.avatar_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-500/15 font-bold text-violet-200">
                {String(row.full_name || row.username || "W")[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {row.full_name || `@${row.username || "user"}`}
              </p>
              <p className="mt-1 truncate text-[9px] text-[#73798A]">
                {row.match_score}% match ·{" "}
                {[row.city, row.state].filter(Boolean).join(", ") || "Nigeria"}
                {showSchool && row.school ? ` · ${row.school}` : ""}
              </p>
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:shrink-0">
              <button
                disabled={busyId === row.interest_id}
                onClick={() => void onRespond(row, "accepted")}
                className="min-h-10 rounded-xl bg-violet-500 px-3 text-[9px] font-semibold disabled:opacity-40"
              >
                Accept
              </button>
              <button
                disabled={busyId === row.interest_id}
                onClick={() => void onRespond(row, "declined")}
                className="min-h-10 rounded-xl border border-white/[.08] px-3 text-[9px] font-semibold disabled:opacity-40"
              >
                Pass
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[8px] uppercase tracking-wide text-[#606778]">
        {label}
      </p>
      <p className="mt-1 font-semibold text-[#B1B6C3]">{value}</p>
    </div>
  );
}
