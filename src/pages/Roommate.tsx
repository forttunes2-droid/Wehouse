import { roommatePreferenceForm, roommatePreferenceError, roommateScoreLabel } from "@/lib/roommatePreferences";
import { nigeriaCalendarDate } from "@/lib/shortLetQuote";
import { withTimeout } from "@/lib/withTimeout";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  checkSearchExpiry,
  getReceivedRoommateInterests,
  getSavedMatchResults,
  refreshRoommateSearch,
  respondToRoommateInterest,
  ensureRoommateConversation,
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
import RoommatePublicProfile from "@/components/RoommatePublicProfile";
import type { Profile, RoommatePreferences } from "@/types";

type Props = {
  profile: Profile;
  onGoToChat?: (id: string, peerId?: string) => void;
  onNavigate: (page: string, id?: string) => void;
  onEditProfile?: () => void;
  onOpenListing?: (id: string) => void;
  initialContextId?: string | null;
};
type Form = RoommatePreferenceForm;
const EMPTY: Form = roommatePreferenceForm();
const MATCH_PAGE_SIZE = 24;
type RoommateSnapshot = {
  prefs: RoommatePreferences | null;
  matches: RoommateMatchResult[];
  received: ReceivedRoommateInterest[];
  hasMore: boolean;
};
const roommateCache = new Map<string, RoommateSnapshot>();

function isEstablishedMatch(row: RoommateMatchResult) {
  return Boolean(row.conversation_id || row.mutual_accepted);
}

// The server evaluates either person's school restriction without disclosing
// their school. A redacted school is not evidence that someone is ineligible.
function visibleMatches(rows: RoommateMatchResult[]) {
  return rows;
}

