import { createClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';

// ─── SUPABASE CONFIG ───────────────────────────────
// Browser publishable keys are intentionally public. Real authorization lives in
// RLS/RPC boundaries. What must never happen is a Preview/localhost/native test
// build silently talking to the production database.
const PRODUCTION_SUPABASE_URL = 'https://rkrhnkhppeihvmuwvsvn.supabase.co';
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PhMsGwc_jy21ICg11jQsVg_uwT2dhKQ';
const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const configuredKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '',
).trim();
const runtimeHost = typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase();
const officialProductionHost = runtimeHost === 'wehouse.com.ng' || runtimeHost === 'www.wehouse.com.ng';

if ((!configuredUrl || !configuredKey) && !officialProductionHost) {
  throw new Error(
    'WeHouse preview configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for this environment.',
  );
}

const SUPABASE_URL = configuredUrl || PRODUCTION_SUPABASE_URL;
const SUPABASE_ANON_KEY = configuredKey || PRODUCTION_SUPABASE_PUBLISHABLE_KEY;

if (!officialProductionHost && SUPABASE_URL.replace(/\/$/, '') === PRODUCTION_SUPABASE_URL) {
  throw new Error(
    'Safety stop: a non-production WeHouse host cannot connect to the production Supabase project.',
  );
}

const SUPABASE_STORAGE_URL = SUPABASE_URL.replace(
  /\.supabase\.co\/?$/,
  '.storage.supabase.co',
);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export async function uploadStorageObjectWithProgress(
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
  onProgress: (percent: number) => void,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw error || new Error('Your session expired. Sign in and try the upload again.');
  }

  const storageContentType = (contentType || 'application/octet-stream').split(';', 1)[0].trim();
  if (body.size > 6 * 1024 * 1024) {
    await uploadResumableStorageObject(
      bucket,
      path,
      body,
      storageContentType,
      data.session.access_token,
      onProgress,
    );
    return;
  }

  const safePath = path.split('/').map(encodeURIComponent).join('/');
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let stallTimer = window.setTimeout(() => xhr.abort(), 60000);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      callback();
    };
    const resetStallTimer = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => xhr.abort(), 60000);
    };

    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${safePath}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('authorization', `Bearer ${data.session.access_token}`);
    // Storage accepts the media type, while MediaRecorder may append codec
    // parameters (for example video/webm;codecs=vp9,opus).
    xhr.setRequestHeader('content-type', storageContentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', '86400');
    xhr.upload.onprogress = (event) => {
      resetStallTimer();
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100))));
      }
    };
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = 'The media could not be uploaded.';
      try {
        const payload = JSON.parse(xhr.responseText || '{}');
        message = payload.message || payload.error || message;
      } catch {}
      reject(new Error(message));
    });
    xhr.onerror = () => finish(() => reject(new Error('Upload connection failed. Check your network and try again.')));
    xhr.onabort = () => finish(() => reject(new Error('Upload stopped because no progress was received for 60 seconds. Try again on a stable connection.')));
    xhr.send(body);
  });
}

async function uploadResumableStorageObject(
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
  accessToken: string,
  onProgress: (percent: number) => void,
) {
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(body, {
      endpoint: `${SUPABASE_STORAGE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType,
        cacheControl: '86400',
      },
      onProgress: (uploaded, total) => {
        if (total > 0)
          onProgress(Math.min(99, Math.max(1, Math.round((uploaded / total) * 100))));
      },
      onError: (uploadError) =>
        reject(new Error(uploadError.message || 'Resumable upload failed. Check your connection and try again.')),
      onSuccess: () => {
        onProgress(100);
        resolve();
      },
    });
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}

// ─── DIAGNOSTICS ───────────────────────────────────

export interface DiagnosticsResult {
  supabaseUrl: string;
  keyPresent: boolean;
  keyLength: number;
  authTest: 'ok' | 'error' | 'network_error';
  authError?: string;
  timestamp: string;
}

export async function runDiagnostics(): Promise<DiagnosticsResult> {
  let authTest: DiagnosticsResult['authTest'] = 'ok';
  let authError: string | undefined;

  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      authTest = 'error';
      authError = error.message;
    }
  } catch (e: any) {
    authTest = 'network_error';
    authError = e?.message || String(e);
  }

  return {
    supabaseUrl: SUPABASE_URL,
    keyPresent: SUPABASE_ANON_KEY.length > 0,
    keyLength: SUPABASE_ANON_KEY.length,
    authTest,
    authError,
    timestamp: new Date().toISOString(),
  };
}
