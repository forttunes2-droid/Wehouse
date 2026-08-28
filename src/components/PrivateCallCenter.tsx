import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  endPrivateCall,
  getActiveCalls,
  getCallDetails,
  listCallSignals,
  respondPrivateCall,
  sendCallSignal,
  startPrivateCall,
  type CallSignal,
  type PrivateCall,
  type PrivateCallContext,
  type PrivateCallType,
} from "@/lib/private-calls";

type StartDetail = {
  contextType: PrivateCallContext;
  contextId: string;
  callType: PrivateCallType;
};
const finished = new Set(["declined", "missed", "ended", "failed"]);

export default function PrivateCallCenter() {
  const [userId, setUserId] = useState(""),
    [call, setCall] = useState<PrivateCall | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async (id: string) => {
    const result = await getCallDetails(id);
    if (result.call) setCall(result.call);
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("user_id,role")
        .eq("auth_id", user.id)
        .maybeSingle();
      if (!live || !data || !["user", "worker"].includes(String(data.role)))
        return;
      setUserId(data.user_id);
      const active = await getActiveCalls();
      if (active.calls.length) setCall(active.calls[0]);
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!userId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StartDetail>).detail;
      if (!detail || busy) return;
      void (async () => {
        setBusy(true);
        const result = await startPrivateCall(
          detail.contextType,
          detail.contextId,
          detail.callType,
        );
        setBusy(false);
        if (result.error || !result.call)
          return toast.error(result.error?.message || "Call could not start");
        setCall(result.call);
      })();
    };
    async function checkActive() {
      const active = await getActiveCalls();
      if (active.calls.length) setCall((current) => current || active.calls[0]);
    }
    window.addEventListener("wehouse:start-private-call", handler);
    const channel = supabase
      .channel(`calls:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "private_calls",
          filter: `callee_id=eq.${userId}`,
        },
        (payload) => void refresh(String((payload.new as any).id)),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "private_calls",
          filter: `caller_id=eq.${userId}`,
        },
        (payload) => void refresh(String((payload.new as any).id)),
      )
      .subscribe();
    const poll = window.setInterval(() => void checkActive(), 4000);
    const visible = () => {
      if (document.visibilityState === "visible") void checkActive();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("wehouse:start-private-call", handler);
      void supabase.removeChannel(channel);
    };
  }, [userId, busy, refresh]);
  useEffect(() => {
    if (!call || !finished.has(call.status)) return;
    const timer = window.setTimeout(() => setCall(null), 1200);
    return () => window.clearTimeout(timer);
  }, [call?.status]);
  async function answer(accept: boolean) {
    if (!call) return;
    const result = await respondPrivateCall(call.id, accept);
    if (result.error) return toast.error(result.error.message);
    setCall(result.call);
  }
  async function hangup() {
    if (!call) return;
    const result = await endPrivateCall(call.id);
    if (result.error) return toast.error(result.error.message);
    setCall(result.call);
  }
  if (!userId || !call) return null;
  if (call.status === "ringing" && call.callee_id === userId)
    return (
      <div className="fixed inset-0 z-[190] grid place-items-end bg-black/75 p-3 backdrop-blur-md sm:place-items-center">
        <section className="w-full rounded-[30px] border border-white/10 bg-[#11151D] p-6 text-center text-white sm:max-w-sm">
          <CallAvatar call={call} />
          <h2 className="mt-4 text-xl font-bold">
            {call.peer_name || "WeHouse member"}
          </h2>
          <p className="mt-1 text-[10px] text-[#818899]">Incoming audio call</p>
          <div className="mt-7 grid grid-cols-2 gap-3">
            <button
              onClick={() => void answer(false)}
              className="h-14 rounded-2xl bg-red-500/15 text-xs font-semibold text-red-200"
            >
              Decline
            </button>
            <button
              onClick={() => void answer(true)}
              className="h-14 rounded-2xl bg-emerald-500 text-xs font-semibold"
            >
              Answer
            </button>
          </div>
        </section>
      </div>
    );
  if (finished.has(call.status))
    return (
      <div className="fixed inset-0 z-[190] grid place-items-center bg-[#090A0F]/96 text-white">
        <div className="text-center">
          <CallAvatar call={call} />
          <p className="mt-4 text-lg font-bold">Call {call.status}</p>
        </div>
      </div>
    );
  return <RtcCall call={call} userId={userId} onHangup={() => void hangup()} />;
}

function RtcCall({
  call,
  userId,
  onHangup,
}: {
  call: PrivateCall;
  userId: string;
  onHangup: () => void;
}) {
  const remoteAudio = useRef<HTMLAudioElement>(null),
    pc = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    seen = useRef(new Set<string>()),
    pending = useRef<RTCIceCandidateInit[]>([]);
  const [connected, setConnected] = useState(false),
    [muted, setMuted] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void setup();
    return () => {
      live = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      pc.current?.close();
    };
    async function setup() {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        if (!live) return;
        stream.current = media;
        const peer = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pc.current = peer;
        media.getTracks().forEach((track) => peer.addTrack(track, media));
        peer.onicecandidate = (event) => {
          if (event.candidate)
            void sendCallSignal(
              call.id,
              userId,
              "ice",
              event.candidate.toJSON(),
            );
        };
        peer.ontrack = (event) => {
          const incoming = event.streams[0] || new MediaStream([event.track]);
          if (remoteAudio.current) remoteAudio.current.srcObject = incoming;
        };
        peer.onconnectionstatechange = () =>
          setConnected(peer.connectionState === "connected");
        async function process(signal: CallSignal) {
          if (seen.current.has(signal.id) || signal.sender_id === userId)
            return;
          seen.current.add(signal.id);
          if (signal.signal_type === "offer" && !peer.remoteDescription) {
            await peer.setRemoteDescription(signal.payload);
            while (pending.current.length)
              await peer.addIceCandidate(pending.current.shift());
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await sendCallSignal(call.id, userId, "answer", answer);
          } else if (
            signal.signal_type === "answer" &&
            peer.signalingState === "have-local-offer"
          ) {
            await peer.setRemoteDescription(signal.payload);
            while (pending.current.length)
              await peer.addIceCandidate(pending.current.shift());
          } else if (signal.signal_type === "ice") {
            if (peer.remoteDescription)
              await peer.addIceCandidate(signal.payload);
            else pending.current.push(signal.payload);
          }
        }
        const existing = await listCallSignals(call.id);
        for (const signal of existing.signals) await process(signal);
        const channel = supabase
          .channel(`signals:${call.id}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "private_call_signals",
              filter: `call_id=eq.${call.id}`,
            },
            (payload) => void process(payload.new as CallSignal),
          )
          .subscribe();
        if (call.caller_id === userId) {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await sendCallSignal(call.id, userId, "offer", offer);
        }
        if (!live) void supabase.removeChannel(channel);
      } catch (reason: any) {
        setError(
          reason?.name === "NotAllowedError"
            ? "Allow microphone access to make audio calls."
            : reason?.message || "Call media could not start",
        );
      }
    }
  }, [call.id, call.caller_id, userId]);
  function toggleMute() {
    const next = !muted;
    stream.current
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = !next));
    setMuted(next);
  }
  return (
    <div className="fixed inset-0 z-[190] flex h-[100dvh] flex-col bg-black text-white">
      <main className="relative min-h-0 flex-1">
        <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_center,rgba(124,58,237,.25),transparent_40%),#090A0F]">
          <div className="text-center">
            <CallAvatar call={call} />
            <h2 className="mt-5 text-2xl font-bold">
              {call.peer_name || "WeHouse member"}
            </h2>
            <p className="mt-2 text-[10px] text-[#8990A0]">
              {connected ? "Connected" : "Connecting…"}
            </p>
          </div>
        </div>
        <audio ref={remoteAudio} autoPlay />
        {error && (
          <p className="absolute inset-x-4 top-20 rounded-2xl bg-red-500/15 p-3 text-center text-[10px] text-red-100">
            {error}
          </p>
        )}
      </main>
      <footer className="flex justify-center gap-4 border-t border-white/10 bg-[#10131B] p-5">
        <button
          onClick={toggleMute}
          className="h-12 rounded-full bg-white/10 px-5 text-[10px]"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={onHangup}
          className="h-12 rounded-full bg-red-500 px-6 text-[10px] font-semibold"
        >
          End call
        </button>
      </footer>
    </div>
  );
}
function CallAvatar({ call }: { call: PrivateCall }) {
  return (
    <div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-violet-500 text-2xl font-bold">
      {call.peer_avatar ? (
        <img
          src={call.peer_avatar}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        (call.peer_name || "W")[0]
      )}
    </div>
  );
}