export default function RoommateWorkspace({
  profile,
  onGoToChat,
  onNavigate,
  onEditProfile,
  onOpenListing,
  initialContextId,
}: Props) {
  const requestGeneration = useRef(0);
  const editingRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const cached = roommateCache.get(profile.user_id);
  const [prefs, setPrefs] = useState<RoommatePreferences | null>(() => cached?.prefs || null),
    [matches, setMatches] = useState<RoommateMatchResult[]>(() => cached?.matches || []),
    [received, setReceived] = useState<ReceivedRoommateInterest[]>(() => cached?.received || []),
    [hasMore, setHasMore] = useState(() => cached?.hasMore || false),
    [form, setForm] = useState<Form>({
      ...EMPTY,
      school_name: profile.school || "",
    }),
    [editing, setEditing] = useState(false),
    [loading, setLoading] = useState(() => !cached),
    [busy, setBusy] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [interestBusy, setInterestBusy] = useState<string | null>(null),
    [openingChatId, setOpeningChatId] = useState<string | null>(null),
    [focusedContextId, setFocusedContextId] = useState<string | null>(
      initialContextId || null,
    );
  const profileReady =
    Boolean(profile.profile_complete) &&
    Boolean(profile.gender) &&
    Boolean(profile.state) &&
    Boolean(profile.local_government);
  const discoveryAllowed =
    profile.privacy_search_visible !== false &&
    profile.privacy_profile_visible !== false;
  const canMatch = profileReady && discoveryAllowed;
  editingRef.current = editing;
  const location = [prefs?.preferred_lga, prefs?.preferred_state]
    .filter(Boolean)
    .join(", ");
  const matchingActive =
    prefs?.practical_preferences_version === 2 &&
    prefs?.search_status === "active" &&
    prefs?.active !== false &&
    discoveryAllowed;
  const matchingLabel = matchingActive
    ? "Active"
    : prefs
      ? "Paused"
      : "Set preferences";

  const load = useCallback(async (quiet = false) => {
    const generation = ++requestGeneration.current;
    if (!quiet) setLoading(true);
    setLoadError("");
    try {
      const [preferenceResult, incoming] = await withTimeout(Promise.all([checkSearchExpiry(),getReceivedRoommateInterests()]),15000,"Roommate information took too long.");
      if (preferenceResult.error || incoming.error) throw preferenceResult.error || incoming.error;
      const p = preferenceResult.prefs;
      const result = p ? await withTimeout(getSavedMatchResults(MATCH_PAGE_SIZE,0),15000,"Matches took too long.") : {matches:[],hasMore:false,error:null};
      if (result.error) throw result.error;
      if (generation !== requestGeneration.current) return [];
      const rows = result.matches;
      setPrefs(p); setReceived(incoming.interests); setMatches(rows); setHasMore(result.hasMore);
      roommateCache.set(profile.user_id,{prefs:p,matches:rows,received:incoming.interests,hasMore:result.hasMore});
      if (!editingRef.current) setForm(roommatePreferenceForm(p,profile.school || ""));
      return rows;
    } catch {
      if (generation === requestGeneration.current) setLoadError("Roommate information could not be refreshed. Your saved preferences and conversations have not been removed.");
      return [];
    } finally { if (generation === requestGeneration.current) setLoading(false); }
  },[profile.school,profile.user_id]);
  useEffect(() => {
    const task = window.setTimeout(
      () => void load(Boolean(roommateCache.get(profile.user_id))),
      0,
    );
    return () => { window.clearTimeout(task); requestGeneration.current += 1; };
  }, [load, profile.user_id]);
  useEffect(() => {
    if (loading) return;
    roommateCache.set(profile.user_id, { prefs, matches, received, hasMore });
  }, [hasMore, loading, matches, prefs, profile.user_id, received]);
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
  useEffect(() => {
    if (loading || !initialContextId) return;
    setFocusedContextId(initialContextId);
    const frame = window.requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-activity-context]")]
        .find((element) =>
          String(element.dataset.activityContext || "")
            .split(" ")
            .includes(initialContextId),
        );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialContextId, loading, matches, received]);

  function applyResult(result: {
    matches?: RoommateMatchResult[];
    hasMore?: boolean;
  }) {
    const rows = visibleMatches(result.matches || []);
    setMatches(rows);
    setHasMore(Boolean(result.hasMore));
  }
  async function save() {
    if (!profileReady)
      return toast.error("Add your gender, State and LGA in Personal details first");
    if (!discoveryAllowed)
      return toast.error(
        "Turn on Roommate discovery and profile visibility in Privacy first",
      );
    const validationError = roommatePreferenceError(form,nigeriaCalendarDate());
    if (validationError) return toast.error(validationError);
    setBusy(true);
    const { prefs: p, error } = await saveRoommatePreferences({
      ...form,
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
      if (!result.error) applyResult(result);
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
      const next = visibleMatches(result.matches).filter(
        (row) => !seen.has(row.id),
      );
      return [...current, ...next];
    });
    setHasMore(Boolean(result.hasMore));
  }
  async function stop() {
    const { prefs: p, error } = await stopRoommateSearch();
    if (error) return toast.error(error.message);
    setPrefs(p);
    setMatches((current) => current.filter(isEstablishedMatch));
    setHasMore(false);
    toast.success("New roommate discovery is off. Existing matches and chats are unchanged.", { id: "roommate-matching" });
  }
  async function interest(
    match: RoommateMatchResult,
    status: "accepted" | "viewed",
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
    if (status === "viewed") {
      setMatches((current) => current.filter((row) => row.id !== match.id));
      toast.success("Skipped for now. This profile can return after Refresh.");
      return;
    }
    if (conversationId) {
      setMatches((current) => current.map((row) => row.id === match.id
        ? { ...row, status: "accepted", mutual_accepted: true, conversation_id: conversationId }
        : row));
      toast.success("It’s a match. Tap Message when you’re ready.", {
        id: "roommate-match",
      });
    } else {
      const latest = await load();
      const mutual = latest.find((row) => row.id === match.id)?.mutual_accepted;
      toast.success(mutual
        ? "It’s a match. Tap Message when you’re ready."
        : `${match.matched_profile.full_name || match.matched_profile.username || "This person"} can now accept or pass your interest.`,
        { id: "roommate-match" });
    }
  }
  async function respond(
    item: ReceivedRoommateInterest,
    response: "accepted" | "declined",
  ) {
    if (interestBusy) return;
    setInterestBusy(item.interest_id);
    const { error } = await respondToRoommateInterest(
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
    toast.success("Interest accepted. Your connection is ready.", {
      id: "roommate-match",
    });
    await load();
  }
  async function openConversation(match: RoommateMatchResult) {
    if (!onGoToChat || openingChatId) return;
    setOpeningChatId(match.id);
    const result = match.conversation_id
      ? { conversationId: match.conversation_id, error: null }
      : await ensureRoommateConversation(match.matched_user_id);
    setOpeningChatId(null);
    if (result.error || !result.conversationId)
      return toast.error(result.error?.message || "Could not open this roommate conversation");
    setMatches((current) => current.map((row) => row.id === match.id
      ? { ...row, conversation_id: result.conversationId }
      : row));
    onGoToChat(result.conversationId, match.matched_user_id);
  }
  if (loading)
    return (
      <div className="min-h-[70dvh] bg-[#0A0A0F]" role="status" aria-label="Loading roommate matches" />
    );

  return (
    <DiscoveryShell
      active="roommates"
      onNavigate={onNavigate}
    >
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6">
        <header className="flex items-center gap-3 border-y border-white/[.07] py-4">
          <ProfileImage
            src={profile.avatar_url}
            name={profile.full_name || profile.username || "Your profile"}
            className="h-12 w-12 rounded-full border border-white/10 text-base"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {profile.full_name || profile.username || "Your roommate profile"}
            </p>
            <p className="mt-1 truncate text-sm text-[#777D8D]">
              {location ? `Moving to ${location}` : "Choose where you want to move"}
            </p>
          </div>
          <span className={`shrink-0 text-sm font-semibold ${matchingActive ? "text-emerald-300" : "text-[#8B91A1]"}`}>
            {matchingLabel}
          </span>
        </header>

        {loadError && <section role="alert" className="border-y border-amber-500/20 py-4 text-sm leading-6"><p>{loadError}</p><button type="button" onClick={()=>void load()} className="min-h-11 font-semibold text-violet-300">Try again</button></section>}
        {prefs && prefs.practical_preferences_version !== 2 && <section className="border-y border-violet-500/20 py-4 text-sm leading-6"><p>Confirm your moving plans to find new matches. Existing connections and chats are unchanged.</p><button type="button" onClick={()=>setEditing(true)} className="min-h-11 font-semibold text-violet-300">Review preferences</button></section>}
        {!profileReady && (
          <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4">
            <p className="text-sm font-semibold">Add the basics first</p>
            <p className="mt-1 text-sm text-[#9A9EAD]">
              Roommate matching needs your gender, State and LGA so it can apply
              your preferences correctly.
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
            <p className="mt-1 text-sm text-[#9A9EAD]">
              Turn on Roommate discovery and profile visibility before your
              profile can enter matching.
            </p>
            <button
              onClick={() => onNavigate("privacy")}
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
            focusedId={focusedContextId}
            schoolFilter={prefs?.school_match ? (prefs.school_name || profile.school || "") : ""}
            onRespond={respond}
          />
        )}
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
            <section className="border-y border-white/[.07] py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[.15em] text-[#6F7585]">
                    Your annual rent share
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    ₦{Number(prefs.budget_min).toLocaleString()} – ₦
                    {Number(prefs.budget_max).toLocaleString()}
                  </p>
                  {prefs.school_match && (
                    <p className="mt-2 text-sm text-violet-300">
                      Same school · {prefs.school_name}
                    </p>
                  )}
                </div>
                <span className={`text-sm font-bold uppercase tracking-[.12em] ${matchingActive ? "text-emerald-300" : "text-[#7B8190]"}`}>
                  {matchingActive ? "Discoverable" : "Not discoverable"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="min-h-10 rounded-xl border border-white/[.08] px-4 text-sm"
                >
                  Edit preferences
                </button>
                {matchingActive ? (
                  <>
                    <button
                      onClick={() => void refresh()}
                      disabled={busy}
                      className="min-h-10 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40"
                    >
                      {busy ? "Refreshing…" : "Refresh matches"}
                    </button>
                    <button
                      onClick={() => void stop()}
                      className="min-h-10 rounded-xl border border-white/[.08] px-4 text-sm"
                    >
                      Stop new discovery
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void start()}
                    disabled={!canMatch || busy}
                    className="min-h-10 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40"
                  >
                    {busy ? "Starting…" : "Find new matches"}
                  </button>
                )}
              </div>
            </section>
            <Matches
              rows={matches}
              focusedId={focusedContextId}
              discoveryActive={matchingActive}
              hasMore={hasMore}
              loadingMore={loadingMore}
              busyId={interestBusy || openingChatId}
              schoolFilter={prefs.school_match ? (prefs.school_name || profile.school || "") : ""}
              onLoadMore={loadMore}
              onChat={openConversation}
              onInterest={interest}
            />
            {!matchingActive && matches.filter(isEstablishedMatch).length === 0 ? (
              <section className="py-12 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/[.08] text-xl text-violet-300">
                  Ⅱ
                </div>
                <p className="mt-4 text-base font-semibold">
                  New discovery is paused
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-[#686D7E]">
                  People already interested in you remain above, and existing
                  connections remain visible here and in Inbox. Resume when you
                  want to discover new profiles.
                </p>
              </section>
            ) : null}
          </>
        )}
        <SharedHomeLifecyclePanel
          profileId={profile.user_id}
          onOpenConversation={onGoToChat}
          onOpenListing={onOpenListing}
        />
      </main>
    </DiscoveryShell>
  );
}

