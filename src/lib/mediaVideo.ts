/** Public and private videos are prepared in the browser before they reach Storage. */
const MIB = 1024 * 1024;
export const PUBLIC_VIDEO_MAX_BYTES = 13 * MIB;
export const CHAT_VIDEO_MAX_BYTES = 25 * MIB;
export const VIDEO_TARGET_PER_15_SECONDS_BYTES = 2 * MIB;
const MAX_REENCODE_SECONDS = 90;

export type PreparedVideo = {
  body: Blob;
  contentType: string;
  extension: "mp4" | "webm" | "mov";
};

export function videoTargetBytes(
  seconds: number,
  maximumBytes = PUBLIC_VIDEO_MAX_BYTES,
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return VIDEO_TARGET_PER_15_SECONDS_BYTES;
  return Math.min(
    maximumBytes,
    Math.max(
      VIDEO_TARGET_PER_15_SECONDS_BYTES,
      Math.round((seconds / 15) * VIDEO_TARGET_PER_15_SECONDS_BYTES),
    ),
  );
}

const supportedRecorderType = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type)) || null;
};

type VideoLimits = {
  maxInputBytes: number;
  maxOutputBytes: number;
  outputLabel: string;
};

async function prepareVideo(file: File, limits: VideoLimits): Promise<PreparedVideo> {
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type))
    throw new Error("Choose an MP4, MOV or WebM video");
  if (file.size > limits.maxInputBytes)
    throw new Error(`Choose a video under ${limits.outputLabel} before compression`);
  const original: PreparedVideo = {
    body: file,
    contentType: file.type,
    extension: file.type === "video/quicktime" ? "mov" : file.type === "video/webm" ? "webm" : "mp4",
  };
  if (file.size <= VIDEO_TARGET_PER_15_SECONDS_BYTES) return original;

  const video = document.createElement("video");
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream })
    .captureStream?.bind(video);
  const url = URL.createObjectURL(file);
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  let captured: MediaStream | null = null;
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("This video could not be opened"));
        video.src = url;
      });
    } catch (error) {
      if (file.size <= limits.maxOutputBytes) return original;
      throw error;
    }
    const seconds = video.duration;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_REENCODE_SECONDS)
      throw new Error(`Trim this video to 90 seconds or export it below ${limits.outputLabel} before uploading.`);

    const targetBytes = videoTargetBytes(seconds, limits.maxOutputBytes);
    if (file.size <= targetBytes) return original;

    const mimeType = supportedRecorderType();
    if (!mimeType || !capture) {
      if (file.size <= limits.maxOutputBytes) return original;
      throw new Error(`This device cannot compress this video. Trim or export it below ${limits.outputLabel} and try again.`);
    }

    const audioRate = 96_000;
    const videoRate = Math.max(
      250_000,
      Math.min(2_200_000, Math.floor((targetBytes * 8) / seconds) - audioRate),
    );
    // Chromium may not create capture tracks until playback starts.
    try {
      await video.play();
    } catch {
      if (file.size <= limits.maxOutputBytes) return original;
      throw new Error(`This device could not play the video for compression. Export it below ${limits.outputLabel} and try again.`);
    }
    const stream = capture();
    captured = stream;
    if (!stream.getVideoTracks().length) {
      if (file.size <= limits.maxOutputBytes) return original;
      throw new Error(`This device cannot capture this video. Export it below ${limits.outputLabel} and try again.`);
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: videoRate,
      audioBitsPerSecond: audioRate,
    });
    const body = await new Promise<Blob>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        recorder.stop();
        reject(new Error("Video compression timed out. Trim it and try again."));
      }, Math.ceil(seconds * 1000) + 15_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.onended = null;
        video.onerror = null;
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        cleanup();
        reject(new Error(`Video compression failed. Trim or export it below ${limits.outputLabel}.`));
      };
      recorder.onstop = () => {
        cleanup();
        resolve(new Blob(chunks, { type: mimeType.split(";")[0] }));
      };
      video.onerror = () => {
        cleanup();
        recorder.stop();
        reject(new Error("Video playback failed during compression."));
      };
      video.onended = () => {
        if (recorder.state !== "inactive") recorder.stop();
      };
      recorder.start(1000);
    });

    if (!body.size || body.size > limits.maxOutputBytes)
      throw new Error(`This video remains over ${limits.outputLabel}. Trim it or export a smaller version before uploading.`);
    const contentType = mimeType.split(";")[0];
    return { body, contentType, extension: contentType === "video/mp4" ? "mp4" : "webm" };
  } finally {
    video.pause();
    captured?.getTracks().forEach((track) => track.stop());
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function preparePublicVideo(file: File): Promise<PreparedVideo> {
  return prepareVideo(file, {
    maxInputBytes: 50 * MIB,
    maxOutputBytes: PUBLIC_VIDEO_MAX_BYTES,
    outputLabel: "13 MB",
  });
}

/** Private message media is compressed before encryption, then uploaded to Storage. */
export function prepareChatVideo(file: File): Promise<PreparedVideo> {
  return prepareVideo(file, {
    maxInputBytes: CHAT_VIDEO_MAX_BYTES,
    maxOutputBytes: CHAT_VIDEO_MAX_BYTES,
    outputLabel: "25 MB",
  });
}
