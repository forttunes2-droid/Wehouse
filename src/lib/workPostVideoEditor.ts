import type { PreparedVideo } from '@/lib/mediaVideo';

const recorderType = () => ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm']
  .find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));

export async function workVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    video.preload = 'metadata';
    return await new Promise<number>((resolve,reject) => {
      const timeout = window.setTimeout(()=>reject(new Error('Video metadata timed out')),10000);
      video.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(video.duration); };
      video.onerror = () => { window.clearTimeout(timeout); reject(new Error('Video could not be opened')); };
      video.src = url;
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

/** Local editing only. No outside music catalogue or licensing service is used. */
export async function editWorkPostVideo(file: File, start: number, end: number, sound?: File | null, soundVolume = 0.6): Promise<PreparedVideo> {
  const mimeType = recorderType();
  if (!mimeType || typeof AudioContext === 'undefined') throw new Error('Video editing is unavailable on this device. Upload the original video instead.');
  const duration = await workVideoDuration(file);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.1 || end-start < 1 || end-start > 90)
    throw new Error('Choose a clip between 1 and 90 seconds.');
  if (sound && (!sound.type.startsWith('audio/') || sound.size > 15_000_000)) throw new Error('Choose an audio file under 15 MB.');
  const sourceUrl = URL.createObjectURL(file);
  const soundUrl = sound ? URL.createObjectURL(sound) : null;
  const video = document.createElement('video'); video.playsInline = true; video.preload = 'auto'; video.src = sourceUrl;
  const audio = soundUrl ? document.createElement('audio') : null;
  if (audio && soundUrl) { audio.src = soundUrl; audio.loop = true; audio.preload = 'auto'; }
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let frame = 0;
  let timer = 0;
  try {
    await new Promise<void>((resolve,reject) => {
      const timeout = window.setTimeout(()=>reject(new Error('Video could not load for editing')),10000);
      video.onloadedmetadata=()=>{window.clearTimeout(timeout);resolve();};
      video.onerror=()=>{window.clearTimeout(timeout);reject(new Error('Video could not load for editing'));};
      if (video.readyState>=1) { window.clearTimeout(timeout); resolve(); }
    });
    if (start > 0) await new Promise<void>((resolve,reject) => {
      const timeout=window.setTimeout(()=>reject(new Error('Video seek timed out')),10000);
      video.onseeked=()=>{window.clearTimeout(timeout);resolve();}; video.currentTime=start;
    });
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.max(2,Math.round(video.videoWidth*scale/2)*2);
    canvas.height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
    const drawContext=canvas.getContext('2d');
    if (!drawContext || !canvas.captureStream) throw new Error('This device cannot render an edited video.');
    context=new AudioContext();
    const output=context.createMediaStreamDestination();
    const original=context.createMediaElementSource(video);
    original.connect(output);
    if (audio) {
      const soundSource=context.createMediaElementSource(audio);
      const gain=context.createGain(); gain.gain.value=Math.max(0,Math.min(1,soundVolume));
      soundSource.connect(gain).connect(output);
    }
    stream=canvas.captureStream(24);
    for (const track of output.stream.getAudioTracks()) stream.addTrack(track);
    const chunks: Blob[]=[];
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:1_600_000,audioBitsPerSecond:96_000});
    const result=new Promise<Blob>((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size) chunks.push(event.data);};
      recorder.onerror=()=>reject(new Error('Could not record the edited video.'));
      recorder.onstop=()=>resolve(new Blob(chunks,{type:mimeType.split(';')[0]}));
    });
    const stop=()=>{if(recorder.state!=='inactive') recorder.stop();};
    const draw=()=>{
      if(video.readyState>=2) drawContext.drawImage(video,0,0,canvas.width,canvas.height);
      if(video.currentTime>=end-0.025 || video.ended) stop();
      else frame=requestAnimationFrame(draw);
    };
    await context.resume();
    recorder.start(500);
    try {
      await video.play();
      if (audio) await audio.play();
    } catch { stop(); throw new Error('This device could not play the media for editing.'); }
    draw();
    timer=window.setTimeout(stop,Math.ceil((end-start)*1000)+7000);
    const body=await result;
    if (!body.size) throw new Error('Edited video was empty.');
    const contentType=mimeType.split(';')[0];
    return {body,contentType,extension:contentType==='video/mp4'?'mp4':'webm'};
  } finally {
    cancelAnimationFrame(frame); window.clearTimeout(timer);
    video.pause(); audio?.pause(); stream?.getTracks().forEach(track=>track.stop());
    await context?.close().catch(()=>{});
    video.removeAttribute('src'); audio?.removeAttribute('src');
    URL.revokeObjectURL(sourceUrl); if(soundUrl) URL.revokeObjectURL(soundUrl);
  }
}
