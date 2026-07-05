import { useState, useEffect } from 'react';
import { getCategoryWithSubcategories, supabase } from '@/lib/supabase';
import type { ServiceCategory, Profile } from '@/types';
import { Toaster } from 'sonner';

interface WorkerCategoriesProps {
  onNavigate?: (page: string, category?: string) => void;
  onGoToChat?: (convId: string) => void;
  profile?: { user_id: string } | null;
}

interface CategoryWithCount extends ServiceCategory {
  workerCount: number;
  subcategories: any[];
}

export default function WorkerCategories({ onNavigate }: WorkerCategoriesProps) {
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalWorkers, setTotalWorkers] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Fetch categories with subcategories
      const { categories: cats } = await getCategoryWithSubcategories();

      // Fetch all workers to count per category
      const { data: workers } = await supabase
        .from('profiles')
        .select('user_id, worker_occupation, worker_bio')
        .eq('role', 'worker')
        .eq('worker_status', 'approved_for_verification');

      const workerList = (workers || []) as Profile[];
      setTotalWorkers(workerList.length);

      // Count workers per category
      // Workers are matched to categories via their verification's service_category_id
      // But since we don't have that easily, we'll use a keyword matching approach
      const enriched = (cats || []).map((cat: ServiceCategory) => {
        const keywords = getCategoryKeywords(cat.name);
        const count = workerList.filter((w: Profile) => {
          const occ = (w.worker_occupation || '').toLowerCase();
          const bio = (w.worker_bio || '').toLowerCase();
          return keywords.some(k => occ.includes(k) || bio.includes(k));
        }).length;

        return {
          ...cat,
          workerCount: count,
          subcategories: (cat as any).subcategories || [],
        };
      });

      // Sort by worker count (highest first), then by sort_order
      enriched.sort((a, b) => b.workerCount - a.workerCount || a.sort_order - b.sort_order);

      setCategories(enriched);
      setLoading(false);
    }

    load();
  }, []);

  function handleCategoryClick(category: CategoryWithCount) {
    // Navigate to worker discovery with this category pre-selected
    if (onNavigate) {
      onNavigate('worker_discovery', category.name);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent pb-20">
        <div className="max-w-lg mx-auto px-5 py-6">
          {/* Skeleton */}
          <div className="h-8 bg-[#1A1A24] rounded-xl w-2/3 mb-2 animate-pulse" />
          <div className="h-4 bg-[#1A1A24] rounded-lg w-1/2 mb-6 animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-28 bg-[#1A1A24] rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => onNavigate?.('home')}
              className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-lg font-bold text-white">Find Workers</h1>
          </div>
          <p className="text-xs text-[#5C5E72]">
            {totalWorkers} verified worker{totalWorkers !== 1 ? 's' : ''} across {categories.length} categories
          </p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Search shortcut */}
        <button
          onClick={() => onNavigate?.('worker_discovery')}
          className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] flex items-center gap-3 px-4 text-[#5C5E72] hover:border-[#3B82F6]/30 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <span className="text-sm">Search by name, skill, location...</span>
        </button>

        {/* Categories Grid */}
        <div>
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-3">Browse by Category</p>
          <div className="grid grid-cols-2 gap-3">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat)}
                className="rounded-2xl bg-[#12121A] border border-[#1E1E2C] p-4 text-left hover:border-[#3B82F6]/30 hover:bg-[#1A1A24] transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl group-hover:scale-110 transition-transform">{cat.icon}</span>
                  {cat.workerCount > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] font-medium">
                      {cat.workerCount}
                    </span>
                  )}
                </div>
                <p className="text-xs font-semibold text-white">{cat.name}</p>
                {cat.subcategories.length > 0 && (
                  <p className="text-[9px] text-[#5C5E72] mt-1 line-clamp-2">
                    {cat.subcategories.slice(0, 3).map((s: any) => s.name).join(', ')}
                    {cat.subcategories.length > 3 && ` +${cat.subcategories.length - 3} more`}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* All workers shortcut */}
        <button
          onClick={() => onNavigate?.('worker_discovery')}
          className="w-full rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 p-4 flex items-center justify-between hover:bg-[#3B82F6]/15 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-white">View All Workers</p>
              <p className="text-[10px] text-[#5C5E72]">See every worker with filters</p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
    </div>
  );
}

// Keywords to match workers to categories based on their occupation/bio
function getCategoryKeywords(categoryName: string): string[] {
  const map: Record<string, string[]> = {
    'Home Services': ['electrician', 'plumber', 'carpenter', 'painter', 'welder', 'pop', 'tiler', 'roofer', 'handyman'],
    'Cleaning': ['cleaner', 'cleaning', 'laundry', 'deep clean'],
    'Beauty': ['barber', 'hair', 'makeup', 'nail', 'spa', 'tattoo', 'stylist'],
    'Events': ['event', 'cater', 'dj', 'photographer', 'videographer', 'mc', 'decorator', 'bouncer'],
    'Moving & Delivery': ['mover', 'moving', 'courier', 'dispatch', 'truck', 'delivery'],
    'Auto Services': ['mechanic', 'car wash', 'panel', 'auto', 'tire', 'detailing'],
    'Technology': ['phone repair', 'laptop', 'cctv', 'developer', 'programmer', 'graphic', 'designer', 'network', 'tech'],
    'Gardening': ['garden', 'landscape', 'tree', 'irrigation'],
    'Security': ['security', 'bouncer', 'bodyguard', 'cctv'],
    'Health & Care': ['nurse', 'caregiver', 'physio', 'midwife', 'health'],
    'Education': ['tutor', 'teacher', 'instructor', 'coach'],
    'Tailoring & Fashion': ['tailor', 'fashion', 'designer', 'shoe', 'cap'],
    'Agriculture': ['farm', 'poultry', 'fish', 'crop', 'agric'],
    'Other Services': ['errand', 'assistant', 'translator', 'legal'],
  };
  return map[categoryName] || [categoryName.toLowerCase()];
}
