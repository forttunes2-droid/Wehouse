import type { ReactNode } from "react";
import PublicProfileSurface from "@/components/PublicProfileSurface";

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
  context?: "discovery" | "conversation";
  score?: number;
  matchLabel?: string;
  highlights?: string[];
  presence?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  primaryAction?: ReactNode;
};

export default function RoommatePublicProfile({
  person,
  onClose,
  context = "discovery",
  score,
  matchLabel,
  highlights = [],
  presence,
  actions,
  footer,
  primaryAction,
}: Props) {
  const hasScore = Number.isFinite(score);
  const conversationMode = context === "conversation";
  return (
    <PublicProfileSurface
      name={person.name}
      username={person.username}
      avatar={person.avatar}
      subtitle={person.occupation || (conversationMode ? undefined : "Roommate profile")}
      location={conversationMode ? undefined : person.location}
      presence={presence}
      about={conversationMode ? undefined : person.bio}
      onClose={onClose}
      ariaLabel={`${person.name} profile`}
      actions={actions}
      badges={conversationMode ? undefined : <><span className="rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-1 text-[9px] font-semibold text-[#B7BBC6]">WeHouse account</span>{hasScore ? <><strong className="text-xl text-violet-300">{score}%</strong><span className="text-[9px] font-semibold text-[#A5AABA]">{matchLabel || "Roommate match"}</span></> : null}</>}
      bottomAction={primaryAction}
    >
      {conversationMode ? (
        <section className="border-y border-white/[.06] py-5">
          <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#6F7585]">This conversation</p>
          <p className="mt-2 text-[11px] leading-5 text-[#A4A9B7]">This is the private identity for your matched roommate conversation. Discovery preferences and school matching details stay outside chat.</p>
        </section>
      ) : (
        <>
          {hasScore && (
            <section className="border-b border-white/[.07] py-5">
              <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#666D7E]">What matches</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(0, Number(score)))}%` }} />
              </div>
              {highlights.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {highlights.map((item) => (
                    <span key={item} className="rounded-full border border-violet-500/15 bg-violet-500/[.06] px-3 py-1.5 text-[9px] font-semibold text-violet-200">{item}</span>
                  ))}
                </div>
              )}
            </section>
          )}
          <section className="divide-y divide-white/[.06] border-b border-white/[.06]">
            {person.preferredArea && <Detail label="Preferred area" value={person.preferredArea} />}
            {person.school && <Detail label="School" value={person.school} />}
            {person.occupation && <Detail label="Occupation" value={person.occupation} />}
          </section>
        </>
      )}
      {footer}
    </PublicProfileSurface>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <span className="text-[9px] text-[#686E7E]">{label}</span>
      <strong className="max-w-[68%] text-right text-[11px] font-semibold text-[#D7DAE3]">{value}</strong>
    </div>
  );
}
