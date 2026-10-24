import type { DeviceRegistration } from '@/lib/supabase/session';
const key='wh_pending_device';
export function savePendingDevice(device:DeviceRegistration) {
  try { sessionStorage.setItem(key,JSON.stringify({device,at:Date.now()})); } catch { /* server still controls trust */ }
}
export function clearPendingDevice() { try { sessionStorage.removeItem(key); } catch { /* unavailable storage */ } }
export function readPendingDevice():DeviceRegistration|null {
  try {
    const {device,at}=JSON.parse(sessionStorage.getItem(key)||'null')||{};
    if(typeof at!=='number'||at>Date.now()||Date.now()-at>30*60*1000||typeof device?.sessionId!=='string'
      ||device.trustStatus!=='pending'||!['device','os','browser','location'].every(field=>typeof device[field]==='string')) {
      clearPendingDevice();return null;
    }
    return device;
  } catch { clearPendingDevice();return null; }
}
