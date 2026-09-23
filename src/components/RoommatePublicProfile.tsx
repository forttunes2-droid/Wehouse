import { useState, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import PublicProfileSurface, { PublicProfileAction } from "@/components/PublicProfileSurface";

export type RoommatePublicProfileData = {
  name: string;
  username?: string | null;
  avatar?: string | null;
  location?: string;
  bio?: string | null;
  school?: string | null;
  occupation?: string | null;
  preferredArea?: string | null;
};
type Props = {
  person: RoommatePublicProfileData;
  onClose: () => void;
  onViewProfile?: () => void;
  context?: "discovery" | "conversation";
  score?: number;
  matchLabel?: string;
  highlights?: string[];
  discuss?: string[];
  comparedAnswers?: number;
  presence?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  primaryAction?: ReactNode;
};

export default function RoommatePublicProfile({
  person, onClose, onViewProfile, context = "discovery", score, matchLabel,
  highlights = [], discuss = [], comparedAnswers, presence, actions, footer, primaryAction,
}: Props) {
  const [fullProfile, setFullProfile] = useState(false);
  const hasScore = Number.isFinite(score);
  const conversationMode = context === "conversation";
  return <>
    <PublicProfileSurface
      suspended={fullProfile}
      conversation={conversationMode}
      name={person.name}
      username={person.username}
      avatar={person.avatar}
      subtitle={person.occupation}
      location={conversationMode ? undefined : person.location}
      presence={presence}
      about={conversationMode ? undefined : person.bio}
      onClose={onClose}
      ariaLabel={`${person.name} ${conversationMode ? "conversation info" : "profile"}`}
      actions={conversationMode ? <>{actions}<PublicProfileAction label="Profile" onClick={onViewProfile || (() => setFullProfile(true))}><UserRound size={18} /></PublicProfileAction></> : actions}
      badges={!conversationMode && hasScore ? <><strong className="text-xl text-violet-300">{score}%</strong><span className="text-xs font-medium text-[#A5AABA]">{matchLabel || "Roommate match"}</span></> : undefined}
      bottomAction={primaryAction}
    >
      {!conversationMode && <>
        {(hasScore || highlights.length > 0 || discuss.length > 0) && <section className="border-t border-white/[.07] py-5">
          <h2 className="text-sm font-bold uppercase tracking-[.14em] text-[#858C9C]">What matches</h2>
          {hasScore && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(0, Number(score)))}%` }} />
          </div>}
          <p className="mt-3 text-sm leading-6 text-[#AAA3B3]">{hasScore ? `Similarity across ${comparedAnswers || "your"} answered preferences—not the chance that living together will succeed.` : "Compare your plans together. Unanswered preferences are not treated as agreement."}</p>
          {highlights.length > 0 && <div className="mt-4 flex flex-wrap gap-2">
            {highlights.map(item => <span key={item} className="rounded-full border border-violet-500/15 bg-violet-500/[.06] px-3 py-1.5 text-xs font-medium text-violet-200">{item}</span>)}
          </div>}
          {discuss.length > 0 && <div className="mt-4 text-sm leading-6 text-[#C8C3D3]"><h3 className="font-semibold">Discuss before deciding</h3>{discuss.map(item=><p key={item} className="mt-1">{item}</p>)}</div>}
        </section>}
        {Boolean(person.preferredArea || person.school || person.occupation) && <section className="divide-y divide-white/[.06] border-y border-white/[.06]">
          {person.preferredArea && <Detail label="Preferred area" value={person.preferredArea} />}
          {person.school && <Detail label="School" value={person.school} />}
          {person.occupation && <Detail label="Occupation" value={person.occupation} />}
        </section>}
      </>}
      {footer}
    </PublicProfileSurface>
    {/* Keep the originating info screen mounted: Back restores that exact step,
        with the same permission-filtered person data, rather than starting over. */}
    {fullProfile ? <RoommatePublicProfile person={person} score={score} matchLabel={matchLabel} highlights={highlights} discuss={discuss} comparedAnswers={comparedAnswers}
      onClose={() => setFullProfile(false)} /> : null}
  </>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-6 py-4">
    <span className="text-xs text-[#858C9C]">{label}</span>
    <strong className="max-w-[68%] text-right text-sm font-medium text-[#D7DAE3]">{value}</strong>
  </div>;
}
