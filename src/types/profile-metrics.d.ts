import '@/types';

declare module '@/types' {
  interface Profile {
    rating?: number | null;
    review_count?: number | null;
  }
}
