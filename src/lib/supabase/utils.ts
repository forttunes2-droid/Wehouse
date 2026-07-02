// No external imports needed for utils

// ─── SHARED IMAGE COMPRESSION ──────────────────────
// Compresses images before upload for fast upload on Nigerian mobile networks

export function compressImageFile(f: File, maxDim: number = 1200, quality: number = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxDim) { h = Math.round((h / w) * maxDim); w = maxDim; }
      else if (h > maxDim) { w = Math.round((w / h) * maxDim); h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Compression failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}
