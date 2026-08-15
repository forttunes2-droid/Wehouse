// No external imports needed for utils

// ─── SHARED IMAGE COMPRESSION ──────────────────────
// Keep property photography sharp while avoiding raw 8–20MB phone uploads.
// The compressor prefers reducing JPEG weight before reducing dimensions.

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
  });
}

export function compressImageFile(
  file: File,
  maxDim: number = 2560,
  quality: number = 0.86,
  maxBytes: number = 2.5 * 1024 * 1024,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (!width || !height) throw new Error('Image dimensions are unavailable');

        const initialScale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.max(1, Math.round(width * initialScale));
        height = Math.max(1, Math.round(height * initialScale));

        let currentQuality = Math.min(0.94, Math.max(0.72, quality));
        let result: Blob | null = null;

        // At most four dimension passes. Most normal phone images finish on pass 1.
        for (let pass = 0; pass < 4; pass += 1) {
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
          while (result.size > maxBytes && q > 0.72) {
            q = Math.max(0.72, q - 0.04);
            result = await canvasBlob(canvas, q);
          }

          if (result.size <= maxBytes || Math.max(width, height) <= 1920) break;
          width = Math.max(1, Math.round(width * 0.86));
          height = Math.max(1, Math.round(height * 0.86));
          currentQuality = Math.max(0.78, q);
        }

        if (!result) throw new Error('Compression failed');
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