function ProfileImage({
  src,
  name,
  className,
}: {
  src: string | null;
  name: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(139,92,246,.6),transparent_38%),linear-gradient(145deg,#21172F,#0D1017)] font-bold text-violet-100 ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        String(name || "W")[0].toUpperCase()
      )}
    </div>
  );
}

function Matches({
  rows,
  focusedId,
  discoveryActive,
  hasMore,
  loadingMore,
  busyId,
  schoolFilter,
  onLoadMore,
  onChat,
  onInterest,
}: {
  rows: RoommateMatchResult[];
  focusedId: string | null;
  discoveryActive: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  busyId: string | null;
  schoolFilter: string;
  onLoadMore: () => void;
  onChat?: (row: RoommateMatchResult) => void;
  onInterest: (row: RoommateMatchResult, status: "accepted" | "viewed") => void;
}) {
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);
  const openProfile = rows.find((row) => row.id === openProfileId) || null;
  const established = rows.filter(isEstablishedMatch);
  const discoverable = discoveryActive
    ? rows.filter((row) => !isEstablishedMatch(row))
    : [];

  return (
    <>
      {established.length > 0 ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.16em] text-emerald-300">Your people</p>
              <h2 className="mt-1 text-lg font-bold">Connections</h2>
            </div>
            <span className="text-sm text-[#777D8D]">{established.length}</span>
          </div>
          <MatchRail items={established} focusedId={focusedId} busyId={busyId} schoolFilter={schoolFilter} onOpenProfile={setOpenProfileId} onChat={onChat} onInterest={onInterest} />
        </section>
      ) : null}
      {discoveryActive ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Discover</h2>
              <p className="mt-1 text-sm text-[#6A7080]">
                Profiles that fit your location and living preferences.
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-violet-300">
              {discoverable.length} new
            </span>
          </div>
          {discoverable.length > 0 ? <MatchRail items={discoverable} focusedId={focusedId} busyId={busyId} schoolFilter={schoolFilter} onOpenProfile={setOpenProfileId} onChat={onChat} onInterest={onInterest} /> : (
            <div className="border-y border-white/[.065] px-3 py-10 text-center">
              <p className="text-sm font-semibold">No new matches yet</p>
              <p className="mt-1 text-sm text-[#686D7E]">Refresh when more compatible people become available.</p>
            </div>
          )}
          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <button type="button" disabled={loadingMore} onClick={() => void onLoadMore()} className="min-h-11 rounded-xl border border-white/[.08] px-5 text-xs font-semibold text-[#D0D4DE] disabled:opacity-50">
                {loadingMore ? "Loading more…" : "Show more"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {openProfile ? <RoommateProfileSheet row={openProfile} schoolFilter={schoolFilter} busy={busyId === openProfile.id} onClose={() => setOpenProfileId(null)} onChat={onChat} onInterest={onInterest} /> : null}
    </>
  );
}

