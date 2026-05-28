// Supabase Edge Function — Image Duplicate Detection
// Uses Average Hash (aHash) perceptual hashing to compare listing images
// Trigger: Call after uploading listing images

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Compute Average Hash (aHash) for an image
// 1. Resize to 8x8
// 2. Convert to grayscale
// 3. Compute average pixel value
// 4. Each bit = 1 if pixel > average, else 0
// 5. Returns 64-bit hash as hex string
async function computeImageHash(imageData: Uint8Array): Promise<string | null> {
  try {
    const img = await Image.decode(imageData);
    if (!img) return null;

    // Resize to 8x8 and convert to grayscale
    const small = img.resize(8, 8);
    const gray = small.grayscale();

    // Get pixel data
    const pixels: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const pixel = gray.getPixelAt(x, y);
        // ImageScript grayscale returns RGB where R=G=B, use red channel
        const grayValue = (pixel >> 16) & 0xFF;
        pixels.push(grayValue);
      }
    }

    // Compute average
    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;

    // Build hash: each bit = 1 if pixel > average
    let hash = "";
    for (let i = 0; i < 64; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4 && i + j < 64; j++) {
        if (pixels[i + j] > avg) {
          nibble |= 1 << (3 - j);
        }
      }
      hash += nibble.toString(16);
    }

    return hash;
  } catch (e) {
    console.error("[aHash] Error computing hash:", e.message);
    return null;
  }
}

// Compare two hashes using Hamming distance
// Returns similarity score 0.0 to 1.0 (1.0 = identical)
function compareHashes(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 0;

  let diff = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    // XOR to find differing bits
    const xor = n1 ^ n2;
    // Count set bits (Brian Kernighan's algorithm)
    let bits = xor;
    while (bits) {
      diff++;
      bits &= bits - 1;
    }
  }

  // 64 bits total, similarity = 1 - (diff / 64)
  return 1 - diff / 64;
}

// Download image from Supabase Storage
async function downloadImage(supabase: any, bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    console.error("[Download] Error:", error?.message);
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imageUrl, listingId, ownerId } = await req.json();

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client with service role key
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Extract bucket and path from imageUrl
    // Format: https://.../storage/v1/object/public/listings-images/path
    let bucket = "listings-images";
    let path = imageUrl;

    const publicMatch = imageUrl.match(/\/object\/public\/([^/]+)\/(.+)$/);
    if (publicMatch) {
      bucket = publicMatch[1];
      path = publicMatch[2];
    }

    console.log(`[Detect] Processing image: bucket=${bucket}, path=${path}`);

    // Download and hash the new image
    const imageData = await downloadImage(supabase, bucket, path);
    if (!imageData) {
      return new Response(JSON.stringify({ error: "Failed to download image" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newHash = await computeImageHash(imageData);
    if (!newHash) {
      return new Response(JSON.stringify({ error: "Failed to compute image hash" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Detect] New image hash: ${newHash}`);

    // Fetch all existing image hashes (excluding same listing)
    let query = supabase
      .from("listing_image_hashes")
      .select("id, listing_id, image_hash, similarity_score, listings!inner(id, title, city, state, availability_status, owner_id)")
      .neq("image_hash", "");

    if (listingId) {
      query = query.neq("listing_id", listingId);
    }
    if (ownerId) {
      // Also exclude the same owner's listings if checking their own upload
      // query = query.neq("listings.owner_id", ownerId);
    }

    const { data: existingHashes, error: hashError } = await query.limit(500);

    if (hashError) {
      console.error("[Detect] DB error:", hashError.message);
    }

    // Compare against all existing hashes
    const matches: Array<{
      listingId: string;
      title: string;
      city: string;
      state: string;
      similarity: number;
      hash: string;
    }> = [];

    for (const record of existingHashes || []) {
      const similarity = compareHashes(newHash, record.image_hash);
      if (similarity > 0.6) {
        // 60%+ similar = potential duplicate
        matches.push({
          listingId: record.listing_id,
          title: record.listings?.title || "Unknown",
          city: record.listings?.city || "",
          state: record.listings?.state || "",
          similarity: Math.round(similarity * 100) / 100,
          hash: record.image_hash,
        });
      }
    }

    // Sort by similarity (highest first)
    matches.sort((a, b) => b.similarity - a.similarity);

    // Store the new hash in the database
    if (listingId) {
      await supabase.from("listing_image_hashes").insert({
        listing_id: listingId,
        image_url: imageUrl,
        image_hash: newHash,
        similarity_score: matches.length > 0 ? matches[0].similarity : 0,
      });
    }

    const isDuplicate = matches.length > 0 && matches[0].similarity >= 0.8;
    const isSuspicious = matches.length > 0 && matches[0].similarity >= 0.6;

    console.log(`[Detect] Found ${matches.length} similar images. Top match: ${matches[0]?.similarity || 0}`);

    return new Response(
      JSON.stringify({
        hash: newHash,
        isDuplicate,
        isSuspicious,
        similarity: matches[0]?.similarity || 0,
        matches: matches.slice(0, 5), // Return top 5 matches
        message: isDuplicate
          ? "This image appears to be a duplicate of an existing listing"
          : isSuspicious
          ? "This image is similar to an existing listing — please review"
          : "No duplicate images found",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[Detect] Unhandled error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
