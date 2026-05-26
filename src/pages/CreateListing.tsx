import { useState, useRef, useCallback } from 'react';
import { createListing, uploadListingImage } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import LocationSelector from '@/components/LocationSelector';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface CreateListingProps {
  profile: Profile;
  onBack: () => void;
  onSuccess?: () => void;
}

export default function CreateListing({ profile, onBack, onSuccess }: CreateListingProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    currency: 'NGN',
    address: '',
    bedrooms: '1',
    bathrooms: '1',
    availability_status: 'available' as 'available' | 'reserved' | 'occupied',
    status: 'available' as 'available' | 'reserved' | 'viewed' | 'occupied' | 'closed',
  });

  const [location, setLocation] = useState({
    country: profile.country || 'Nigeria',
    state: profile.state || '',
    city: profile.city || '',
    area: profile.area || '',
  });

  // Image upload handler
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Limit to 5 images total
    if (images.length >= 5) {
      toast.error('Maximum 5 images');
      return;
    }

    const file = files[0];
    if (!file.type.startsWith('image/')) { toast.error('Select an image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Max 5MB per image'); return; }

    setUploadingImage(true);
    // Use a temporary listing ID for storage path
    const tempId = `temp-${profile.user_id}-${Date.now()}`;
    const { url, error } = await uploadListingImage(file, tempId);
    setUploadingImage(false);

    if (error || !url) {
      toast.error('Upload failed: ' + (error?.message || 'Unknown'));
      return;
    }
    setImages(prev => [...prev, url]);
    toast.success('Image added');
  }, [images.length, profile.user_id]);

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.price || Number(form.price) <= 0) { toast.error('Valid price is required'); return; }
    if (!location.city) { toast.error('City is required'); return; }

    setSaving(true);
    const { listing, error } = await createListing({
      title: form.title.trim(),
      description: form.description.trim() || null,
      price: Number(form.price),
      currency: form.currency,
      state: location.state || null,
      city: location.city,
      address: form.address.trim() || location.area || null,
      images,
      bedrooms: Number(form.bedrooms) || 1,
      bathrooms: Number(form.bathrooms) || 1,
      availability_status: form.availability_status,
      status: form.status,
      reserved_by: null,
      reservation_expiry: null,
      reservation_fee_paid: false,
      chat_unlocked: false,
      owner_id: profile.auth_id,
    });
    setSaving(false);

    if (error || !listing) {
      toast.error('Failed to create: ' + (error?.message || 'Unknown'));
      return;
    }
    toast.success('Listing created!');
    onSuccess?.();
  }

  const statusOptions = [
    { value: 'available', label: 'Available', color: 'text-green-400 bg-green-500/10 border-green-500/20' },
    { value: 'reserved', label: 'Reserved', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { value: 'viewed', label: 'Viewed', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    { value: 'occupied', label: 'Occupied', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
    { value: 'closed', label: 'Closed', color: 'text-gray-400 bg-gray-500/10 border-gray-500/20' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">New Listing</h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Images */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Photos ({images.length}/5)</label>
          <div className="flex gap-2 flex-wrap">
            {images.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center text-[10px]"
                >
                  ×
                </button>
              </div>
            ))}
            {images.length < 5 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="w-20 h-20 rounded-xl border border-dashed border-[#2A2A3A] flex flex-col items-center justify-center text-[#5C5E72] hover:border-[#3B82F6]/50 hover:text-[#3B82F6] transition-colors disabled:opacity-50"
              >
                {uploadingImage ? (
                  <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    <span className="text-[9px] mt-1">Add</span>
                  </>
                )}
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Title *</label>
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="h-11 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50"
            placeholder="e.g. 2 Bedroom Apartment in Ikeja"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Description</label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50"
            rows={3}
            placeholder="Describe the property..."
          />
        </div>

        {/* Price */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Price (NGN) *</label>
          <Input
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="h-11 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50"
            placeholder="150000"
            required
          />
        </div>

        {/* Location */}
        <div className="glass rounded-2xl p-4">
          <label className="text-xs text-[#8A8B9C] font-medium mb-3 block">Location *</label>
          <LocationSelector value={location} onChange={setLocation} />
        </div>

        {/* Address */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Address</label>
          <Input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="h-11 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50"
            placeholder="Full street address"
          />
        </div>

        {/* Bedrooms / Bathrooms */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Bedrooms</label>
            <select
              value={form.bedrooms}
              onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
              className="w-full h-11 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none"
            >
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Bathrooms</label>
            <select
              value={form.bathrooms}
              onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
              className="w-full h-11 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none"
            >
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Status</label>
          <div className="flex gap-2">
            {statusOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm({ ...form, status: opt.value as any })}
                className={`flex-1 h-10 rounded-xl text-xs font-medium border transition-all ${
                  form.status === opt.value
                    ? opt.color
                    : 'bg-[#1A1A24] border-[#2A2A3A] text-[#5C5E72]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <Button
          type="submit"
          disabled={saving}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white hover:opacity-90 font-semibold shadow-lg shadow-blue-500/20 disabled:opacity-40"
        >
          {saving ? 'Creating...' : 'Post Listing'}
        </Button>
      </form>
    </div>
  );
}
