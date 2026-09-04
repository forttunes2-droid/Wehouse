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
import RoommatePublicProfile from "@/components/RoommatePublicProfile";
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

function isEstablishedMatch(row: RoommateMatchResult) {
  return Boolean(row.conversation_id || row.mutual_accepted || row.status === "accepted");
}

function visibleMatches(
  rows: RoommateMatchResult[],
  prefs: RoommatePreferences | null,
  profileSchool: string | null,
) {
  return rows.filter((row) => {
    if (isEstablishedMatch(row) || !prefs?.school_match) return true;
    const wanted = String(prefs.school_name || profileSchool || "")
      .trim()
      .toLocaleLowerCase();
    const candidate = String(row.matched_profile?.school || "")
      .trim()
      .toLocaleLowerCase();
    return Boolean(wanted) && candidate === wanted;
  });
}

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
    Boolean(profile.state) &&
    Boolean(profile.local_government);
  const discoveryAllowed =
    profile.privacy_search_visible !== false &&
    profile.privacy_profile_visible !== false;
  const canMatch = profileReady && discoveryAllowed;
  const location = [profile.local_government, profile.state]
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
    if (p) {
      const result = await getSavedMatchResults(MATCH_PAGE_SIZE, 0).catch(
        () => ({
          matches: [] as RoommateMatchResult[],
          hasMore: false,
          error: null,
        }),
      );
      rows = visibleMatches(result.matches || [], p, profile.school);
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
    const rows = visibleMatches(result.matches || [], sourcePrefs, profile.school);
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
      const next = visibleMatches(result.matches, prefs, profile.school).filter(
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
    toast.success("Interest accepted. Your connection is ready.", {
      id: "roommate-match",
    });
    if (conversationId) await load();
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
            <p className="mt-1 truncate text-[9px] text-[#777D8D]">
              {location || "State and LGA required"}
            </p>
          </div>
          <span className={`shrink-0 text-[9px] font-semibold ${matchingActive ? "text-emerald-300" : "text-[#8B91A1]"}`}>
            {matchingLabel}
          </span>
        </header>

        {!profileReady && (
          <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4">
            <p className="text-sm font-semibold">Add the basics first</p>
            <p className="mt-1 text-[10px] text-[#9A9EAD]">
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
                <span className={`text-[8px] font-bold uppercase tracking-[.12em] ${matchingActive ? "text-emerald-300" : "text-[#7B8190]"}`}>
                  {matchingActive ? "Discoverable" : "Not discoverable"}
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
            <Matches
              rows={matches}
              discoveryActive={matchingActive}
              hasMore={hasMore}
              loadingMore={loadingMore}
              busyId={interestBusy}
              showSchool={Boolean(prefs.school_match)}
              onLoadMore={loadMore}
              onChat={onGoToChat}
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
                <p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#686D7E]">
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

function matchLabel(score: number) {
  if (score >= 85) return "Best";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Good";
  return "Possible";
}
function Matches({
  rows,
  discoveryActive,
  hasMore,
  loadingMore,
  busyId,
  showSchool,
  onLoadMore,
  onChat,
  onInterest,
}: {
  rows: RoommateMatchResult[];
  discoveryActive: boolean;
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
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-emerald-300">Your people</p>
              <h2 className="mt-1 text-lg font-bold">Connections</h2>
            </div>
            <span className="text-[9px] text-[#777D8D]">{established.length}</span>
          </div>
          <MatchRail items={established} busyId={busyId} showSchool={showSchool} onOpenProfile={setOpenProfileId} onChat={onChat} onInterest={onInterest} />
        </section>
      ) : null}
      {discoveryActive ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Discover</h2>
              <p className="mt-1 text-[9px] text-[#6A7080]">
                Profiles that fit your location and living preferences.
              </p>
            </div>
            <span className="shrink-0 text-[9px] font-semibold text-violet-300">
              {discoverable.length} new
            </span>
          </div>
          {discoverable.length > 0 ? <MatchRail items={discoverable} busyId={busyId} showSchool={showSchool} onOpenProfile={setOpenProfileId} onChat={onChat} onInterest={onInterest} /> : (
            <div className="border-y border-white/[.065] px-3 py-10 text-center">
              <p className="text-sm font-semibold">No new matches yet</p>
              <p className="mt-1 text-[10px] text-[#686D7E]">Refresh when more compatible people become available.</p>
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
      {openProfile ? <RoommateProfileSheet row={openProfile} showSchool={showSchool} onClose={() => setOpenProfileId(null)} /> : null}
    </>
  );
}

function MatchRail({items,busyId,showSchool,onOpenProfile,onChat,onInterest}:{items:RoommateMatchResult[];busyId:string|null;showSchool:boolean;onOpenProfile:(id:string)=>void;onChat?:(id:string)=>void;onInterest:(row:RoommateMatchResult,status:"accepted"|"declined")=>void}) {
  return <div className="divide-y divide-white/[.06] border-y border-white/[.07]">{items.map((row)=>{
    const p=row.matched_profile,score=Number(row.match_score||0),connected=Boolean(row.conversation_id),sent=row.status==="accepted";
    const name=p.full_name||`@${p.username||"user"}`;
    return <article key={row.id} className="py-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={()=>onOpenProfile(row.id)} className="shrink-0 rounded-full" aria-label={`View ${name} profile`}>
          <ProfileImage src={p.avatar_url} name={name} className="h-14 w-14 rounded-full border border-white/10 text-lg"/>
        </button>
        <button type="button" onClick={()=>onOpenProfile(row.id)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center justify-between gap-3"><h3 className="truncate text-sm font-semibold">{name}</h3><span className="shrink-0 text-[10px] font-bold text-violet-300">{score}%</span></div>
          <p className="mt-1 truncate text-[9px] text-[#747A8B]">{[p.city,p.state].filter(Boolean).join(", ")||"Nigeria"}{showSchool&&p.school?` · ${p.school}`:""}</p>
          <p className={`mt-1 text-[9px] font-semibold ${connected?"text-emerald-300":sent?"text-violet-200":"text-[#858B99]"}`}>{connected?"Connected":sent?"Interest sent":`${matchLabel(score)} compatibility`}</p>
        </button>
        <button type="button" onClick={()=>onOpenProfile(row.id)} className="grid h-10 w-8 shrink-0 place-items-center text-lg text-[#6D7383]" aria-label={`Open ${name} profile`}>›</button>
      </div>
      <div className="mt-3 flex gap-2 pl-[4.25rem]">{connected&&row.conversation_id?<button type="button" onClick={()=>onChat?.(row.conversation_id!)} className="min-h-10 flex-1 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold">Message</button>:sent?<div className="flex min-h-10 flex-1 items-center rounded-xl border border-violet-400/15 px-3 text-[9px] font-semibold text-violet-200">Waiting for their response</div>:<><button type="button" disabled={busyId===row.id} onClick={()=>void onInterest(row,"accepted")} className="min-h-10 flex-1 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">{busyId===row.id?"Sending…":"Connect"}</button><button type="button" disabled={busyId===row.id} onClick={()=>void onInterest(row,"declined")} className="min-h-10 rounded-xl border border-white/[.09] px-4 text-[9px] font-semibold disabled:opacity-40">Pass</button></>}</div>
    </article>;
  })}</div>;
}

function RoommateProfileSheet({row,showSchool,onClose}:{row:RoommateMatchResult;showSchool:boolean;onClose:()=>void}){
  const p=row.matched_profile,score=Number(row.match_score||0);
  const highlights=Object.entries(p.score_factors||{}).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,3).map(([key])=>key==='stay'?'Stay length':key[0].toUpperCase()+key.slice(1));
  return <RoommatePublicProfile context="discovery" person={{name:p.full_name||`@${p.username||'user'}`,username:p.username,avatar:p.avatar_url,location:[p.city,p.state].filter(Boolean).join(', ')||'Nigeria',bio:p.bio,school:showSchool?p.school:null,preferredArea:p.area_preference||'Flexible'}} onClose={onClose} score={score} matchLabel={`${matchLabel(score)} match`} highlights={highlights} footer={<p className="border-t border-white/[.06] pt-4 text-[9px] leading-5 text-[#666D7E]">Compatibility combines budget, location and living preferences. Eligibility rules are applied before ranking.</p>}/>;
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
