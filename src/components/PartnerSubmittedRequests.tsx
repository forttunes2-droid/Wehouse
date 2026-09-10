import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase, uploadStorageObjectWithProgress } from "@/lib/supabase";
import type { Profile } from "@/types";
import { propertyLifecycleLabel } from "@/lib/status";
import PropertyInspectionRequestPanel from "./PropertyInspectionRequestPanel";
import PropertyMediaCarousel from "./PropertyMediaCarousel";
import PropertyAccessRecorder, {
  MIN_PROPERTY_ACCESS_SECONDS,
  propertyAccessDuration,
} from "./PropertyAccessRecorder";
import BackButton from "@/components/BackButton";
import { ListingMediaImage } from "./ListingCandidateMedia";
import PartnerHotelOperations from "./PartnerHotelOperations";

export type SubmissionFilter = "all" | "submitted" | "public" | "rejected";
export type PartnerAssetKind = "apartment" | "hotel";

type RequestRow = {
  id: string;
  request_code: string | null;
  property_address: string | null;
  property_display_name: string | null;
  property_type: string | null;
  sub_type: string | null;
  property_state: string | null;
  property_city: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  expected_rent: number | null;
  security_deposit_amount: number | null;
  max_guests: number | null;
  description: string | null;
  photo_urls: string[] | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  location_accuracy_m: number | null;
  status: string | null;
  created_at: string | null;
  scheduled_date: string | null;
  completed_at: string | null;
  draft_listing_id: string | null;
  draft_hotel_id: number | null;
  published_at: string | null;
  notes: string | null;
  rejection_reason: string | null;
  submission_batch_id: string | null;
  submission_batch_position: number | null;
  authority_relationship: string | null;
  access_evidence_status: string | null;
  lifecycle_stage: string | null;
  hotel_program: {
    name?: string;
    amenities?: string[];
    room_types?: Array<{
      name?: string;
      description?: string | null;
      nightly_rate?: number;
      guest_capacity?: number;
      inventory?: number;
      bed_type?: string | null;
      amenities?: string[];
      media?: string[];
    }>;
  } | null;
};

const fields =
  "id,request_code,property_address,property_display_name,property_type,sub_type,property_state,property_city,bedrooms,bathrooms,expected_rent,security_deposit_amount,max_guests,description,photo_urls,gps_latitude,gps_longitude,location_accuracy_m,status,created_at,scheduled_date,completed_at,draft_listing_id,draft_hotel_id,published_at,notes,rejection_reason,submission_batch_id,submission_batch_position,authority_relationship,access_evidence_status,lifecycle_stage,hotel_program";

