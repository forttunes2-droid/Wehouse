import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  endPrivateCall,
  getActiveCalls,
  getCallDetails,
  getPrivateCallIceServers,
  getCallPreferences,
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
    [call, setCall] = useState<PrivateCall | null>(null);
  const starting = useRef(false);
  const closing = useRef<string|null>(null);
  const responding = useRef(false);
  const [answering,setAnswering]=useState(false);
  const refresh = useCallback(async (id: string) => {
    const result = await getCallDetails(id);
    if(closing.current===id)return;
    if (result.error || !result.call) { setCall(null); return; }
    setCall(result.call);
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
        .select("user_id")
        .eq("auth_id", user.id)
        .maybeSingle();
      if (!live || !data) return;
      const permission=await getCallPreferences();
      if(!live||permission.error||!permission.preferences)return;
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
      if (!detail || starting.current) return;
      starting.current = true;
      void (async () => {
        const result = await startPrivateCall(
          detail.contextType,
          detail.contextId,
          detail.callType,
        );
        starting.current = false;
        if (result.error || !result.call)
          return toast.error(result.error?.message || "Call could not start");
        setCall(result.call);
      })();
    };
    async function checkActive() {
      const active = await getActiveCalls();
      if(active.error){setCall(null);return;}
      const available=active.calls.filter(item=>item.id!==closing.current);
      setCall(current=>available.find(item=>item.id===current?.id)||available[0]||null);
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
  }, [userId, refresh]);
  useEffect(() => {
    if (!call || !finished.has(call.status)) return;
    const timer = window.setTimeout(() => setCall(null), 1200);
    return () => window.clearTimeout(timer);
  }, [call?.status]);
  useEffect(() => {
    if (!call || call.status !== "ringing" || call.caller_id !== userId) return;
    const timeout = window.setTimeout(async () => {
      const result = await endPrivateCall(call.id);
      if (result.call) setCall(result.call);
    }, 45_000);
    return () => window.clearTimeout(timeout);
  }, [call?.id, call?.status, call?.caller_id, userId]);
  async function answer(accept: boolean) {
    if (!call||responding.current) return;
    responding.current=true;setAnswering(true);
    const result = await respondPrivateCall(call.id, accept);
    responding.current=false;setAnswering(false);
    if(closing.current===call.id)return;
    if (result.error) return toast.error(result.error.message);
    setCall(result.call);
  }
  async function hangup() {
    if (!call) return;
    const closingId = call.id;
    closing.current=closingId;
    setCall(null);
    const result = await endPrivateCall(closingId);
    if (result.error) return toast.error(result.error.message);
  }
  if (!userId || !call || finished.has(call.status)) return null;
  if (call.status === "ringing" && call.callee_id === userId)
    return (
      <div className="fixed inset-0 z-[190] grid place-items-end bg-black/75 p-3 backdrop-blur-md sm:place-items-center">
        <section className="w-full rounded-[30px] border border-[var(--wh-border)] bg-[var(--wh-surface)] p-6 text-center text-[var(--wh-text)] sm:max-w-sm" aria-label="Incoming call">
          <CallAvatar call={call} />
          <h2 className="mt-4 text-xl font-bold">
            {call.peer_name || "WeHouse member"}
          </h2>
          <p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Incoming {call.call_type} call</p>
          <div className="mt-7 grid grid-cols-2 gap-3">
            <button
              onClick={() => void answer(false)}
              disabled={answering}
              className="h-14 rounded-2xl bg-red-500/15 text-xs font-semibold text-red-700 dark:text-red-200"
            >
              Decline
            </button>
            <button
              onClick={() => void answer(true)}
              disabled={answering}
              className="h-14 rounded-2xl bg-emerald-600 text-xs font-semibold text-white"
            >
              Answer
            </button>
          </div>
        </section>
      </div>
    );
  if (finished.has(call.status))
    return (
      <div className="fixed inset-0 z-[190] grid place-items-center bg-[var(--wh-bg)]/96 text-white">
        <div className="text-center">
          <CallAvatar call={call} />
          <p className="mt-4 text-lg font-bold">Call {call.status}</p>
        </div>
      </div>
    );
  return <RtcCall key={call.id} call={call} userId={userId} onHangup={() => void hangup()} />;
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
  const remoteMedia = useRef<HTMLVideoElement>(null),
    localVideo = useRef<HTMLVideoElement>(null),
    pc = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    seen = useRef(new Set<string>()),
    pending = useRef<RTCIceCandidateInit[]>([]);
  const [connected, setConnected] = useState(false),
    [connectionLabel, setConnectionLabel] = useState("Connecting…"),
    [muted, setMuted] = useState(false),
    [cameraOff, setCameraOff] = useState(false),
    [facingMode, setFacingMode] = useState<"user" | "environment">("user"),
    [outputSelectionAvailable, setOutputSelectionAvailable] = useState(false),
    [error, setError] = useState("");
  const isVideo = call.call_type === "video";
  const mounted = useRef(false);
  const switchingCamera = useRef(false);
  useEffect(() => {
    let live = true;
    mounted.current = true;
    let signalChannel:ReturnType<typeof supabase.channel>|undefined;
    setOutputSelectionAvailable(typeof (navigator.mediaDevices as MediaDevices & {selectAudioOutput?: unknown})?.selectAudioOutput === 'function' && typeof (HTMLMediaElement.prototype as HTMLMediaElement & {setSinkId?: unknown}).setSinkId === 'function');
    void setup();
    return () => {
      live = false;
      mounted.current = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      pc.current?.close();
      if(signalChannel)void supabase.removeChannel(signalChannel);
    };
    async function setup() {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: isVideo
            ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
            : false,
        });
        if (!live) { media.getTracks().forEach(track=>track.stop()); return; }
        stream.current = media;
        if (isVideo && localVideo.current) localVideo.current.srcObject = media;
        const ice = await getPrivateCallIceServers(call.id);
        if (!live) return;
        if (!ice.relayReady) setConnectionLabel("Connecting… relay unavailable");
        const peer = new RTCPeerConnection({ iceServers: ice.iceServers });
        pc.current = peer;
        media.getTracks().forEach((track) => peer.addTrack(track, media));
        peer.onicecandidate = (event) => {
          if (event.candidate)
            void sendCallSignal(
              call.id,
              userId,
              "ice",
              event.candidate.toJSON(),
            ).then(result=>{if(result.error&&live){setError("Call signalling stopped. End the call and try again.");stream.current?.getTracks().forEach(track=>track.stop());peer.close();}});
        };
        peer.ontrack = (event) => {
          const incoming = event.streams[0] || new MediaStream([event.track]);
          if (remoteMedia.current) remoteMedia.current.srcObject = incoming;
        };
        peer.onconnectionstatechange = () => {
          const state=peer.connectionState;
          setConnected(state === "connected");
          if(state === "connected") setConnectionLabel("Connected");
          else if(state === "disconnected") setConnectionLabel("Reconnecting…");
          else if(state === "failed") { setConnectionLabel("Connection failed"); setError("The call connection was lost. Check your network and try reconnecting."); }
          else if(state === "connecting" || state === "new") setConnectionLabel("Connecting…");
        };
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
            const sent=await sendCallSignal(call.id, userId, "answer", answer);
            if(sent.error)throw new Error(sent.error.message);
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
        if(!live)return;
        if(existing.error)throw new Error(existing.error.message);
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
            (payload) => void process(payload.new as CallSignal).catch(()=>{if(live){setError("Call signalling stopped. End the call and try again.");stream.current?.getTracks().forEach(track=>track.stop());peer.close();}}),
          )
          .subscribe();
        signalChannel=channel;
        if (call.caller_id === userId) {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          const sent=await sendCallSignal(call.id, userId, "offer", offer);
          if(sent.error)throw new Error(sent.error.message);
        }
        if (!live) void supabase.removeChannel(channel);
      } catch (reason: any) {
        stream.current?.getTracks().forEach(track=>track.stop());
        pc.current?.close();
        if (!live) return;
        setError(
          reason?.name === "NotAllowedError"
            ? `Allow ${isVideo ? "camera and microphone" : "microphone"} access to make this call.`
            : reason?.message || "Call media could not start",
        );
      }
    }
  }, [call.id, call.caller_id, isVideo, userId]);
  useEffect(()=>{if(call.status!=="accepted"||connected||error)return;const timer=window.setTimeout(()=>{setConnectionLabel("Could not connect");setError("The call could not connect on this network. End the call and try again.")},15000);return()=>window.clearTimeout(timer)},[call.id,call.status,connected,error]);
  function toggleMute() {
    const next = !muted;
    stream.current
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = !next));
    setMuted(next);
  }
  function toggleCamera() {
    const next = !cameraOff;
    stream.current?.getVideoTracks().forEach((track) => (track.enabled = !next));
    setCameraOff(next);
  }
  async function switchCamera(){
    if(!isVideo||switchingCamera.current)return;
    switchingCamera.current=true;
    let replacement:MediaStream|undefined;
    try{
      const next=facingMode==="user"?"environment":"user";
      replacement=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:next},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(!mounted.current)return;
      const track=replacement.getVideoTracks()[0];
      const sender=pc.current?.getSenders().find(item=>item.track?.kind==="video");
      if(!track||!sender)throw new Error("Camera switching is not available on this device");
      await sender.replaceTrack(track);
      if(!mounted.current)return;
      stream.current?.getVideoTracks().forEach(item=>{item.stop();stream.current?.removeTrack(item)});
      stream.current?.addTrack(track);
      if(localVideo.current)localVideo.current.srcObject=stream.current;
      setFacingMode(next); setCameraOff(false);
      replacement=undefined;
    }catch(reason){if(mounted.current)toast.error(reason instanceof Error?reason.message:"Camera could not switch")}
    finally{replacement?.getTracks().forEach(track=>track.stop());switchingCamera.current=false;}
  }
  async function toggleSpeaker(){
    const media=remoteMedia.current as (HTMLMediaElement & {setSinkId?:(id:string)=>Promise<void>})|null;
    if(!media?.setSinkId)return toast.error("Audio output selection is not supported on this device");
    try{
      const devices=navigator.mediaDevices as MediaDevices & {selectAudioOutput?:()=>Promise<MediaDeviceInfo>};
      if(!devices.selectAudioOutput)return;
      const output=await devices.selectAudioOutput();
      if(mounted.current)await media.setSinkId(output.deviceId);
    }catch(reason){if(mounted.current && !(reason instanceof DOMException && reason.name==='NotAllowedError'))toast.error("Audio output could not be changed")}
  }
  return (
    <div className="fixed inset-0 z-[190] flex h-[100dvh] flex-col bg-black text-white">
      <main className="relative min-h-0 flex-1">
        <div className="grid h-full place-items-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(124,58,237,.25),transparent_40%),#090A0F]">
          {isVideo && <video ref={remoteMedia} autoPlay playsInline className="absolute inset-0 h-full w-full bg-black object-cover" />}
          <div className="text-center">
            <CallAvatar call={call} />
            <h2 className="mt-5 text-2xl font-bold">
              {call.peer_name || "WeHouse member"}
            </h2>
            <p className="mt-2 text-xs text-white/75">
              {error ? 'Call needs attention' : call.status==='ringing' ? 'Calling…' : connected ? "Connected" : connectionLabel}
            </p>
          </div>
          {isVideo && <video ref={localVideo} autoPlay muted playsInline className="absolute right-4 top-4 h-40 w-28 rounded-2xl border border-white/20 bg-[var(--wh-surface)] object-cover shadow-2xl sm:h-52 sm:w-36" />}
        </div>
        {!isVideo && <video ref={remoteMedia} autoPlay playsInline className="hidden" />}
        {error && (
          <div role="alert" className="absolute inset-x-4 top-20 rounded-2xl p-4 text-center text-sm" style={{color:'#ffe4e6',backgroundColor:'#321217'}}><p>{error}</p><p className="mt-2">End this call before trying again.</p></div>
        )}
      </main>
      <footer className="flex flex-wrap justify-center gap-3 border-t border-white/10 bg-[#10131a] p-4 sm:gap-4 sm:p-5">
        {stream.current?.getAudioTracks().length ? <button
          onClick={toggleMute}
          className="h-12 rounded-full bg-white/10 px-5 text-xs"
        >
          {muted ? "Unmute" : "Mute"}
        </button> : null}
        {isVideo && <button onClick={toggleCamera} className="h-12 rounded-full bg-white/10 px-5 text-xs">{cameraOff ? "Start camera" : "Stop camera"}</button>}
        {isVideo && <button onClick={()=>void switchCamera()} className="h-12 rounded-full bg-white/10 px-5 text-xs">Switch camera</button>}
        {outputSelectionAvailable && <button onClick={()=>void toggleSpeaker()} className="h-12 rounded-full bg-white/10 px-5 text-xs">Audio output</button>}
        <button
          onClick={onHangup}
          className="h-12 rounded-full bg-red-500 px-6 text-xs font-semibold"
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