function sameSchool(filter:string, candidate?:string|null){return Boolean(filter.trim()&&candidate?.trim()&&filter.trim().toLocaleLowerCase()===candidate.trim().toLocaleLowerCase())}
function MatchRail({items,focusedId,busyId,schoolFilter,onOpenProfile,onChat,onInterest}:{items:RoommateMatchResult[];focusedId:string|null;busyId:string|null;schoolFilter:string;onOpenProfile:(id:string)=>void;onChat?:(row:RoommateMatchResult)=>void;onInterest:(row:RoommateMatchResult,status:"accepted"|"viewed")=>void}) {
  return <div className="divide-y divide-white/[.06] border-y border-white/[.07]">{items.map((row)=>{
    const p=row.matched_profile,score=row.match_score,connected=Boolean(row.mutual_accepted||row.conversation_id),sent=row.status==="accepted";
    const name=p.full_name||`@${p.username||"user"}`;
    const contextIds=[row.id,row.conversation_id].filter(Boolean).join(" "),focused=[row.id,row.conversation_id].filter(Boolean).some(id=>String(id)===focusedId);
    return <article key={row.id} tabIndex={-1} data-activity-context={contextIds} className={`rounded-2xl px-2 py-4 outline-none transition ${focused?"bg-violet-500/[.08] ring-1 ring-violet-400/35":""}`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={()=>onOpenProfile(row.id)} className="shrink-0 rounded-full" aria-label={`View ${name} profile`}>
          <ProfileImage src={p.avatar_url} name={name} className="h-14 w-14 rounded-full border border-white/10 text-lg"/>
        </button>
        <button type="button" onClick={()=>onOpenProfile(row.id)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center justify-between gap-3"><h3 className="truncate text-sm font-semibold">{name}</h3><span className="shrink-0 text-sm font-bold text-violet-300">{Number.isFinite(score) ? `${score}%` : "—"}</span></div>
          <p className="mt-1 truncate text-sm text-[#747A8B]">{[p.city,p.state].filter(Boolean).join(", ")||"Nigeria"}{sameSchool(schoolFilter,p.school)?` · ${p.school}`:""}</p>
          <p className={`mt-1 text-sm font-semibold ${connected?"text-emerald-300":sent?"text-violet-200":"text-[#858B99]"}`}>{connected?"Matched":sent?"Request pending":roommateScoreLabel(score,p.compared_answers)}</p>
        </button>
        <button type="button" onClick={()=>onOpenProfile(row.id)} className="grid h-10 w-8 shrink-0 place-items-center text-lg text-[#6D7383]" aria-label={`Open ${name} profile`}>›</button>
      </div>
      <div className="mt-3 flex gap-2 pl-[4.25rem]">{connected?<button type="button" disabled={busyId===row.id} onClick={()=>void onChat?.(row)} className="min-h-10 flex-1 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-45">{busyId===row.id?"Opening…":"Message"}</button>:sent?<div className="flex min-h-10 flex-1 items-center rounded-xl border border-violet-400/15 px-3 text-sm font-semibold text-violet-200">Waiting for {name} to accept</div>:<><button type="button" disabled={busyId===row.id} onClick={()=>void onInterest(row,"accepted")} className="min-h-10 flex-1 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40">{busyId===row.id?"Sending…":"Connect"}</button><button type="button" disabled={busyId===row.id} onClick={()=>void onInterest(row,"viewed")} className="min-h-10 rounded-xl border border-white/[.09] px-4 text-sm font-semibold disabled:opacity-40">Skip</button></>}</div>
    </article>;
  })}</div>;
}

function RoommateProfileSheet({row,schoolFilter,busy,onClose,onChat,onInterest}:{row:RoommateMatchResult;schoolFilter:string;busy:boolean;onClose:()=>void;onChat?:(row:RoommateMatchResult)=>void;onInterest:(row:RoommateMatchResult,status:"accepted"|"viewed")=>void}){
  const p=row.matched_profile,score=row.match_score;
  const connected=Boolean(row.mutual_accepted||row.conversation_id),sent=row.status==="accepted";
  const highlights=p.match_highlights || [];
  return <RoommatePublicProfile context="discovery" person={{name:p.full_name||`@${p.username||'user'}`,username:p.username,avatar:p.avatar_url,location:[p.city,p.state].filter(Boolean).join(', ')||'Nigeria',bio:p.bio,school:sameSchool(schoolFilter,p.school)?p.school:null,preferredArea:p.area_preference||'Flexible'}} onClose={onClose} score={score ?? undefined} matchLabel={roommateScoreLabel(score,p.compared_answers)} highlights={highlights} discuss={p.discuss_before_deciding} comparedAnswers={p.compared_answers} primaryAction={connected?<button type="button" disabled={busy} onClick={()=>void onChat?.(row)} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-45">{busy?"Opening…":"Message"}</button>:sent?<button type="button" disabled className="h-12 w-full rounded-2xl border border-violet-400/15 text-xs font-semibold text-violet-200 opacity-80">Request pending</button>:<button type="button" disabled={busy} onClick={()=>void onInterest(row,"accepted")} className="h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-45">{busy?"Sending…":"Connect"}</button>}/>;
}

function ReceivedInterests({
  rows,
  busyId,
  focusedId,
  schoolFilter,
  onRespond,
}: {
  rows: ReceivedRoommateInterest[];
  busyId: string | null;
  focusedId: string | null;
  schoolFilter: string;
  onRespond: (
    row: ReceivedRoommateInterest,
    response: "accepted" | "declined",
  ) => void;
}) {
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);
  const openProfile = rows.find((row) => row.interest_id === openProfileId) || null;
  return (
    <><section className="border-y border-violet-500/15 bg-violet-500/[.025] py-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[.16em] text-violet-300">
            INTERESTED IN YOU
          </p>
          <h2 className="mt-1 text-lg font-bold">Roommate requests</h2>
          <p className="mt-1 text-sm text-[#747A8B]">
            Accept to create a mutual match, or pass privately. After accepting,
            tap Message to create or open the chat.
          </p>
        </div>
        <span className="grid h-7 min-w-7 place-items-center rounded-full bg-violet-500 px-2 text-sm font-bold">
          {rows.length}
        </span>
      </div>
      <div className="mt-3 divide-y divide-white/[.06]">
        {rows.map((row) => (
          <article
            key={row.interest_id}
            tabIndex={-1}
            data-activity-context={row.interest_id}
            className={`grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-2xl px-2 py-4 outline-none transition sm:grid-cols-[3rem_minmax(0,1fr)_auto] ${focusedId===row.interest_id?"bg-violet-500/[.09] ring-1 ring-violet-400/35":""}`}
          >
            <button type="button" onClick={() => setOpenProfileId(row.interest_id)} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-bold text-violet-200" aria-label={`View ${row.full_name || row.username || "member"} profile`}>{row.avatar_url ? (
              <img
                src={row.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span>
                {String(row.full_name || row.username || "W")[0].toUpperCase()}
              </span>
            )}</button>
            <button type="button" onClick={() => setOpenProfileId(row.interest_id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-semibold">
                {row.full_name || `@${row.username || "user"}`}
              </p>
              <p className="mt-1 truncate text-sm text-[#73798A]">
                {Number.isFinite(row.match_score) ? `${row.match_score}% preference similarity · ` : "Compare your plans · "}
                {[row.city, row.state].filter(Boolean).join(", ") || "Nigeria"}
                {sameSchool(schoolFilter, row.school) ? ` · ${row.school}` : ""}
              </p>
            </button>
            <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:shrink-0">
              <button
                disabled={busyId === row.interest_id}
                onClick={() => void onRespond(row, "accepted")}
                className="min-h-10 rounded-xl bg-violet-500 px-3 text-sm font-semibold disabled:opacity-40"
              >
                Accept
              </button>
              <button
                disabled={busyId === row.interest_id}
                onClick={() => void onRespond(row, "declined")}
                className="min-h-10 rounded-xl border border-white/[.08] px-3 text-sm font-semibold disabled:opacity-40"
              >
                Pass
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>{openProfile ? <RoommatePublicProfile context="discovery" person={{name:openProfile.full_name||`@${openProfile.username||"user"}`,username:openProfile.username,avatar:openProfile.avatar_url,location:[openProfile.city,openProfile.state].filter(Boolean).join(", ")||"Nigeria",bio:openProfile.bio,school:sameSchool(schoolFilter,openProfile.school)?openProfile.school:null}} score={openProfile.match_score ?? undefined} matchLabel="Answered-preference similarity" onClose={()=>setOpenProfileId(null)} primaryAction={<div className="grid grid-cols-2 gap-2"><button type="button" disabled={busyId===openProfile.interest_id} onClick={()=>void onRespond(openProfile,"declined")} className="h-12 rounded-2xl border border-white/[.09] text-xs font-semibold disabled:opacity-40">Pass</button><button type="button" disabled={busyId===openProfile.interest_id} onClick={()=>void onRespond(openProfile,"accepted")} className="h-12 rounded-2xl bg-violet-500 text-xs font-semibold disabled:opacity-40">Accept</button></div>}/> : null}</>
  );
}