export default function PartnerSubmittedRequests({
  profile,
  filter = "all",
  onDetailChange,
  onCreationChange,
  initialRecordId,
  assetKind = "apartment",
}: {
  profile: Profile;
  filter?: SubmissionFilter;
  onDetailChange?: (open: boolean) => void;
  onCreationChange?: (open: boolean) => void;
  initialRecordId?: string;
  assetKind?: PartnerAssetKind;
}) {
  const openedTarget = useRef<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    onDetailChange?.(Boolean(selected));
    return () => onDetailChange?.(false);
  }, [selected, onDetailChange]);
  useEffect(() => {
    onCreationChange?.(creating);
    return () => onCreationChange?.(false);
  }, [creating, onCreationChange]);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from("inspection_requests")
      .select(fields)
      .eq("owner_id", profile.user_id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message || "Unable to load property requests");
      setRequests([]);
    } else {
      setRequests((data || []) as RequestRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("inspection_requests")
        .select(fields)
        .eq("owner_id", profile.user_id)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        toast.error(error.message || "Unable to load property requests");
        setRequests([]);
      } else {
        const nextRequests = (data || []) as RequestRow[];
        setRequests(nextRequests);
        if (
          initialRecordId &&
          openedTarget.current !== String(initialRecordId)
        ) {
          openedTarget.current = String(initialRecordId);
          const target = nextRequests.find((request) =>
            [request.id, request.draft_listing_id, request.draft_hotel_id]
              .filter(Boolean)
              .some((value) => String(value) === String(initialRecordId)),
          );
          if (target) setSelected(target);
          else toast.error("The linked property is no longer available.");
        }
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [initialRecordId, profile.user_id]);

  const batchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of requests)
      if (request.submission_batch_id)
        counts.set(
          request.submission_batch_id,
          (counts.get(request.submission_batch_id) || 0) + 1,
        );
    return counts;
  }, [requests]);
  const visibleRequests = useMemo(
    () =>
      requests.filter((request) => {
        if (request.property_type !== assetKind) return false;
        const stage = request.lifecycle_stage || "access_required";
        if (filter === "public") return stage === "live";
        if (filter === "rejected")
          return ["changes_requested", "rejected"].includes(stage);
        if (filter === "submitted")
          return !["live", "changes_requested", "rejected"].includes(stage);
        return true;
      }),
    [assetKind, filter, requests],
  );

  function contact(request: RequestRow) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "property_inspection",
          subject: `Property inspection ${request.request_code || ""}`.trim(),
          contextType: "property_inspection",
          contextId: request.id,
          contextSnapshot: {
            request_code: request.request_code,
            property_address: request.property_address,
            property_type: request.property_type,
            city: request.property_city,
            state: request.property_state,
            status: request.status,
          },
        },
      }),
    );
  }

  if (selected)
    return (
      <RequestDetail
        profile={profile}
        request={selected}
        onBack={() => setSelected(null)}
        onContact={() => contact(selected)}
        onCorrected={() => {
          setSelected(null);
          void refresh();
        }}
      />
    );

  return (
    <div className="space-y-6">
      <PropertyInspectionRequestPanel
        profile={profile}
        onOpenChange={setCreating}
      />
      {!creating && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                Submitted {assetKind === "hotel" ? "hotels" : "apartments"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-white/[.07] px-3 py-2 text-[9px] text-[#888A9B]"
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <Loader />
          ) : visibleRequests.length === 0 ? (
            <Empty filter={filter} />
          ) : (
            <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
              {visibleRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => setSelected(request)}
                  className="flex w-full items-center gap-3 py-4 text-left transition active:bg-white/[.025]"
                >
                  <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-[#191A24]">
                    {request.photo_urls?.[0] ? (
                      <ListingMediaImage
                        reference={request.photo_urls[0]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[9px] text-[#595C6D]">
                        No photo
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-semibold">
                        {request.property_address ||
                          request.property_type ||
                          "Property"}
                      </p>
                      <Status request={request} />
                    </div>
                    <p className="mt-1 truncate text-[9px] text-[#696C7D]">
                      {[request.property_city, request.property_state]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[8px] text-[#777A8B]">
                      <span>{request.request_code || "Request sent"}</span>
                      {request.submission_batch_id &&
                        Number(
                          batchCounts.get(request.submission_batch_id) || 0,
                        ) > 1 && (
                          <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-300">
                            Property {request.submission_batch_position} of{" "}
                            {batchCounts.get(request.submission_batch_id)}
                          </span>
                        )}
                      <span className="ml-auto text-violet-300">
                        View details →
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function RequestDetail({
  profile,
  request,
  onBack,
  onContact,
  onCorrected,
}: {
  profile: Profile;
  request: RequestRow;
  onBack: () => void;
  onContact: () => void;
  onCorrected: () => void;
}) {
  const images = request.photo_urls || [];
  const stage = request.lifecycle_stage || "access_required";
  const stopped = ["changes_requested", "rejected"].includes(stage);
  const progress =
    stage === "live"
      ? 5
      : stage === "listing_prepared"
        ? 4
        : stage === "awaiting_review" || stage === "ready_to_prepare"
          ? 3
          : stage === "inspection"
            ? 2
            : 1;
  const steps = [
    "Received",
    "Inspection",
    "Evidence accepted",
    "Listing prepared",
    "Public",
  ];
  if (
    stage === "live" &&
    request.property_type === "hotel" &&
    request.draft_hotel_id
  )
    return <LiveHotel profile={profile} request={request} onBack={onBack} />;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <span className="text-xs text-[#A1A3B1]">Submitted properties</span>
      </div>
      <section className="overflow-hidden rounded-3xl border border-white/[.06] bg-[#111119]">
        {images.length > 0 ? (
          <PropertyMediaCarousel
            images={images}
            title={request.property_address || "Submitted property"}
          />
        ) : (
          <div className="grid aspect-[16/8] place-items-center bg-gradient-to-br from-violet-500/10 to-transparent text-[10px] text-[#696D7D]">
            No property media supplied
          </div>
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-violet-300">
                {request.request_code || "Property request"}
              </p>
              <h2 className="mt-2 text-xl font-bold">
                {request.property_address || "Submitted property"}
              </h2>
              <p className="mt-1 text-[10px] text-[#747789]">
                {[request.property_city, request.property_state]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <Status request={request} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Info label="Type" value={friendly(request.property_type)} />
            <Info label="Stay" value={friendly(request.sub_type)} />
            <Info label="Bedrooms" value={request.bedrooms ?? "—"} />
            <Info label="Bathrooms" value={request.bathrooms ?? "—"} />
            {request.sub_type === "short_let" && (
              <Info label="Guests" value={`Up to ${request.max_guests || 1}`} />
            )}
          </div>
          <div className="mt-2">
            <Info
              label="Your relationship"
              value={friendly(request.authority_relationship)}
            />
          </div>
          {request.description && (
            <div className="mt-4">
              <p className="text-[9px] uppercase tracking-wide text-[#66697A]">
                Property details
              </p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[#A5A7B3]">
                {request.description}
              </p>
            </div>
          )}
        </div>
      </section>
      {request.property_type === "hotel" &&
      request.hotel_program?.room_types?.length ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Hotel rooms</h3>
            <p className="mt-1 text-[9px] text-[#696D7D]">
              Each room type keeps its own gallery, description, amenities, rate
              and inventory.
            </p>
          </div>
          {request.hotel_program.room_types.map((room, index) => (
            <article
              key={`${room.name}-${index}`}
              className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#111119]"
            >
              {room.media?.length ? (
                <PropertyMediaCarousel
                  images={room.media}
                  title={room.name || `Room ${index + 1}`}
                />
              ) : null}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold">
                      {room.name || `Room ${index + 1}`}
                    </h4>
                    <p className="mt-1 text-[9px] text-[#73798A]">
                      Up to {room.guest_capacity || 1} guests
                      {room.bed_type ? ` · ${room.bed_type}` : ""} ·{" "}
                      {room.inventory || 1} available
                    </p>
                  </div>
                  <p className="text-sm font-bold text-violet-200">
                    ₦{Number(room.nightly_rate || 0).toLocaleString()}
                    <span className="block text-right text-[8px] font-normal text-[#656B7C]">
                      per night
                    </span>
                  </p>
                </div>
                {room.description && (
                  <p className="mt-3 text-[10px] leading-5 text-[#969BA9]">
                    {room.description}
                  </p>
                )}
                {room.amenities?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {room.amenities.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-white/[.07] px-2.5 py-1 text-[8px] text-[#A0A5B3]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      <AccessEvidenceSummary status={request.access_evidence_status} />
      {stage === "changes_requested" && (
        <AccessEvidenceCorrection
          profile={profile}
          request={request}
          onCorrected={onCorrected}
        />
      )}
      <section className="border-y border-white/[.06] py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Publication status</h3>
          </div>
          <span
            className={`rounded-full px-2 py-1 text-[8px] font-semibold ${stopped ? "bg-red-500/10 text-red-300" : "bg-violet-500/10 text-violet-300"}`}
          >
            {stopped ? friendly(stage) : `${progress} of 5`}
          </span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
          <div
            className={`h-full rounded-full ${progress === 5 ? "bg-emerald-400" : "bg-violet-400"}`}
            style={{ width: `${progress * 20}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[8px] text-[#686E7E]">
          <span>{steps[Math.max(0, progress - 1)]}</span>
          <span>{progress}/5</span>
        </div>
        {stage === "inspection" && request.scheduled_date && (
          <p className="mt-4 rounded-xl bg-violet-500/[.06] p-3 text-[10px] text-violet-200">
            Inspection visit:{" "}
            {new Date(request.scheduled_date).toLocaleString()}
          </p>
        )}
        <p className="mt-3 text-[9px] leading-5 text-[#777C8D]">
          {journeyNext(stage)}
        </p>
      </section>
      {(request.notes || request.rejection_reason) && (
        <section className="rounded-2xl border border-white/[.06] bg-[#111119] p-4">
          <p className="text-[9px] uppercase tracking-wide text-[#66697A]">
            Latest WeHouse update
          </p>
          <p className="mt-2 text-xs leading-6 text-[#A5A7B3]">
            {request.rejection_reason || request.notes}
          </p>
        </section>
      )}
      {request.gps_latitude != null && request.gps_longitude != null && (
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.04] p-4">
          <p className="text-xs font-semibold">Location recorded privately</p>
          <p className="mt-1 text-[10px] text-[#777E90]">
            The exact property location is available only to authorized WeHouse operations for
            inspection and handover.
          </p>
        </section>
      )}
      <button
        type="button"
        onClick={onContact}
        className="h-12 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.08] text-xs font-semibold text-violet-200"
      >
        Message WeHouse
      </button>
    </div>
  );
}

function LiveHotel({
  profile,
  request,
  onBack,
}: {
  profile: Profile;
  request: RequestRow;
  onBack: () => void;
}) {
  const [hotel, setHotel] = useState<any | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("hotels")
        .select("*")
        .eq("hotel_id", request.draft_hotel_id)
        .maybeSingle();
      if (!active) return;
      if (error) toast.error(error.message);
      setHotel(data || null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [request.draft_hotel_id]);
  if (loading) return <Loader />;
  if (!hotel)
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} />
        <p className="rounded-2xl border border-amber-500/15 p-4 text-[10px] text-amber-200">
          The live hotel record could not be opened. Refresh and try again.
        </p>
      </div>
    );
  return (
    <PartnerHotelOperations
      hotel={hotel}
      accessRole="owner"
      profile={profile}
      onBack={onBack}
    />
  );
}

type AccessChallenge = { id: string; code: string; expires_at: string };
function AccessEvidenceCorrection({
  profile,
  request,
  onCorrected,
}: {
  profile: Profile;
  request: RequestRow;
  onCorrected: () => void;
}) {
  const [challenge, setChallenge] = useState<AccessChallenge | null>(null);
  const [recording, setRecording] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const challengeCurrent = Boolean(
    challenge && new Date(challenge.expires_at).getTime() > Date.now() + 60_000,
  );
  async function prepare() {
    setBusy(true);
    const { data, error } = await supabase.rpc(
      "create_my_property_access_correction",
      { p_request_id: request.id },
    );
    setBusy(false);
    if (error)
      return toast.error(
        error.message || "Unable to prepare replacement evidence",
      );
    setChallenge(data as AccessChallenge);
    setRecording(null);
  }
  async function submit() {
    if (!challenge || !recording) return;
    if (!challengeCurrent)
      return toast.error("Create a new access code before uploading");
    if (recording.size > 100 * 1024 * 1024)
      return toast.error("Access recording must be under 100MB");
    const duration = propertyAccessDuration(recording);
    if (duration < MIN_PROPERTY_ACCESS_SECONDS)
      return toast.error(
        `Record at least ${MIN_PROPERTY_ACCESS_SECONDS} seconds of continuous access evidence`,
      );
    setBusy(true);
    const checked = await supabase.rpc(
      "validate_my_property_access_challenge",
      { p_challenge_id: challenge.id },
    );
    if (checked.error || !checked.data?.valid) {
      setBusy(false);
      return toast.error(
        checked.error?.message ||
          "This access code expired. Create a new code and record again.",
      );
    }
    const extension = recording.type.includes("mp4")
      ? "mp4"
      : recording.type.includes("quicktime")
        ? "mov"
        : "webm";
    const path = `${profile.user_id}/${challenge.id}/${crypto.randomUUID()}-${duration}s.${extension}`;
    try {
      await uploadStorageObjectWithProgress(
        "property-access-private",
        path,
        recording,
        recording.type || "video/webm",
        setUploadProgress,
      );
    } catch (error) {
      setBusy(false);
      setUploadProgress(null);
      return toast.error(
        error instanceof Error
          ? error.message
          : "Replacement recording upload failed",
      );
    }
    const result = await supabase.rpc("submit_my_property_access_correction", {
      p_request_id: request.id,
      p_challenge_id: challenge.id,
      p_video_path: path,
    });
    if (result.error) {
      await supabase.storage.from("property-access-private").remove([path]);
      setBusy(false);
      setUploadProgress(null);
      return toast.error(result.error.message);
    }
    setBusy(false);
    setUploadProgress(null);
    toast.success("Replacement evidence sent to WeHouse");
    onCorrected();
  }
  if (!challenge || !challengeCurrent)
    return (
      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[.05] p-4">
        <p className="text-xs font-semibold text-amber-200">
          Correct this submission
        </p>
        <p className="mt-1 text-[9px] leading-5 text-[#85899A]">
          Record replacement access evidence here. It stays attached to this
          property and returns to Property Operations review without creating a
          duplicate.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void prepare()}
          className="mt-3 h-11 w-full rounded-xl bg-amber-400 text-[10px] font-semibold text-black disabled:opacity-40"
        >
          {busy
            ? "Preparing…"
            : challenge
              ? "Create new code"
              : "Record replacement evidence"}
        </button>
      </section>
    );
  return (
    <div className="space-y-3">
      <PropertyAccessRecorder
        code={challenge.code}
        expiresAt={challenge.expires_at}
        recordedFile={recording}
        onRecorded={setRecording}
        disabled={busy}
      />
      {recording && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40"
        >
          {busy
            ? `Sending replacement · ${uploadProgress ?? 0}%`
            : "Send replacement to WeHouse"}
        </button>
      )}
    </div>
  );
}

function AccessEvidenceSummary({ status }: { status: string | null }) {
  const verified = status === "verified";
  const rejected = status === "rejected";
  const submitted = status === "submitted";
  return (
    <section
      className={`border-y py-4 ${verified ? "border-emerald-500/15" : rejected ? "border-amber-500/15" : "border-white/[.06]"}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${verified ? "bg-emerald-500/15 text-emerald-300" : rejected ? "bg-amber-500/15 text-amber-300" : "bg-violet-500/10 text-violet-300"}`}
        >
          {verified ? "✓" : rejected ? "!" : "•"}
        </span>
        <div>
          <p className="text-xs font-semibold">
            {verified
              ? "Property access confirmed"
              : rejected
                ? "WeHouse requested new evidence"
                : submitted
                  ? "Private access recording received"
                  : "Access evidence unavailable"}
          </p>
          <p className="mt-1 text-[9px] leading-4 text-[#74798A]">
            {verified
              ? "The private access recording passed review."
              : rejected
                ? "Read the latest WeHouse update for the correction required."
                : submitted
                  ? "The temporary code was consumed and is no longer displayed. Operations will review the private recording before a Field Operations visit is assigned."
                  : "This earlier submission has no accepted access recording. It cannot advance until WeHouse resolves the evidence requirement."}
          </p>
        </div>
      </div>
    </section>
  );
}

function journeyNext(stage: string) {
  if (stage === "access_required")
    return "Next: resolve the missing access evidence with WeHouse. A Field Operations visit cannot be assigned yet.";
  if (stage === "access_review")
    return "Next: Property Operations reviews the private access recording.";
  if (stage === "inspection_ready")
    return "Next: WeHouse assigns Field Operations member for an independent visit.";
  if (stage === "inspection")
    return "Next: Field Operations submits independent visit evidence.";
  if (stage === "awaiting_review")
    return "Next: Property Operations reviews the independent Field Operations evidence.";
  if (stage === "ready_to_prepare")
    return "Next: WeHouse prepares the non-public listing using your accepted property facts.";
  if (stage === "listing_prepared")
    return "Next: an Admin or Creator performs the final preview and publishes it.";
  if (stage === "live") return "This property is now public on WeHouse.";
  if (stage === "changes_requested")
    return "Action needed: follow the latest WeHouse correction request. The submission is not progressing.";
  return "This submission has been stopped by WeHouse.";
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-b border-white/[.055] py-3">
      <p className="text-[8px] uppercase text-[#5F6273]">{label}</p>
      <p className="mt-1 truncate text-[10px] font-semibold capitalize">
        {value || "—"}
      </p>
    </div>
  );
}
function Status({ request }: { request: RequestRow }) {
  const state = partnerState(request);
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${state.tone}`}
    >
      {state.label}
    </span>
  );
}
function partnerState(request: RequestRow) {
  const stage = request.lifecycle_stage || "access_required";
  const tone =
    stage === "live"
      ? "bg-emerald-500/10 text-emerald-300"
      : stage === "rejected"
        ? "bg-red-500/10 text-red-300"
        : stage === "changes_requested"
          ? "bg-amber-500/10 text-amber-300"
          : "bg-violet-500/10 text-violet-300";
  return { label: propertyLifecycleLabel(stage), tone };
}
function Loader() {
  return (
    <div className="grid min-h-40 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function Empty({ filter }: { filter: SubmissionFilter }) {
  const copy =
    filter === "public"
      ? [
          "No public listings yet",
          "Published properties and hotels will appear here.",
        ]
      : filter === "rejected"
        ? [
            "No rejected submissions",
            "Properties needing correction or stopped by WeHouse will appear here.",
          ]
        : filter === "submitted"
          ? [
              "No submissions in review",
              "New and in-progress submissions will appear here.",
            ]
          : [
              "No properties submitted yet",
              "Use Add properties above to send your first property.",
            ];
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center">
      <p className="text-sm font-semibold">{copy[0]}</p>
      <p className="mt-2 text-[10px] text-[#66697A]">{copy[1]}</p>
    </div>
  );
}
function friendly(value: string | null | undefined) {
  return String(value || "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
