import { createClient } from '@supabase/supabase-js';

// ─── SUPABASE CONFIG ───────────────────────────────
// These are PUBLIC client credentials — safe in browser bundles.
// Real security = Row Level Security (RLS) policies, not key secrecy.
const SUPABASE_URL = 'https://rkrhnkhppeihvmuwvsvn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcmhua2hwcGVpaHZtdXd2c3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjY0MjEsImV4cCI6MjA5NTA0MjQyMX0.y78mFMsrN81WOg4-YXHVnq6mNYUw5I-IowQWXnjeXyw';

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
    xhr.setRequestHeader('content-type', contentType || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', '3600');
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
