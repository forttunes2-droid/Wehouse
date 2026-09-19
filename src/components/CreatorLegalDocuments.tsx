import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getCurrentLegalDocuments } from "@/lib/supabase/legal";
import { legalLaunchChecklist, legalReviewDrafts } from "@/content/legalReviewDrafts";

type DocumentKind = "privacy" | "terms";
type Draft = {
  policy_version_id: string;
  policy_key: "legal_privacy" | "legal_terms";
  version: number;
  value: { title?: string; body?: string; locale?: string };
  created_at: string;
};
type Editor = {
  title: string;
  body: string;
  draft: Draft | null;
  publishedVersion: number | null;
};

const EMPTY: Record<DocumentKind, Editor> = {
  privacy: { title: "Privacy Policy", body: "", draft: null, publishedVersion: null },
  terms: { title: "Terms of Service", body: "", draft: null, publishedVersion: null },
};

export default function CreatorLegalDocuments() {
  const [editors, setEditors] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<DocumentKind | null>(null);
  const [publishing, setPublishing] = useState<DocumentKind | null>(null);
  const [reviewReference, setReviewReference] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  async function load() {
    setLoading(true);
    const [{ documents }, { data, error }] = await Promise.all([
      getCurrentLegalDocuments(),
      supabase
        .from("creator_policy_versions")
        .select("policy_version_id,policy_key,version,value,created_at")
        .in("policy_key", ["legal_privacy", "legal_terms"])
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
    ]);
    if (error) toast.error("Legal drafts could not be loaded");
    const drafts = (data || []) as Draft[];
    const privacyDraft = drafts.find((row) => row.policy_key === "legal_privacy") || null;
    const termsDraft = drafts.find((row) => row.policy_key === "legal_terms") || null;
    setEditors({
      privacy: {
        title: privacyDraft?.value.title || documents.privacy?.title || "Privacy Policy",
        body: privacyDraft?.value.body || documents.privacy?.body || "",
        draft: privacyDraft,
        publishedVersion: documents.privacy?.version || null,
      },
      terms: {
        title: termsDraft?.value.title || documents.terms?.title || "Terms of Service",
        body: termsDraft?.value.body || documents.terms?.body || "",
        draft: termsDraft,
        publishedVersion: documents.terms?.version || null,
      },
    });
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function update(kind: DocumentKind, change: Partial<Editor>) {
    setEditors((current) => ({
      ...current,
      [kind]: { ...current[kind], ...change },
    }));
  }

  function loadLawyerDraft(kind: DocumentKind) {
    const current = editors[kind].body.trim();
    if (current && current !== legalReviewDrafts[kind].trim() && !window.confirm("Replace the unsaved editor text with the WeHouse lawyer-review draft?")) return;
    update(kind, { body: legalReviewDrafts[kind], draft: null });
    toast.success("Lawyer-review draft loaded. It is not public.");
  }

  async function saveDraft(kind: DocumentKind) {
    const editor = editors[kind];
    if (editor.body.trim().length < 500)
      return toast.error("Complete the document before saving the legal draft");
    setBusy(kind);
    const { data, error } = await supabase.rpc("creator_save_legal_draft", {
      p_document: kind,
      p_title: editor.title.trim(),
      p_body: editor.body.trim(),
      p_locale: "en-NG",
      p_reason: "Prepared for Nigerian legal review",
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    update(kind, { draft: data as Draft });
    toast.success("Draft saved. It is not public.");
  }

  async function publish(kind: DocumentKind) {
    const draft = editors[kind].draft;
    if (!draft)
      return toast.error("Save a reviewed draft before publication");
    if (reviewReference.trim().length < 3)
      return toast.error("Add the lawyer or legal-review reference");
    if (!password) return toast.error("Enter the Creator account password");
    setPublishing(kind);
    const { data: stepUp, error: stepUpError } = await supabase.functions.invoke(
      "creator-step-up",
      {
        body: {
          password,
          otp_code: otp,
          action_class: "policy_publish",
        },
      },
    );
    if (stepUpError || !stepUp?.success) {
      setPublishing(null);
      if (stepUp?.needs_mfa)
        return toast.error("Enter the six-digit authenticator code, then publish again");
      return toast.error(stepUp?.error || stepUpError?.message || "Creator confirmation failed");
    }
    const { error } = await supabase.rpc("creator_publish_legal_document", {
      p_policy_version_id: draft.policy_version_id,
      p_effective_from: new Date().toISOString(),
      p_review_reference: reviewReference.trim(),
      p_creator_elevation_id: stepUp.creator_elevation_id,
    });
    setPublishing(null);
    setPassword("");
    setOtp("");
    if (error) return toast.error(error.message);
    setReviewReference("");
    toast.success("Reviewed legal document published");
    await load();
  }

  if (loading)
    return (
      <div className="grid min-h-40 place-items-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold">Legal documents</h2>
        <p className="mt-1 max-w-2xl text-[10px] leading-5 text-[#73798A]">
          Save drafts here. Publication requires a legal-review reference and a fresh Creator security check. A draft is never shown to users.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["privacy", "terms"] as const).map((kind) => {
          const editor = editors[kind];
          return (
            <article key={kind} className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{kind === "privacy" ? "Privacy Policy" : "Terms of Service"}</p>
                  <p className="mt-1 text-[9px] text-[#686F80]">
                    {editor.draft ? `Draft v${editor.draft.version}` : "No saved draft"} · {editor.publishedVersion ? `Published v${editor.publishedVersion}` : "Nothing published"}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${editor.draft ? "bg-amber-500/10 text-amber-300" : "bg-white/[.04] text-[#747A89]"}`}>
                  {editor.draft ? "DRAFT" : "NOT READY"}
                </span>
              </div>
              <button type="button" onClick={() => loadLawyerDraft(kind)} className="mt-4 min-h-10 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.05] px-3 text-[10px] font-semibold text-violet-200">Load lawyer-review draft</button>
              <label className="mt-4 block text-[9px] text-[#777E8E]">
                Title
                <input value={editor.title} onChange={(event) => update(kind, { title: event.target.value, draft: null })} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs text-white outline-none" />
              </label>
              <label className="mt-3 block text-[9px] text-[#777E8E]">
                Full reviewed document
                <textarea rows={13} value={editor.body} onChange={(event) => update(kind, { body: event.target.value, draft: null })} className="mt-1.5 w-full resize-y rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-xs leading-5 text-white outline-none" />
              </label>
              <button type="button" onClick={() => void saveDraft(kind)} disabled={busy === kind} className="mt-3 h-11 w-full rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">
                {busy === kind ? "Saving draft…" : "Save private draft"}
              </button>
              {editor.draft ? (
                <div className="mt-4 space-y-2 border-t border-white/[.06] pt-4">
                  <input value={reviewReference} onChange={(event) => setReviewReference(event.target.value)} placeholder="Legal review reference" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Creator password" className="h-11 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" />
                    <input inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Authenticator (if enabled)" className="h-11 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" />
                  </div>
                  <button type="button" onClick={() => void publish(kind)} disabled={publishing === kind} className="h-11 w-full rounded-xl border border-emerald-500/20 bg-emerald-500/[.08] text-[10px] font-semibold text-emerald-300 disabled:opacity-40">
                    {publishing === kind ? "Confirming…" : "Publish reviewed version"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Internal launch documents still required</h3>
        <p className="mt-1 text-[9px] leading-4 text-[#707687]">These are working records for WeHouse and the lawyer. They are not user terms.</p>
        <div className="mt-3 divide-y divide-white/[.05] border-y border-white/[.05]">
          {legalLaunchChecklist.map((item) => <p key={item} className="py-3 text-[10px] leading-5 text-[#A2A7B5]">{item}</p>)}
        </div>
      </section>
    </section>
  );
}
