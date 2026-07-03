import { useState, useEffect, useCallback } from 'react';
import {
  getCategoryWithSubcategories,
  createServiceCategory,
  updateServiceCategory,
  createServiceSubcategory,
  updateServiceSubcategory,
  deleteServiceCategory,
  deleteServiceSubcategory,
  seedSubcategoriesForCategory,
} from '@/lib/supabase';
import type { ServiceCategory, ServiceSubcategory } from '@/types';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type CategoryWithSubs = ServiceCategory & { subcategories: ServiceSubcategory[] };

export default function ServiceCategoriesTab() {
  const [categories, setCategories] = useState<CategoryWithSubs[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Add category modal
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('');

  // Add subcategory modal
  const [showAddSub, setShowAddSub] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');

  // Edit category
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');

  // Edit subcategory
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState('');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    const { categories: data, error } = await getCategoryWithSubcategories();
    if (error) {
      toast.error('Failed to load categories');
    } else {
      setCategories(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  async function handleAddCategory() {
    if (!newCategoryName.trim()) {
      toast.error('Category name is required');
      return;
    }
    const { category, error } = await createServiceCategory(
      newCategoryName.trim(),
      newCategoryIcon.trim(),
      categories.length + 1
    );
    if (error) {
      toast.error('Failed to create category');
      return;
    }
    // Seed default subcategories if any match
    const { error: seedErr } = await seedSubcategoriesForCategory(category!.id, category!.name);
    if (seedErr) {
      console.log('No default subcategories to seed');
    }
    toast.success(`Category "${newCategoryName}" created`);
    setNewCategoryName('');
    setNewCategoryIcon('');
    setShowAddCategory(false);
    loadCategories();
  }

  async function handleToggleCategory(id: string, currentActive: boolean) {
    const { error } = await updateServiceCategory(id, { is_active: !currentActive });
    if (error) {
      toast.error('Failed to update category');
      return;
    }
    toast.success(currentActive ? 'Category hidden' : 'Category activated');
    loadCategories();
  }

  async function handleAddSubcategory() {
    if (!newSubName.trim() || !activeCategoryId) {
      toast.error('Subcategory name is required');
      return;
    }
    const cat = categories.find(c => c.id === activeCategoryId);
    const sortOrder = (cat?.subcategories.length || 0) + 1;
    const { error } = await createServiceSubcategory(activeCategoryId, newSubName.trim(), '', sortOrder);
    if (error) {
      toast.error('Failed to create subcategory');
      return;
    }
    toast.success(`Subcategory "${newSubName}" added`);
    setNewSubName('');
    setShowAddSub(false);
    setActiveCategoryId(null);
    loadCategories();
  }

  async function handleToggleSubcategory(id: string, currentActive: boolean) {
    const { error } = await updateServiceSubcategory(id, { is_active: !currentActive });
    if (error) {
      toast.error('Failed to update subcategory');
      return;
    }
    toast.success(currentActive ? 'Subcategory hidden' : 'Subcategory activated');
    loadCategories();
  }

  async function handleEditCategory(id: string) {
    if (!editCategoryName.trim()) {
      toast.error('Name is required');
      return;
    }
    const { error } = await updateServiceCategory(id, { name: editCategoryName.trim() });
    if (error) {
      toast.error('Failed to update');
      return;
    }
    toast.success('Category updated');
    setEditingCategory(null);
    setEditCategoryName('');
    loadCategories();
  }

  async function handleEditSubcategory(id: string) {
    if (!editSubName.trim()) {
      toast.error('Name is required');
      return;
    }
    const { error } = await updateServiceSubcategory(id, { name: editSubName.trim() });
    if (error) {
      toast.error('Failed to update');
      return;
    }
    toast.success('Subcategory updated');
    setEditingSub(null);
    setEditSubName('');
    loadCategories();
  }

  async function handleDeleteCategory(id: string, name: string) {
    if (!confirm(`Delete category "${name}" and all its subcategories? This cannot be undone.`)) return;
    const { error } = await deleteServiceCategory(id);
    if (error) {
      toast.error('Failed to delete category');
      console.error('[DeleteCategory]', error);
      return;
    }
    toast.success(`Category "${name}" deleted`);
    loadCategories();
  }

  async function handleDeleteSubcategory(id: string, name: string) {
    if (!confirm(`Delete subcategory "${name}"? This cannot be undone.`)) return;
    const { error } = await deleteServiceSubcategory(id);
    if (error) {
      toast.error('Failed to delete subcategory');
      console.error('[DeleteSubcategory]', error);
      return;
    }
    toast.success(`Subcategory "${name}" deleted`);
    loadCategories();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Service Categories</h2>
          <p className="text-[10px] text-[#5C5E72]">Organize worker services. Add categories and subcategories.</p>
        </div>
        <button
          onClick={() => setShowAddCategory(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B82F6]/20 text-[#3B82F6] text-[11px] font-medium hover:bg-[#3B82F6]/30 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Add Category
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
          <p className="text-lg font-bold text-white">{categories.length}</p>
          <p className="text-[10px] text-[#5C5E72]">Categories</p>
        </div>
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
          <p className="text-lg font-bold text-white">{categories.reduce((sum, c) => sum + c.subcategories.length, 0)}</p>
          <p className="text-[10px] text-[#5C5E72]">Subcategories</p>
        </div>
        <div className="bg-[#12121A] border border-[#1E1E2C] rounded-xl p-3">
          <p className="text-lg font-bold text-emerald-400">{categories.filter(c => c.is_active).length}</p>
          <p className="text-[10px] text-[#5C5E72]">Active</p>
        </div>
      </div>

      {/* Categories List */}
      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.id} className={`bg-[#12121A] border rounded-xl overflow-hidden ${cat.is_active ? 'border-[#1E1E2C]' : 'border-[#1E1E2C]/50 opacity-60'}`}>
            {/* Category Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
            >
              <span className="text-lg">{cat.icon || '🔧'}</span>
              {editingCategory === cat.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <Input
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    className="h-7 text-xs bg-[#0A0A0F] border-[#1E1E2C]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditCategory(cat.id);
                      if (e.key === 'Escape') { setEditingCategory(null); setEditCategoryName(''); }
                    }}
                  />
                  <button onClick={(e) => { e.stopPropagation(); handleEditCategory(cat.id); }} className="text-emerald-400 hover:text-emerald-300">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setEditingCategory(null); setEditCategoryName(''); }} className="text-[#5C5E72] hover:text-white">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-white">{cat.name}</p>
                    <p className="text-[10px] text-[#5C5E72]">{cat.subcategories.length} subcategories</p>
                  </div>
                  {!cat.is_active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400">Hidden</span>
                  )}
                </>
              )}
              {editingCategory !== cat.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCategory(cat.id);
                      setEditCategoryName(cat.name);
                    }}
                    className="p-1 rounded hover:bg-white/5 text-[#5C5E72] hover:text-white transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name); }}
                    className="p-1 rounded hover:bg-white/5 text-red-400/60 hover:text-red-400 transition-colors"
                    title="Delete category"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleCategory(cat.id, cat.is_active); }}
                    className={`p-1 rounded hover:bg-white/5 transition-colors ${cat.is_active ? 'text-emerald-400' : 'text-gray-500'}`}
                    title={cat.is_active ? 'Hide' : 'Show'}
                  >
                    {cat.is_active ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    )}
                  </button>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`text-[#5C5E72] transition-transform ${expandedCategory === cat.id ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              )}
            </div>

            {/* Subcategories */}
            {expandedCategory === cat.id && (
              <div className="border-t border-[#1E1E2C] px-4 py-3">
                <div className="space-y-1.5">
                  {cat.subcategories.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02]">
                      {editingSub === sub.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <Input
                            value={editSubName}
                            onChange={(e) => setEditSubName(e.target.value)}
                            className="h-6 text-[11px] bg-[#0A0A0F] border-[#1E1E2C]"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleEditSubcategory(sub.id);
                              if (e.key === 'Escape') { setEditingSub(null); setEditSubName(''); }
                            }}
                          />
                          <button onClick={() => handleEditSubcategory(sub.id)} className="text-emerald-400">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                          </button>
                          <button onClick={() => { setEditingSub(null); setEditSubName(''); }} className="text-[#5C5E72]">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className={`text-[11px] ${sub.is_active ? 'text-[#8B8DA0]' : 'text-gray-600 line-through'}`}>
                            {sub.name}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setEditingSub(sub.id); setEditSubName(sub.name); }}
                              className="p-1 rounded hover:bg-white/5 text-[#5C5E72]"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            <button
                              onClick={() => handleDeleteSubcategory(sub.id, sub.name)}
                              className="p-1 rounded hover:bg-white/5 text-red-400/60 hover:text-red-400"
                              title="Delete subcategory"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                            <button
                              onClick={() => handleToggleSubcategory(sub.id, sub.is_active)}
                              className={`p-1 rounded hover:bg-white/5 ${sub.is_active ? 'text-emerald-400' : 'text-gray-600'}`}
                            >
                              {sub.is_active ? (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /></svg>
                              ) : (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /></svg>
                              )}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {/* Add Subcategory Button */}
                <button
                  onClick={() => {
                    setActiveCategoryId(cat.id);
                    setShowAddSub(true);
                  }}
                  className="mt-2 flex items-center gap-1.5 text-[10px] text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                  Add Subcategory
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Empty state */}
      {categories.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-[#5C5E72]">No categories yet</p>
          <p className="text-[10px] text-[#3C3D4D] mt-1">Add your first service category</p>
        </div>
      )}

      {/* ─── MODALS ──────────────────────────────────── */}

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">Add Service Category</h3>
            <p className="text-[10px] text-[#5C5E72]">Create a new top-level category (e.g., &quot;Beauty&quot;, &quot;Technology&quot;)</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Category Name *</label>
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Beauty"
                  className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Icon (emoji optional)</label>
                <Input
                  value={newCategoryIcon}
                  onChange={(e) => setNewCategoryIcon(e.target.value)}
                  placeholder="e.g. 💇"
                  className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddCategory(false); setNewCategoryName(''); setNewCategoryIcon(''); }}
                className="flex-1 py-2 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#22222E] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCategory}
                className="flex-1 py-2 rounded-xl bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors"
              >
                Create Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Subcategory Modal */}
      {showAddSub && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#12121A] border border-[#1E1E2C] rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">Add Subcategory</h3>
            <p className="text-[10px] text-[#5C5E72]">
              Add a service under &quot;{categories.find(c => c.id === activeCategoryId)?.name}&quot;
            </p>
            <Input
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              placeholder="e.g. Barber"
              className="h-9 text-xs bg-[#0A0A0F] border-[#1E1E2C]"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubcategory(); }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddSub(false); setNewSubName(''); setActiveCategoryId(null); }}
                className="flex-1 py-2 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#22222E] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubcategory}
                className="flex-1 py-2 rounded-xl bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
