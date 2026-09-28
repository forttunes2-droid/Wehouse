// No external imports needed for utils

// ─── SHARED IMAGE COMPRESSION ──────────────────────
// Keep uploads sharp while avoiding raw multi-megabyte phone images.
// Callers own the requested dimensions; this helper must never silently enlarge
// a profile or hotel preset into a 4K listing image.

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
  });
}

export function compressImageFile(
  file: File,
  requestedMaxDim: number = 2560,
  requestedQuality: number = 0.86,
  maxBytes: number = 2_000_000,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    const maxDim = requestedMaxDim;
    const preferredQuality = requestedQuality;

    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (!width || !height) throw new Error('Image dimensions are unavailable');

        const initialScale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.max(1, Math.round(width * initialScale));
        height = Math.max(1, Math.round(height * initialScale));

        let currentQuality = Math.min(0.94, Math.max(0.72, preferredQuality));
        let result: Blob | null = null;

        // Enforce the output budget even for noisy, high-resolution photos.
        for (let pass = 0; pass < 8; pass += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw new Error('No canvas context');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          let q = currentQuality;
          result = await canvasBlob(canvas, q);
          while (result.size > maxBytes && q > 0.62) {
            q = Math.max(0.62, q - 0.04);
            result = await canvasBlob(canvas, q);
          }

          if (result.size <= maxBytes) break;
          width = Math.max(1, Math.round(width * 0.78));
          height = Math.max(1, Math.round(height * 0.78));
          currentQuality = q;
        }

        if (!result || result.size > maxBytes) throw new Error('This photo could not fit the upload limit. Choose a smaller photo.');
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

export async function prepareChatImageFile(file: File): Promise<{
  body: Blob | File;
  contentType: string;
  extension: string;
}> {
  const targetBytes = 2_000_000;
  const preservableTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  // Keep animation intact. Other chat photos are JPEG-compressed before upload
  // once they exceed the small-message-media budget.
  if (file.type === "image/gif" && file.size > targetBytes)
    throw new Error("This animated image is over 2 MB. Choose a shorter animation or a still photo.");
  if (file.type === "image/gif" || (preservableTypes.has(file.type) && file.size <= targetBytes)) {
    return {
      body: file,
      contentType: file.type,
      extension:
        file.type === "image/gif"
          ? "gif"
          : file.type === "image/jpeg"
            ? "jpg"
          : file.type === "image/png"
            ? "png"
            : "webp",
    };
  }
  return {
    body: await compressImageFile(file, 1920, 0.85, targetBytes),
    contentType: "image/jpeg",
    extension: "jpg",
  };
}
