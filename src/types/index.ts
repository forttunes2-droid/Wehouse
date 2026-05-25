export interface Profile {
  id: string;
  auth_id: string;
  email: string;
  username: string | null;
  role: 'user' | 'creator_admin';
  user_id: string;
  profile_complete: boolean;
  created_at: string;
  updated_at: string;
}

export type Page = 'loading' | 'login' | 'setup' | 'dashboard' | 'creator';
