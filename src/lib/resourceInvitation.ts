export type InvitationPreview = {
  valid?: boolean;
  invitation_id: string;
  resource_type: "property" | "hotel";
  resource_title: string;
  resource_image?: string | null;
  role_key: "property_cohost" | "hotel_manager" | "hotel_front_desk";
  permission_profile: string;
  status?: string;
  expires_at: string;
  inviter_name: string;
};

const KEY = "wh_resource_invitation_v1";
const PREFIX = "https://wehouse.com.ng/#invite/";

export function invitationShareUrl(token: string) {
  const value = token.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid invitation token");
  return PREFIX + value;
}

export function parseInvitationToken(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" || !["wehouse.com.ng", "www.wehouse.com.ng"].includes(url.hostname)) return null;
    const match = /^#invite\/([a-f0-9]{64})$/i.exec(url.hash);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function saveInvitationIntent(token: string | null, store: Storage) {
  if (!token) { store.removeItem(KEY); return; }
  const value = token.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) return;
  store.setItem(KEY, JSON.stringify({ token: value, expires: Date.now() + 7 * 86_400_000 }));
}

export function readInvitationIntent(urlValue: string, store: Storage): string | null {
  const fromUrl = parseInvitationToken(urlValue);
  if (fromUrl) {
    saveInvitationIntent(fromUrl, store);
    return fromUrl;
  }
  try {
    const parsed = JSON.parse(store.getItem(KEY) || "{}") as { token?: string; expires?: number };
    if (!parsed.token || !parsed.expires || parsed.expires <= Date.now() || !/^[a-f0-9]{64}$/.test(parsed.token)) {
      store.removeItem(KEY);
      return null;
    }
    return parsed.token;
  } catch {
    store.removeItem(KEY);
    return null;
  }
}

export function clearInvitationIntent(store: Storage) {
  store.removeItem(KEY);
}
