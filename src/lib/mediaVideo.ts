/** Public videos live in Storage. Keep new objects bounded before upload. */
export const PUBLIC_VIDEO_MAX_BYTES = 13 * 1024 * 1024;
const PUBLIC_VIDEO_TARGET_BYTES = 11 * 1024 * 1024;
const MAX_REENCODE_SECONDS = 90;

export type PreparedVideo = { body: Blob; contentType: string; extension: "mp4" | "webm" | "mov" };

const supportedRecorderType = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find(type => MediaRecorder.isTypeSupported(type)) || null;
};

export async function preparePublicVideo(file: File): Promise<PreparedVideo> {
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type))
    throw new Error("Choose an MP4, MOV or WebM video");
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Choose a video under 50 MB before compression");
  if (file.size <= PUBLIC_VIDEO_MAX_BYTES) {
    return { body: file, contentType: file.type, extension: file.type === "video/quicktime" ? "mov" : file.type === "video/webm" ? "webm" : "mp4" };
  }

  const mimeType = supportedRecorderType();
  const video = document.createElement("video");
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.bind(video);
  if (!mimeType || !capture)
    throw new Error("This device cannot compress this video. Trim or export it below 13 MB and try again.");
  const url = URL.createObjectURL(file);
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  let captured: MediaStream | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This video could not be opened"));
      video.src = url;
    });
    const seconds = video.duration;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_REENCODE_SECONDS)
      throw new Error("Trim this video to 90 seconds or export it below 13 MB before uploading.");

    const audioRate = 96_000;
    const videoRate = Math.max(350_000, Math.min(2_200_000, Math.floor(PUBLIC_VIDEO_TARGET_BYTES * 8 / seconds) - audioRate));
    // Media streams can have no tracks until playback starts (notably on
    // Chromium). Start playback first, then attach the recorder.
    try {
      await video.play();
    } catch {
      throw new Error("This device could not play the video for compression. Export it below 13 MB and try again.");
    }
    const stream = capture();
    captured = stream;
    if (!stream.getVideoTracks().length)
      throw new Error("This device cannot capture this video. Export it below 13 MB and try again.");
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoRate, audioBitsPerSecond: audioRate });
    const body = await new Promise<Blob>((resolve, reject) => {
      const timeout = window.setTimeout(() => { recorder.stop(); reject(new Error("Video compression timed out. Trim it and try again.")); }, Math.ceil(seconds * 1000) + 15_000);
      const cleanup = () => { window.clearTimeout(timeout); video.onended = null; video.onerror = null; };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { cleanup(); reject(new Error("Video compression failed. Trim or export it below 13 MB.")); };
      recorder.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: mimeType.split(";")[0] })); };
      video.onerror = () => { cleanup(); recorder.stop(); reject(new Error("Video playback failed during compression.")); };
      video.onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
      recorder.start(1000);
    });
    if (!body.size || body.size > PUBLIC_VIDEO_MAX_BYTES)
      throw new Error("This video remains over 13 MB. Trim it or export a smaller version before uploading.");
    const contentType = mimeType.split(";")[0];
    return { body, contentType, extension: contentType === "video/mp4" ? "mp4" : "webm" };
  } finally {
    video.pause();
    captured?.getTracks().forEach(track => track.stop());
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
