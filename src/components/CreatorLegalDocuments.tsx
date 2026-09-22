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

export default function CreatorLegalDocuments({ embedded = false }: { embedded?: boolean }) {
  const [editors, setEditors] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<DocumentKind | null>(null);
  const [publishing, setPublishing] = useState<DocumentKind | null>(null);
  const [reviewReference, setReviewReference] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [editing, setEditing] = useState<DocumentKind | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);

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
    setEditing(kind);
    toast.success("Review draft loaded privately. Nothing was published.");
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
    <section className="space-y-5">
      <div>
        {!embedded && <h2 className="text-base font-bold">Legal documents</h2>}
        <p className="mt-1 max-w-2xl text-[10px] leading-5 text-[#858B9A]">
          These are the Privacy Policy and Terms users can read. Prepare a private draft, have it reviewed, then publish a new version. Existing accepted versions are never silently rewritten.
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {(["privacy", "terms"] as const).map((kind) => {
          const editor = editors[kind];
          const isEditing = editing === kind;
          const status = editor.draft
            ? "Draft saved"
            : editor.publishedVersion
              ? "Published"
              : "Not prepared";
          return (
            <article key={kind} className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B]">
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{kind === "privacy" ? "Privacy Policy" : "Terms of Service"}</p>
                    <p className="mt-1 text-[9px] leading-4 text-[#777E8E]">
                      {editor.publishedVersion ? `Published v${editor.publishedVersion}` : "No public version"}
                      {editor.draft ? ` · Private draft v${editor.draft.version}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[8px] font-semibold ${editor.draft ? "bg-amber-500/10 text-amber-300" : editor.publishedVersion ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#858B9A]"}`}>
                    {status}
                  </span>
                </div>

                {!isEditing ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setEditing(kind)} className="h-11 rounded-xl bg-violet-500 text-[10px] font-semibold text-white">
                      {editor.draft ? "Open private draft" : "Prepare document"}
                    </button>
                    <button type="button" onClick={() => loadLawyerDraft(kind)} className="h-11 rounded-xl border border-white/[.08] bg-white/[.025] text-[10px] font-semibold text-[#C9CBD4]">
                      Use WeHouse review draft
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3 border-t border-white/[.06] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold">Private editor</p>
                        <p className="mt-1 text-[9px] text-[#6F7687]">Saving does not make this public.</p>
                      </div>
                      <button type="button" onClick={() => setEditing(null)} className="min-h-9 px-2 text-[10px] font-semibold text-violet-300">Close editor</button>
                    </div>
                    <label className="block text-[9px] text-[#777E8E]">
                      Title
                      <input value={editor.title} onChange={(event) => update(kind, { title: event.target.value, draft: null })} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs text-white outline-none" />
                    </label>
                    <label className="block text-[9px] text-[#777E8E]">
                      Document text
                      <textarea rows={11} value={editor.body} onChange={(event) => update(kind, { body: event.target.value, draft: null })} className="mt-1.5 w-full resize-y rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-xs leading-5 text-white outline-none" />
                    </label>
                    <button type="button" onClick={() => void saveDraft(kind)} disabled={busy === kind} className="h-11 w-full rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">
                      {busy === kind ? "Saving…" : "Save private draft"}
                    </button>

                    {editor.draft ? (
                      <section className="space-y-2 rounded-xl border border-emerald-500/10 bg-emerald-500/[.025] p-3">
                        <div>
                          <p className="text-[10px] font-semibold text-emerald-200">Ready for reviewed publication</p>
                          <p className="mt-1 text-[9px] leading-4 text-[#7B8291]">Publish only after legal review. The reference records who or what review you relied on.</p>
                        </div>
                        <input value={reviewReference} onChange={(event) => setReviewReference(event.target.value)} placeholder="Legal review reference" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Creator password" className="h-11 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" />
                          <input inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Authenticator" className="h-11 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none" />
                        </div>
                        <button type="button" onClick={() => void publish(kind)} disabled={publishing === kind} className="h-11 w-full rounded-xl border border-emerald-500/20 bg-emerald-500/[.08] text-[10px] font-semibold text-emerald-300 disabled:opacity-40">
                          {publishing === kind ? "Confirming…" : "Publish reviewed version"}
                        </button>
                      </section>
                    ) : null}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B]">
        <button type="button" onClick={() => setShowChecklist((value) => !value)} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 text-left sm:px-5">
          <span>
            <strong className="block text-sm">Before public launch</strong>
            <span className="mt-1 block text-[9px] leading-4 text-[#707687]">Internal records for WeHouse and legal review. Users do not see these as Terms.</span>
          </span>
          <span className="text-[#747B8B]">{showChecklist ? "−" : "+"}</span>
        </button>
        {showChecklist ? (
          <div className="divide-y divide-white/[.05] border-t border-white/[.05] px-4 sm:px-5">
            {legalLaunchChecklist.map((item) => <p key={item} className="py-3 text-[10px] leading-5 text-[#A2A7B5]">{item}</p>)}
          </div>
        ) : null}
      </section>
    </section>
  );
}
