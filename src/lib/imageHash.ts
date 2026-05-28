// Client-side image duplicate detection
// Runs entirely in the browser — no Edge Function needed
// Uses Canvas-based Average Hash (aHash) algorithm

/**
 * Compute perceptual hash of an image using Canvas
 * 1. Draw image to 8x8 canvas
 * 2. Convert to grayscale
 * 3. Compare each pixel to average brightness
 * 4. Return 16-char hex hash
 */
export async function computeImageHash(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }

        // Draw image at 8x8
        ctx.drawImage(img, 0, 0, 8, 8);
        const imageData = ctx.getImageData(0, 0, 8, 8);
        const pixels = imageData.data;

        // Convert to grayscale and get values
        const gray: number[] = [];
        for (let i = 0; i < pixels.length; i += 4) {
          // Luminance formula: 0.299*R + 0.587*G + 0.114*B
          const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          gray.push(luminance);
        }

        // Compute average brightness
        const avg = gray.reduce((a, b) => a + b, 0) / gray.length;

        // Build hash: each nibble = 4 bits, 1 if pixel > average
        let hash = '';
        for (let i = 0; i < 64; i += 4) {
          let nibble = 0;
          for (let j = 0; j < 4 && i + j < 64; j++) {
            if (gray[i + j] > avg) {
              nibble |= 1 << (3 - j);
            }
          }
          hash += nibble.toString(16);
        }

        resolve(hash);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/**
 * Compare two image hashes using Hamming distance
 * Returns similarity score from 0.0 to 1.0 (1.0 = identical)
 */
export function compareImageHashes(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length || hash1.length === 0) return 0;

  let diff = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    const xor = n1 ^ n2;
    // Count set bits
    let bits = xor;
    while (bits) {
      diff++;
      bits &= bits - 1;
    }
  }

  // 64 bits total (16 hex chars x 4 bits)
  return 1 - diff / 64;
}

/**
 * Check if an image is a duplicate of existing listing images
 * Returns: { isDuplicate, isSuspicious, similarity, matches }
 */
export async function checkImageDuplicate(
  imageUrl: string,
  existingHashes: Array<{ image_hash: string; listing_id: string }>
): Promise<{
  isDuplicate: boolean;
  isSuspicious: boolean;
  similarity: number;
  matches: Array<{ listingId: string; similarity: number }>;
}> {
  const newHash = await computeImageHash(imageUrl);
  if (!newHash) {
    return { isDuplicate: false, isSuspicious: false, similarity: 0, matches: [] };
  }

  const matches: Array<{ listingId: string; similarity: number }> = [];

  for (const record of existingHashes) {
    if (!record.image_hash) continue;
    const similarity = compareImageHashes(newHash, record.image_hash);
    if (similarity > 0.6) {
      matches.push({ listingId: record.listing_id, similarity: Math.round(similarity * 100) / 100 });
    }
  }

  // Sort by similarity (highest first)
  matches.sort((a, b) => b.similarity - a.similarity);

  const top = matches[0];
  return {
    isDuplicate: top?.similarity >= 0.8,
    isSuspicious: top?.similarity >= 0.6,
    similarity: top?.similarity || 0,
    matches: matches.slice(0, 5),
  };
}

/**
 * Get all existing image hashes from Supabase for comparison
 */
export async function getAllImageHashes(supabaseClient: any) {
  const { data, error } = await supabaseClient
    .from('listing_image_hashes')
    .select('listing_id, image_hash');

  if (error) {
    console.error('Error fetching image hashes:', error);
    return [];
  }

  return data || [];
}

/**
 * Save an image hash to the database after listing is created
 */
export async function saveImageHash(
  supabaseClient: any,
  listingId: string,
  imageUrl: string,
  imageHash: string
) {
  const { error } = await supabaseClient
    .from('listing_image_hashes')
    .insert({
      listing_id: listingId,
      image_url: imageUrl,
      image_hash: imageHash,
    });

  if (error) {
    console.error('Error saving image hash:', error);
  }
  return { error };
}
