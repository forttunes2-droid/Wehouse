import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { propertyDocumentStatus, PROPERTY_DOCUMENT_TYPES, type PropertyDocument, type PropertyDocumentRequirement, type PropertyDocumentReview } from '@/lib/propertyDocuments';
import { downloadReviewedDocument, finishReviewedDocument, getReviewedDocuments, submitReviewedDocument } from '@/lib/supabase/reviewed-documents';

const field = 'min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 py-2 text-sm text-[var(--wh-text)] [color-scheme:light] dark:[color-scheme:dark]';
const button = 'min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 py-2 text-sm font-semibold disabled:opacity-50';
const message = (error: unknown) => error instanceof Error ? error.message : (error as { message?: string })?.message || 'The document action could not be confirmed. Refresh status before retrying.';

export default function ReviewedDocuments({ requestId, accountId, operator = false,kind='property',onChanged,onReadyChange }: { requestId: string; accountId: string; operator?: boolean;kind?:'property'|'worker'|'experience';onChanged?:()=>void|Promise<void>;onReadyChange?:(ready:boolean)=>void }) {
  const worker=kind==='worker',experience=kind==='experience',credential=worker||experience,title=experience?'Activity evidence':worker?'Service credentials':'Property documents';
  const [review, setReview] = useState<PropertyDocumentReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [requirements, setRequirements] = useState<PropertyDocumentRequirement[]>([]);
  const [basis, setBasis] = useState('');
  const [noAdditionalEvidence,setNoAdditionalEvidence]=useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [download, setDownload] = useState<{ id: string; name: string; url: string } | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  async function load() {
    const current = ++generation.current;
    onReadyChange?.(false);
    setLoading(true);
    try {
      const data = await getReviewedDocuments(requestId,kind);
      if (current !== generation.current) return;
      setReview(data); setError(false);onReadyChange?.(data.ready);
    } catch { if (current === generation.current) { setError(true); setReview(null);onReadyChange?.(false); } }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => {
    setReview(null); setEditing(false); setNotes({}); setExpiries({}); setDownload(null);
    void load();
    return () => { ++generation.current; };
  }, [requestId, accountId,kind]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  async function act(action: () => Promise<unknown>, success: string) {
    if (active.current) return;
    active.current = true; setBusy(true);
    const current = generation.current;
    try {
      await action();
      if (current !== generation.current) return;
      toast.success(success); await load();await onChanged?.();
    } catch (failure) {
      if (current === generation.current) { toast.error(message(failure)); await load(); }
    } finally { active.current = false; setBusy(false); }
  }
  function edit() {
    if (!review) return;
    setRequirements(review.requirements.map(item => ({ ...item })));
    setNoAdditionalEvidence(credential&&review.configured&&review.requirements.length===0);
    setBasis(review.requirements_note || ''); setEditing(true);
  }
  async function saveRequirements() {
    if (!review) return;
    await act(async () => {
      const result = await withTimeout(supabase.rpc(experience?'configure_experience_evidence_requirements':worker?'configure_worker_credential_requirements':'configure_property_document_requirements', {
        [experience?'p_activity_id':worker?'p_worker_id':'p_request_id']: requestId, p_expected_revision: review.revision, p_requirements: requirements, p_note: basis,
      }), 15000, 'Requirements could not be confirmed. Refresh status before retrying.');
      if (result.error) throw result.error;
      if (result.data?.success !== true) throw new Error('Requirements were not confirmed.');
      setEditing(false);
    }, experience?'Evidence requirements saved. The Experience host can submit documents.':worker?'Credential requirements saved. The Service Worker can submit evidence.':'Document requirements saved. The Partner can submit evidence.');
  }
  async function decide(document: PropertyDocument, decision: string) {
    await act(async () => {
      const result = await withTimeout(supabase.rpc(experience?'review_experience_evidence':worker?'review_worker_credential':'review_property_document', {
        p_document_id: document.id, p_decision: decision, p_note: notes[document.id] || '',
        p_expires_at: expiries[document.id] ? new Date(expiries[document.id]).toISOString() : null,
      }), 15000, 'Review confirmation timed out. Refresh status before retrying.');
      if (result.error) throw result.error;
      if (result.data?.id !== document.id || result.data?.request_id !== requestId || result.data?.status !== decision) throw new Error('The review decision was not confirmed.');
    }, decision === 'approved' ? 'Evidence approved for this review.' : 'Decision saved. The provider can see the reason.');
  }
  async function prepareDownload(document: PropertyDocument) {
    const current = generation.current;
    await act(async () => {
      const blob = await downloadReviewedDocument(document,kind);
      if (current === generation.current) setDownload({ id: document.id, name: document.original_name, url: URL.createObjectURL(blob) });
    }, 'Private document ready to download.');
  }
  const canReview = operator && review?.can_review;
  const serviceContext = worker ? review?.service_context : undefined;
  return <section aria-label={title} className="space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--wh-text-secondary)]">{experience?'Private expertise, venue, safety, licence or insurance evidence accepted for this activity and location. Account identity is separate. Do not upload NIN, passport or bank details here.':worker?'Private qualifications, licences, insurance or permits accepted for your service and operating area. Account identity verification is separate. Do not upload NIN, passport or bank details here.':'Private property authority, address and applicable stay or tenancy permissions. Account identity verification is separate. Do not upload NIN, passport or bank details here.'}</p></div><button type="button" disabled={busy || loading} className={button} onClick={() => void load()}>Refresh status</button></div>
    {serviceContext && <dl className="grid gap-3 rounded-xl bg-[var(--wh-elevated)] p-3 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold">Service</dt><dd className="mt-1 text-[var(--wh-text-secondary)]">{serviceContext.occupation || 'Not specified'}</dd></div>
      <div><dt className="font-semibold">Country</dt><dd className="mt-1 text-[var(--wh-text-secondary)]">{serviceContext.country || 'Not specified'}</dd></div>
      <div className="sm:col-span-2"><dt className="font-semibold">Operating areas covered by this review</dt><dd className="mt-1 text-[var(--wh-text-secondary)]">{serviceContext.coverage.map(area => `${area.lga}, ${area.state}`).join('; ') || serviceContext.state || 'No operating areas specified'}</dd></div>
    </dl>}
    {loading ? <p role="status" className="text-sm text-[var(--wh-text-secondary)]">Loading document status…</p>
      : error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">Document status could not be loaded. Use Refresh status to try again.</p>
        : review && <>
          <p role="status" className="rounded-xl bg-[var(--wh-elevated)] p-3 text-sm leading-6">{!review.configured ? (experience?'WeHouse must confirm the evidence required for this activity and location before uploads open.':worker?'WeHouse must confirm the evidence required for your service and operating area before uploads open.':'WeHouse must confirm which evidence is accepted for this property before uploads open.') : review.ready ? (experience?'Current activity evidence is approved. Identity, media, session and final publication checks still apply.':worker?'Current credential requirements are approved. Professional profile, work evidence, identity policy and final publication review still apply.':'All current document requirements are approved. Inspection, facts, media and final publication review still apply.') : 'Required documents are incomplete, expired, awaiting review or need correction. New bookings and publication are blocked until current evidence is approved. Existing bookings remain in place.'}</p>
          {canReview && !editing && <button type="button" disabled={busy} onClick={edit} className={button}>{review.configured ? 'Revise document requirements' : 'Set accepted document requirements'}</button>}
          {credential&&review.configured&&review.context_current===false&&<p role="alert" className="text-sm leading-6 text-[var(--wh-danger-text)]">The offering or operating area changed. WeHouse must confirm the requirements again before uploads or publication.</p>}
          {review.requirements_note && <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--wh-text-secondary)]"><span className="font-medium">WeHouse requirements note: </span>{review.requirements_note}</p>}
          {editing && canReview && <div className="space-y-4 rounded-xl border border-[var(--wh-border-subtle)] p-4"><p className="text-sm leading-6 text-[var(--wh-text-secondary)]">{experience?'Confirm evidence and accepted alternatives for this activity, venue and jurisdiction. Record the review basis; do not require an unrelated service occupation.':worker?'Confirm accepted evidence and alternatives for this service and each operating area. Record why each licence, qualification, insurance or permit is required, or explicitly document that no additional credentials apply. A revision requires fresh review.':'Confirm accepted evidence for this property and jurisdiction. Use separate requirements for distinct permits. Saving a revision requires current evidence to be submitted and reviewed again.'}</p>
            {credential&&<label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={noAdditionalEvidence} disabled={busy} onChange={event=>{setNoAdditionalEvidence(event.target.checked);if(event.target.checked)setRequirements([]);}}/>I confirm that this offering and operating area require no additional evidence documents. The review basis below explains this decision.</label>}
            {requirements.map((item, index) => <div key={item.code} className="space-y-2"><label className="block text-sm font-medium">{item.label}<textarea disabled={busy} className={`${field} mt-2 min-h-24`} value={item.instructions} maxLength={2000} onChange={event => setRequirements(current => current.map((row, i) => i === index ? { ...row, instructions: event.target.value } : row))}/></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={item.requires_expiry} disabled={busy} onChange={event => setRequirements(current => current.map((row, i) => i === index ? { ...row, requires_expiry: event.target.checked } : row))}/>Expiry must be checked</label></div>)}
            <button type="button" className={button} disabled={busy || requirements.length >= 20} onClick={() => {setNoAdditionalEvidence(false);setRequirements(current => [...current, { code: `additional_${crypto.randomUUID().replaceAll('-', '')}`, label: 'Additional required evidence', instructions: '', requires_expiry: false }]);}}>Add another requirement</button>
            {requirements.some(item => item.code.startsWith('additional_')) && <div className="space-y-2">{requirements.filter(item => item.code.startsWith('additional_')).map(item => <label key={item.code} className="block text-sm">Additional evidence name<input className={field} value={item.label} maxLength={120} disabled={busy} onChange={event => setRequirements(current => current.map(row => row.code === item.code ? { ...row, label: event.target.value } : row))}/></label>)}</div>}
            <label className="block text-sm font-medium">Applicable requirements and review basis<textarea className={`${field} mt-2 min-h-24`} value={basis} maxLength={2000} disabled={busy} onChange={event => setBasis(event.target.value)} placeholder="Record the locally applicable requirements, accepted alternatives and basis for this decision."/></label>
            <div className="flex flex-wrap gap-2"><button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy || credential&&requirements.length===0&&!noAdditionalEvidence || basis.trim().length < (credential?20:10) || requirements.some(item => item.instructions.trim().length < 10)} onClick={() => void saveRequirements()}>Save requirements</button><button type="button" className={button} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
          </div>}
          {!editing && <div className="divide-y divide-[var(--wh-border-subtle)]">{review.requirements.map(rule => {
            const document = review.documents.find(item => item.requirement_code === rule.code);
            const status = propertyDocumentStatus(document);
            return <article key={rule.code} className="space-y-3 py-4"><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="text-sm font-semibold">{rule.label}</h4><span className="rounded-full bg-[var(--wh-elevated)] px-3 py-1 text-xs">{status}</span></div><p className="whitespace-pre-wrap text-sm leading-6 text-[var(--wh-text-secondary)]">{rule.instructions}</p>
              {document?.review_note && <p className="whitespace-pre-wrap rounded-xl bg-[var(--wh-elevated)] p-3 text-sm leading-6"><span className="font-medium">Review note: </span>{document.review_note}</p>}
              {document?.expires_at && <p className="text-sm text-[var(--wh-text-secondary)]">Expires {new Date(document.expires_at).toLocaleString()}</p>}
              {document && document.status !== 'uploading' && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void prepareDownload(document)}>Prepare private download</button>{download?.id === document.id && <a className={`${button} inline-flex items-center`} href={download.url} download={download.name}>Download document</a>}</div>}
              {review.can_submit && !operator && <div className="flex flex-wrap gap-2">{document?.status === 'uploading' ? <><p className="w-full text-sm leading-6 text-[var(--wh-text-secondary)]">A previous upload is unfinished. Confirm it if the file reached WeHouse, retry the same file, or discard the upload reference.</p><button type="button" disabled={busy} className={button} onClick={() => void act(() => finishReviewedDocument(document.id,false,kind), 'Document submitted for review.')}>Confirm uploaded file</button><button type="button" disabled={busy} className={button} onClick={() => void act(() => finishReviewedDocument(document.id,true,kind), 'Upload reference discarded.')}>Discard unfinished upload</button></> : null}
                <label className={`${button} inline-flex cursor-pointer items-center ${busy ? 'pointer-events-none opacity-50' : ''}`}>{document ? 'Choose replacement document' : 'Choose document'}<input type="file" className="sr-only" aria-label={`Upload ${rule.label}`} accept={PROPERTY_DOCUMENT_TYPES.join(',')} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void act(() => submitReviewedDocument(requestId, rule.code, file,kind), 'Document submitted for review.'); }}/></label></div>}
              {canReview && document && document.status !== 'uploading' && <div className="space-y-3"><label className="block text-sm">Review reason or correction needed<textarea className={`${field} mt-2`} maxLength={2000} value={notes[document.id] || ''} disabled={busy} onChange={event => setNotes(current => ({ ...current, [document.id]: event.target.value }))}/></label><label className="block text-sm">Evidence expires at {rule.requires_expiry ? '(required)' : '(if applicable)'}<input type="datetime-local" className={`${field} mt-2`} value={expiries[document.id] || ''} disabled={busy} onChange={event => setExpiries(current => ({ ...current, [document.id]: event.target.value }))}/></label><div className="flex flex-wrap gap-2">{([['approved', 'Approve evidence'], ['correction_required', 'Request correction'], ['rejected', 'Reject evidence']] as const).map(([decision, label]) => <button key={decision} type="button" disabled={busy || (notes[document.id] || '').trim().length < 5 || decision === 'approved' && rule.requires_expiry && !expiries[document.id]} className={button} onClick={() => void decide(document, decision)}>{label}</button>)}</div></div>}
            </article>;
          })}</div>}
        </>}
    {busy && <p role="status" className="text-sm text-[var(--wh-text-secondary)]">Confirming document action…</p>}
  </section>;
}
