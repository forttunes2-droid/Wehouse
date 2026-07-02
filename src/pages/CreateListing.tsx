import { useState, useRef, useCallback, useEffect } from 'react';
import { createListing, uploadListingImage, uploadListingVideo, getAvailableChatAgents, checkDuplicateListing } from '@/lib/supabase';
import { ROLE_RANK } from '@/types';
// Image hash duplicate detection removed — too many false positives
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
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Array<{
    user_id: string; username: string | null; role: string;
    assigned_state: string | null; assigned_lga: string | null; state: string | null; city: string | null;
  }>>([]);
  const [chatAgentId, setChatAgentId] = useState<string>('');
  const [loadingAgents, setLoadingAgents] = useState(true);

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    currency: 'NGN',
    address: '',
    property_type: '' as '' | 'house' | 'apartment' | 'duplex',
    bedrooms: '1',
    bathrooms: '1',
    availability_status: 'available' as 'available' | 'reserved' | 'closed',
    status: 'available' as 'available' | 'reserved' | 'closed',
  });

  const [location, setLocation] = useState({
    country: profile.country || 'Nigeria',
    state: profile.state || '',
    city: profile.city || '',
    area: profile.area || '',
  });

  // Load chat agents that match the LISTING location (not poster's location)
  useEffect(() => {
    if (profile.role === 'staff') {
      // Staff posting — they ARE the chat agent automatically
      setChatAgentId(profile.user_id);
      setLoadingAgents(false);
      return;
    }
    // Admin+ — fetch all staff, sorted by location match (listing location first)
    async function loadAgents() {
      setLoadingAgents(true);
      const { agents } = await getAvailableChatAgents(location.state, location.city);
      const list = agents || [];
      setAvailableAgents(list);
      if (list.length > 0) setChatAgentId(list[0].user_id);
      else setChatAgentId('');
      setLoadingAgents(false);
    }
    // Load agents immediately — sorting updates when location changes
    loadAgents();
  }, [profile.role, profile.user_id, location.state, location.city]);

  // Image upload handler — supports multiple files at once
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Filter valid image files
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) { toast.error('Select image files only'); return; }

    // Check total won't exceed 7
    if (images.length + validFiles.length > 7) {
      toast.error(`Maximum 7 images allowed. You selected ${validFiles.length} but can only add ${Math.max(0, 7 - images.length)} more.`);
      return;
    }

    // Check each file size
    const oversized = validFiles.filter(f => f.size > 35 * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error(`${oversized.length} file(s) exceed 35MB limit`);
      return;
    }

    setUploadingImage(true);
    // Upload all images in parallel for speed
    const uploadPromises = validFiles.map(async (file, idx) => {
      const tempId = `temp-${profile.user_id}-${Date.now()}-${idx}`;
      const { url, error } = await uploadListingImage(file, tempId);
      return { url, error };
    });

    const results = await Promise.all(uploadPromises);
    const newUrls = results.filter(r => r.url && !r.error).map(r => r.url!);
    const failed = results.filter(r => r.error).length;

    setUploadingImage(false);

    if (newUrls.length > 0) {
      setImages(prev => [...prev, ...newUrls]);
      toast.success(`${newUrls.length} image${newUrls.length > 1 ? 's' : ''} added`);
    }
    if (failed > 0) {
      toast.error(`${failed} file(s) failed to upload`);
    }

    // Reset input so same files can be selected again
    e.target.value = '';
  }, [images.length, profile.user_id]);

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  // Video upload handler
  const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Limit to 3 videos total
    if (videos.length >= 3) {
      toast.error('Maximum 3 videos');
      return;
    }

    const file = files[0];
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only MP4, MOV, or WebM videos');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Max 50MB per video');
      return;
    }

    setUploadingVideo(true);
    toast.loading('Uploading video...', { id: 'video-upload' });
    const tempId = `temp-${profile.user_id}-${Date.now()}`;
    const { url, error } = await uploadListingVideo(file, tempId);
    setUploadingVideo(false);
    toast.dismiss('video-upload');

    if (error || !url) {
      toast.error('Upload failed: ' + (error?.message || 'Unknown'));
      return;
    }
    setVideos(prev => [...prev, url]);
    toast.success('Video added');
  }, [videos.length, profile.user_id]);

  const removeVideo = (index: number) => {
    setVideos(prev => prev.filter((_, i) => i !== index));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.price || Number(form.price) <= 0) { toast.error('Valid price is required'); return; }
    if (!location.city) { toast.error('City is required'); return; }

    // Duplicate detection — practical for Nigerian context (no house numbers)
    const address = form.address.trim() || location.area || '';
    if (address) {
      const { titleMatch, recentPost } = await checkDuplicateListing(form.title.trim(), address, location.city, location.state, profile.auth_id);
      if (titleMatch) {
        toast.error(`A listing with a very similar title already exists in ${location.city}. Try a different title.`);
        return;
      }
      if (recentPost) {
        toast.error('You already posted a listing in this city within the last 30 days. Please wait before posting again.');
        return;
      }
    }

    // Chat agent is optional — if none selected, no chat option shown on listing

    // NOTE: Image hash duplicate detection removed — too many false positives
    // with similar-looking rooms (white walls, tiled floors, common in Nigeria).
    // Title + location duplicate check above is sufficient.

    // Determine approval status based on poster role
    // Creator and Director posts go live immediately
    // Everyone else needs approval from higher-up
    const requiresApproval = ROLE_RANK[profile.role as keyof typeof ROLE_RANK] < ROLE_RANK.admin;
    const listingStatus = requiresApproval ? 'pending_approval' : 'available';

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
      videos,
      property_type: form.property_type || null,
      bedrooms: Number(form.bedrooms) || 1,
      bathrooms: Number(form.bathrooms) || 1,
      availability_status: listingStatus as any,
      status: listingStatus as any,
      reserved_by: null,
      reservation_expiry: null,
      reservation_fee_paid: false,
      chat_unlocked: false,
      owner_id: profile.auth_id,
      chat_agent_id: chatAgentId || null,
      submitted_by_role: profile.role,
    });
    setSaving(false);

    if (error || !listing) {
      toast.error('Failed to create: ' + (error?.message || 'Unknown'));
      return;
    }
    if (requiresApproval) {
      toast.success('Listing submitted for approval! It will go live once reviewed.');
    } else {
      toast.success('Listing created and published!');
    }

    // Image hash saving removed — perceptual hashing produced too many
    // false positives with similar-looking rooms common in Nigeria.

    onSuccess?.();
  }

  const statusOptions = [
    { value: 'available', label: 'Available', color: 'text-green-400 bg-green-500/10 border-green-500/20' },
    { value: 'reserved', label: 'Reserved', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { value: 'closed', label: 'Closed', color: 'text-gray-400 bg-gray-500/10 border-gray-500/20' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-20">
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
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Photos ({images.length}/7)</label>
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
            {images.length < 7 && (
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
            <input ref={fileInputRef} type="file" accept="image/*" multiple max="7" className="hidden" onChange={handleImageUpload} />
          </div>
        </div>

        {/* Videos */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">
            Videos {videos.length > 0 && <span className="text-[#5C5E72]">({videos.length}/3)</span>}
          </label>
          <div className="flex gap-2 flex-wrap">
            {/* Video thumbnails */}
            {videos.map((url, i) => (
              <div key={i} className="relative w-32 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-[#1A1A24]">
                <video src={url} className="w-full h-full object-cover" preload="metadata" />
                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </div>
                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => removeVideo(i)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center text-[10px] z-10"
                >
                  ×
                </button>
                {/* Video label */}
                <div className="absolute bottom-1 left-1.5 z-10">
                  <span className="text-[8px] text-white/80 font-medium">Video {i + 1}</span>
                </div>
              </div>
            ))}
            {/* Add video button */}
            {videos.length < 3 && (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={uploadingVideo}
                className="w-32 h-20 rounded-xl border border-dashed border-[#2A2A3A] flex flex-col items-center justify-center text-[#5C5E72] hover:border-purple-500/50 hover:text-purple-400 transition-colors disabled:opacity-50"
              >
                {uploadingVideo ? (
                  <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>
                    <span className="text-[9px] mt-1">Add Video</span>
                  </>
                )}
              </button>
            )}
            <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleVideoUpload} />
          </div>
          <p className="text-[9px] text-[#5C5E72] mt-1">MP4, MOV, WebM · Max 50MB · Max 3 videos</p>
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
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Price per year (NGN) *</label>
          <Input
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="h-11 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50"
            placeholder="e.g. 600000 (yearly rent)"
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

        {/* Property Type — House, Apartment, or Duplex */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Property Type *</label>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { value: 'house', label: 'House', desc: 'Standalone building' },
              { value: 'apartment', label: 'Apartment', desc: 'Flat in a building' },
              { value: 'duplex', label: 'Duplex', desc: 'Two-floor unit' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm({ ...form, property_type: form.property_type === opt.value ? '' : opt.value as any })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  form.property_type === opt.value
                    ? 'border-[#3B82F6] bg-[#3B82F6]/10'
                    : 'border-[#2A2A3A] bg-[#1A1A24] hover:border-[#3B82F6]/30'
                }`}
              >
                <p className={`text-xs font-semibold ${form.property_type === opt.value ? 'text-[#3B82F6]' : 'text-white'}`}>{opt.label}</p>
                <p className="text-[9px] text-[#5C5E72] mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Bedrooms & Bathrooms — all property types can configure */}
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

        {/* Chat Agent Assignment */}
        <div className="glass rounded-2xl p-4 border border-[#3B82F6]/10">
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            Chat Agent — Who handles enquiries
          </label>

          {profile.role === 'staff' ? (
            /* Staff posting — they ARE the agent automatically */
            <div className="flex items-center gap-3 py-1">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-xs font-bold">
                {(profile.username || 'Y').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-white font-medium">@{profile.username || 'You'} — You will handle enquiries</p>
                <p className="text-[10px] text-amber-400/70">Users can chat or call you about this listing</p>
              </div>
            </div>
          ) : loadingAgents ? (
            /* Creator posting — loading agents */
            <div className="flex items-center gap-2 py-2">
              <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-[#5C5E72]">Loading agents...</span>
            </div>
          ) : availableAgents.length === 0 ? (
            <p className="text-xs text-amber-400">No staff or admin available. Assign a staff member first.</p>
          ) : (
            /* Creator posting — select agent dropdown */
            <select
              value={chatAgentId}
              onChange={(e) => setChatAgentId(e.target.value)}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none"
            >
              {availableAgents.map((a, idx) => {
                // Use assigned_* with fallback to state/city for display
                const displayCity = a.assigned_lga || a.city || 'no-city';
                const displayState = a.assigned_state || a.state || 'no-state';
                const normListingCity = (location.city || '').trim().toLowerCase();
                const normListingState = (location.state || '').trim().toLowerCase();
                const normCity = displayCity.trim().toLowerCase();
                const normState = displayState.trim().toLowerCase();

                const matchesCity = normListingCity && (normCity === normListingCity || normCity.includes(normListingCity) || normListingCity.includes(normCity));
                const matchesState = normListingState && (normState === normListingState || normState.includes(normListingState) || normListingState.includes(normState));
                const isMatch = matchesCity && matchesState;

                return (
                  <option key={a.user_id} value={a.user_id}>
                    {idx === 0 && isMatch ? '✓ ' : ''}@{a.username || 'Unknown'} · {displayCity}, {displayState}
                  </option>
                );
              })}
            </select>
          )}
          <p className="text-[9px] text-[#5C5E72] mt-2">
            Users will see only the agent&apos;s username and can chat/call about this listing. Your identity as the poster stays hidden.
          </p>
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
