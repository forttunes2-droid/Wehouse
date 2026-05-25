import { useState, useEffect, useCallback } from 'react';
import {
  getCreatorListings,
  createListing,
  updateListing,
  deleteListing,
  uploadListingImage,
} from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Profile, Listing } from '@/types';
import { Toaster, toast } from 'sonner';

type CreatorTab = 'listings' | 'analytics' | 'settings';

interface CreatorDashboardProps {
  profile: Profile;
  onLogout: () => void;
}

export default function CreatorDashboard({ profile, onLogout }: CreatorDashboardProps) {
  const [activeTab, setActiveTab] = useState<CreatorTab>('listings');
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadListings = useCallback(async () => {
    setLoading(true);
    const { listings: data, error } = await getCreatorListings(profile.auth_id);
    if (error) {
      toast.error('Failed to load listings: ' + error.message);
    }
    setListings(data || []);
    setLoading(false);
  }, [profile.auth_id]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  async function handleDelete(id: string) {
    setDeleteLoading(true);
    const { error } = await deleteListing(id);
    setDeleteLoading(false);
    setDeleteConfirm(null);

    if (error) {
      toast.error('Delete failed: ' + error.message);
      return;
    }

    toast.success('Listing deleted successfully');
    loadListings();
  }

  async function handleStatus(id: string, status: 'available' | 'reserved' | 'occupied' | 'hidden') {
    const { error } = await updateListing(id, { availability_status: status });
    if (error) {
      toast.error('Update failed: ' + error.message);
      return;
    }
    toast.success(`Status changed to ${status}`);
    loadListings();
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#0F1724] text-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#C8A45A] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1724" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold">Creator Dashboard</div>
              <div className="text-[10px] text-white/50">@{profile.username}</div>
            </div>
          </div>
          <button onClick={onLogout} className="text-xs text-white/50 hover:text-white">Logout</button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-white border-b border-[#e5e2dd]">
        <div className="flex max-w-lg mx-auto">
          {[
            { id: 'listings' as CreatorTab, label: 'Listings', icon: '🏠' },
            { id: 'analytics' as CreatorTab, label: 'Analytics', icon: '📊' },
            { id: 'settings' as CreatorTab, label: 'Settings', icon: '⚙️' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#C8A45A] text-[#C8A45A]'
                  : 'border-transparent text-[#8B8680]'
              }`}
            >
              <span className="mr-1">{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-lg mx-auto px-5 py-4 pb-24">
        {activeTab === 'listings' && (
          <ListingsTab
            listings={listings}
            loading={loading}
            onRefresh={loadListings}
            onShowForm={() => setShowForm(true)}
            onEdit={(l) => { setEditing(l); setShowForm(true); }}
            onDeleteRequest={(id) => setDeleteConfirm(id)}
            onStatusChange={handleStatus}
          />
        )}
        {activeTab === 'analytics' && <AnalyticsTab listings={listings} />}
        {activeTab === 'settings' && <SettingsTab profile={profile} />}
      </main>

      {/* Form Modal */}
      {showForm && (
        <ListingFormModal
          listing={editing}
          ownerId={profile.auth_id}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSuccess={() => { loadListings(); setShowForm(false); setEditing(null); }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-5">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <h3 className="text-center text-sm font-semibold text-[#0F1724] mb-1">Delete Listing?</h3>
            <p className="text-center text-xs text-[#8B8680] mb-5">This cannot be undone. The listing will be permanently removed.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 h-10 rounded-xl border border-[#e5e2dd] text-sm font-medium text-[#8B8680]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteLoading}
                className="flex-1 h-10 rounded-xl bg-red-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LISTINGS TAB ──────────────────────────────────
function ListingsTab({
  listings, loading, onShowForm, onEdit, onDeleteRequest, onStatusChange
}: {
  listings: Listing[];
  loading: boolean;
  onRefresh: () => void;
  onShowForm: () => void;
  onEdit: (l: Listing) => void;
  onDeleteRequest: (id: string) => void;
  onStatusChange: (id: string, status: 'available' | 'reserved' | 'occupied' | 'hidden') => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#8B8680]">{listings.length} listing{listings.length !== 1 ? 's' : ''}</span>
        <Button
          onClick={onShowForm}
          className="h-8 px-3 text-xs rounded-lg bg-[#C8A45A] text-[#0F1724] hover:bg-[#b8944a] font-semibold"
        >
          + Add Listing
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl">
          <div className="w-14 h-14 rounded-full bg-[#f0eeea] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B8680" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <p className="text-sm text-[#8B8680]">No listings yet</p>
          <button onClick={onShowForm} className="mt-2 text-xs text-[#C8A45A] font-medium">Create your first listing</button>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <div key={l.id} className="bg-white rounded-2xl overflow-hidden">
              {/* Image */}
              <div className="relative">
                <img
                  src={l.images?.[0] || 'https://placehold.co/400x200/e5e2dd/8B8680?text=No+Image'}
                  alt={l.title}
                  className="w-full h-32 object-cover"
                />
                <div className="absolute top-2 right-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                    l.availability_status === 'available' ? 'bg-green-500 text-white' :
                    l.availability_status === 'reserved' ? 'bg-amber-500 text-white' :
                    l.availability_status === 'occupied' ? 'bg-gray-500 text-white' :
                    'bg-red-500 text-white'
                  }`}>
                    {l.availability_status}
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-[#0F1724] truncate">{l.title}</h4>
                    <p className="text-xs text-[#C8A45A] font-bold mt-0.5">₦{l.price.toLocaleString()}</p>
                    <p className="text-[10px] text-[#8B8680] mt-0.5">{l.listing_id} · {l.bedrooms}bd · {l.bathrooms}ba · {l.city || 'No city'}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => onEdit(l)}
                    className="flex-1 h-9 rounded-xl bg-[#0F1724] text-white text-[11px] font-semibold flex items-center justify-center gap-1"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    Edit
                  </button>
                  <button
                    onClick={() => onDeleteRequest(l.id)}
                    className="h-9 px-3 rounded-xl border border-red-200 text-red-500 flex items-center justify-center"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                </div>

                {/* Status selector */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-[#8B8680]">Change status:</span>
                  <select
                    value={l.availability_status}
                    onChange={(e) => onStatusChange(l.id, e.target.value as 'available' | 'reserved' | 'occupied' | 'hidden')}
                    className="flex-1 h-7 rounded-lg border border-[#e5e2dd] text-[10px] px-2 bg-white"
                  >
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="occupied">Occupied</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LISTING FORM MODAL ────────────────────────────
function ListingFormModal({
  listing, ownerId, onClose, onSuccess
}: {
  listing: Listing | null;
  ownerId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    title: listing?.title || '',
    description: listing?.description || '',
    price: listing?.price ? String(listing.price) : '',
    currency: listing?.currency || 'NGN',
    state: listing?.state || '',
    city: listing?.city || '',
    address: listing?.address || '',
    bedrooms: listing?.bedrooms ? String(listing.bedrooms) : '1',
    bathrooms: listing?.bathrooms ? String(listing.bathrooms) : '1',
    availability_status: listing?.availability_status || 'available',
  });
  const [images, setImages] = useState<string[]>(listing?.images || []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (images.length >= 5) {
      toast.error('Max 5 images allowed');
      return;
    }
    setUploading(true);
    const listingId = listing?.listing_id || 'temp';
    const { url } = await uploadListingImage(file, listingId);
    if (url) {
      setImages((prev) => [...prev, url]);
      toast.success('Image uploaded');
    } else {
      toast.error('Upload failed');
    }
    setUploading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.price || Number(form.price) <= 0) { toast.error('Valid price required'); return; }

    setSaving(true);

    const data = {
      title: form.title.trim(),
      description: form.description,
      price: Number(form.price),
      currency: form.currency,
      state: form.state,
      city: form.city,
      address: form.address,
      bedrooms: Number(form.bedrooms) || 1,
      bathrooms: Number(form.bathrooms) || 1,
      availability_status: form.availability_status as any,
      images,
      owner_id: ownerId,
    };

    let error;
    if (listing) {
      const { error: err } = await updateListing(listing.id, data);
      error = err;
    } else {
      const { error: err } = await createListing(data);
      error = err;
    }

    setSaving(false);

    if (error) {
      toast.error('Save failed: ' + error.message);
      return;
    }

    toast.success(listing ? 'Listing updated!' : 'Listing created!');
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg max-h-[90vh] rounded-t-2xl sm:rounded-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#f0eeea] px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-sm font-semibold text-[#0F1724]">{listing ? 'Edit Listing' : 'New Listing'}</h2>
          <button onClick={onClose} className="text-[#8B8680] hover:text-[#0F1724]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <Label className="text-[10px] text-[#8B8680]">Title *</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="h-10 rounded-xl text-sm" placeholder="e.g. 2 Bedroom Apartment" />
          </div>

          {/* Description */}
          <div>
            <Label className="text-[10px] text-[#8B8680]">Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-xl text-sm" rows={3} placeholder="Describe the property..." />
          </div>

          {/* Price & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] text-[#8B8680]">Price (₦) *</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required className="h-10 rounded-xl text-sm" placeholder="150000" />
            </div>
            <div>
              <Label className="text-[10px] text-[#8B8680]">Status</Label>
              <select value={form.availability_status} onChange={(e) => setForm({ ...form, availability_status: e.target.value as 'available' | 'reserved' | 'occupied' | 'hidden' })} className="w-full h-10 rounded-xl border border-[#e5e2dd] px-3 text-sm bg-white">
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="occupied">Occupied</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>
          </div>

          {/* Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] text-[#8B8680]">State</Label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="h-10 rounded-xl text-sm" placeholder="e.g. Lagos" />
            </div>
            <div>
              <Label className="text-[10px] text-[#8B8680]">City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="h-10 rounded-xl text-sm" placeholder="e.g. Ikeja" />
            </div>
          </div>

          <div>
            <Label className="text-[10px] text-[#8B8680]">Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-10 rounded-xl text-sm" placeholder="Full address" />
          </div>

          {/* Bedrooms & Bathrooms */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] text-[#8B8680]">Bedrooms</Label>
              <Input type="number" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} className="h-10 rounded-xl text-sm" min={0} />
            </div>
            <div>
              <Label className="text-[10px] text-[#8B8680]">Bathrooms</Label>
              <Input type="number" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} className="h-10 rounded-xl text-sm" min={0} />
            </div>
          </div>

          {/* Images */}
          <div>
            <Label className="text-[10px] text-[#8B8680]">Images ({images.length}/5)</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="w-16 h-16 rounded-lg overflow-hidden relative">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center"
                  >x</button>
                </div>
              ))}
              {images.length < 5 && (
                <label className="w-16 h-16 rounded-lg border-2 border-dashed border-[#e5e2dd] flex flex-col items-center justify-center cursor-pointer hover:border-[#C8A45A]">
                  <span className="text-lg text-[#8B8680]">+</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              )}
            </div>
            {uploading && <span className="text-[10px] text-[#C8A45A]">Uploading...</span>}
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full h-11 rounded-xl bg-[#C8A45A] text-[#0F1724] hover:bg-[#b8944a] font-semibold"
          >
            {saving ? 'Saving...' : listing ? 'Update Listing' : 'Create Listing'}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── ANALYTICS TAB ─────────────────────────────────
function AnalyticsTab({ listings }: { listings: Listing[] }) {
  const total = listings.length;
  const available = listings.filter(l => l.availability_status === 'available').length;
  const reserved = listings.filter(l => l.availability_status === 'reserved').length;
  const occupied = listings.filter(l => l.availability_status === 'occupied').length;
  const hidden = listings.filter(l => l.availability_status === 'hidden').length;
  const totalValue = listings.reduce((sum, l) => sum + l.price, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total Listings', value: total, color: 'bg-[#0F1724] text-white' },
          { label: 'Available', value: available, color: 'bg-green-500 text-white' },
          { label: 'Reserved', value: reserved, color: 'bg-amber-500 text-white' },
          { label: 'Occupied', value: occupied, color: 'bg-gray-500 text-white' },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.color} rounded-2xl p-4 text-center`}>
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-[10px] opacity-80">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Summary</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[#8B8680]">Hidden</span>
            <span className="font-semibold text-[#0F1724]">{hidden}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#8B8680]">Total Value</span>
            <span className="font-semibold text-[#C8A45A]">₦{totalValue.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS TAB ──────────────────────────────────
function SettingsTab({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-[#0F1724] flex items-center justify-center text-[#C8A45A] text-lg font-bold">
            {(profile.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-[#0F1724]">@{profile.username}</div>
            <div className="text-xs text-[#8B8680]">{profile.email}</div>
          </div>
        </div>

        <div className="space-y-3">
          {[
            { label: 'User ID', value: profile.user_id },
            { label: 'Email', value: profile.email },
            { label: 'Role', value: profile.role.replace('_', ' ') },
          ].map((item) => (
            <div key={item.label} className="flex justify-between py-2 border-b border-[#f0eeea] last:border-0">
              <span className="text-xs text-[#8B8680]">{item.label}</span>
              <span className="text-xs font-medium text-[#0F1724]">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
