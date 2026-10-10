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
  const hasScore = Number.isFinite(score) && (comparedAnswers === undefined || comparedAnswers > 0);
  const conversationMode = context === "conversation";
  return <>
    {!fullProfile && <PublicProfileSurface
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

      bottomAction={primaryAction}
    >
      {!conversationMode && <>
        {(hasScore || highlights.length > 0 || discuss.length > 0) && <section className="border-t border-[var(--wh-border-subtle)] py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">How your plans line up</h2>
            {hasScore && <p className="text-right text-sm text-[var(--wh-text-secondary)]"><strong className="font-semibold text-violet-300">{score}%</strong> {matchLabel || "preference fit"}{comparedAnswers ? <span className="mt-1 block text-xs text-[var(--wh-text-muted)]">{comparedAnswers} preferences compared</span> : null}</p>}
          </div>
          {highlights.length > 0 && <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{highlights.map(item => <li key={item} className="flex gap-2"><span aria-hidden="true" className="text-violet-300">✓</span><span>{item}</span></li>)}</ul>}
          {discuss.length > 0 && <div className="mt-4 border-l-2 border-violet-400/60 pl-3 text-sm leading-6 text-[var(--wh-text-secondary)]"><h3 className="font-medium text-[var(--wh-text)]">Discuss before deciding</h3>{discuss.map(item => <p key={item}>{item}</p>)}</div>}
          <details className="mt-3 text-sm text-[var(--wh-text-muted)]"><summary className="w-fit cursor-pointer py-3">How matching works</summary><p className="pb-2 leading-6">This compares the practical preferences you both answered. It is not a prediction that living together will succeed, and unanswered choices are not treated as agreement.</p></details>
        </section>}
        {Boolean(person.preferredArea || person.school || person.occupation) && <section className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {person.preferredArea && <Detail label="Preferred area" value={person.preferredArea} />}
          {person.school && <Detail label="School" value={person.school} />}
          {person.occupation && <Detail label="Occupation" value={person.occupation} />}
        </section>}
      </>}
      {footer}
    </PublicProfileSurface>}
    {/* Keep the originating info screen mounted: Back restores that exact step,
        with the same permission-filtered person data, rather than starting over. */}
    {fullProfile ? <RoommatePublicProfile
      person={person}
      score={score}
      matchLabel={matchLabel}
      highlights={highlights}
      discuss={discuss}
      comparedAnswers={comparedAnswers}
      presence={presence}
      actions={actions}
      footer={footer}
      primaryAction={primaryAction}
      context="discovery"
      onClose={() => setFullProfile(false)}
    /> : null}
  </>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-6 py-4">
    <span className="text-xs text-[var(--wh-text-muted)]">{label}</span>
    <strong className="max-w-[68%] text-right text-sm font-medium text-[var(--wh-text)]">{value}</strong>
  </div>;
}
