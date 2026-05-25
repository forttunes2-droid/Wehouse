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

export interface Listing {
  id: string;
  listing_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  state: string | null;
  city: string | null;
  address: string | null;
  images: string[];
  bedrooms: number;
  bathrooms: number;
  availability_status: 'available' | 'reserved' | 'occupied' | 'hidden';
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedListing {
  id: string;
  user_id: string;
  listing_id: string;
  created_at: string;
}
