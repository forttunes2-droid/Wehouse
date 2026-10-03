import { useState } from "react";
import type { Profile } from "@/types";
import PropertyPartnerProWorkspace from "@/components/PropertyPartnerProWorkspace";
import SponsoredCampaignPanel from "@/components/SponsoredCampaignPanel";

type Tool = "pro" | "sponsored";

export default function PartnerToolsWorkspace({ profile }: { profile: Profile }) {
  const [tool, setTool] = useState<Tool | null>(null);

  if (tool === "pro") {
    return <div className="space-y-4"><ToolBack onBack={() => setTool(null)} title="Partner Pro" /><PropertyPartnerProWorkspace profile={profile} /></div>;
  }

  if (tool === "sponsored") {
    return <div className="space-y-4"><ToolBack onBack={() => setTool(null)} title="Sponsored placement" /><SponsoredCampaignPanel types={["property", "hotel"]} /></div>;
  }

  return (
    <section className="mx-auto max-w-3xl" aria-labelledby="partner-tools-title">
      <div className="border-b border-[var(--wh-border-subtle)] pb-4">
        <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">PARTNER TOOLS</p>
        <h2 id="partner-tools-title" className="mt-1 text-lg font-semibold">Tools for your portfolio</h2>
        <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--wh-text-secondary)]">Optional tools stay here so Properties, bookings, messages and money remain the main workspace.</p>
      </div>
      <div className="mt-3 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
        <ToolRow title="Partner Pro" detail="Calendar, occupancy, earnings reports and property tasks." action="Open Pro" onClick={() => setTool("pro")} />
        <ToolRow title="Sponsored placement" detail="Promote an eligible home or hotel for a selected period." action="Open Sponsored" onClick={() => setTool("sponsored")} />
      </div>
    </section>
  );
}

function ToolRow({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-20 w-full items-center gap-4 px-1 py-4 text-left active:bg-[var(--wh-interactive)]">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300">{title === "Partner Pro" ? "P" : "↗"}</span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-[11px] leading-5 text-[var(--wh-text-secondary)]">{detail}</span></span>
    <span className="shrink-0 text-[10px] font-semibold text-violet-300">{action}</span>
  </button>;
}

function ToolBack({ onBack, title }: { onBack: () => void; title: string }) {
  return <button type="button" onClick={onBack} className="flex min-h-10 items-center gap-2 text-xs font-semibold text-[var(--wh-text-secondary)]"><span aria-hidden="true">←</span>{title}</button>;
}
