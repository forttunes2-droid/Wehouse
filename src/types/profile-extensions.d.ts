import '@/types';

declare module '@/types' {
  interface Profile {
    privacy_email_visible: boolean;
    privacy_phone_visible: boolean;
    pref_email_notif: boolean;
    pref_push_notif: boolean;
  }
}

export {};
