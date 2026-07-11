// ═══════════════════════════════════════════════════════════════
// PREMIUM MEDIA UPLOAD COMPONENT
// Instagram/TikTok-quality upload experience for WeHouse
// Features: multi-select, preview, reorder, remove, progress
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface MediaFile {
  id: string;         // Unique ID for React keys
  file: File;         // Original file
  preview: string;    // Object URL for preview
  type: 'image' | 'video';
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;   // 0-100
  publicUrl?: string; // Supabase URL after upload
  error?: string;
}

interface MediaUploadProps {
  bucket?: string;
  folder?: string;
  userId: string;
  maxFiles?: number;
  maxFileSizeMB?: number;
  acceptedTypes?: string;
  onUploadComplete?: (urls: string[]) => void;
  onChange?: (media: MediaFile[]) => void;
  existingUrls?: string[];
  className?: string;
}

export default function MediaUpload({
  bucket = 'listing-files',
  folder = 'uploads',
  userId,
  maxFiles = 20,
  maxFileSizeMB = 50,
  acceptedTypes = 'image/*,video/*',
  onUploadComplete,
  onChange,
  existingUrls = [],
  className = '',
}: MediaUploadProps) {
  const [media, setMedia] = useState<MediaFile[]>(() =>
    existingUrls.map((url, i) => ({
      id: `existing-${i}`,
      file: new File([], url.split('/').pop() || 'file'),
      preview: url,
      type: url.match(/\.(mp4|mov|avi|mkv|webm)$/i) ? 'video' : 'image',
      status: 'done' as const,
      progress: 100,
      publicUrl: url,
    }))
  );
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxBytes = maxFileSizeMB * 1024 * 1024;

  // Notify parent of changes
  const updateMedia = useCallback((newMedia: MediaFile[]) => {
    setMedia(newMedia);
    onChange?.(newMedia);
  }, [onChange]);

  // Generate unique ID
  const genId = () => Math.random().toString(36).substring(2, 10);

  // Process selected files
  const processFiles = (files: FileList | null) => {
    if (!files) return;
    const fileArray = Array.from(files);

    // Check max files
    if (media.length + fileArray.length > maxFiles) {
      toast.error(`Maximum ${maxFiles} files allowed. You can add ${maxFiles - media.length} more.`);
      return;
    }

    const newMedia: MediaFile[] = [];
    const errors: string[] = [];

    for (const file of fileArray) {
      // Check size
      if (file.size > maxBytes) {
        errors.push(`${file.name} exceeds ${maxFileSizeMB}MB limit`);
        continue;
      }

      // Check type
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !isVideo) {
        errors.push(`${file.name} is not an image or video`);
        continue;
      }

      const preview = URL.createObjectURL(file);
      newMedia.push({
        id: genId(),
        file,
        preview,
        type: isVideo ? 'video' : 'image',
        status: 'pending',
        progress: 0,
      });
    }

    if (errors.length > 0) {
      errors.forEach(e => toast.error(e));
    }

    if (newMedia.length > 0) {
      updateMedia([...media, ...newMedia]);
      toast.success(`${newMedia.length} file(s) added. Click Upload to send.`);
    }

    // Reset input
    if (inputRef.current) inputRef.current.value = '';
  };

  // Handle file input
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  };

  // Remove media
  const removeMedia = (id: string) => {
    const item = media.find(m => m.id === id);
    if (item?.preview.startsWith('blob:')) {
      URL.revokeObjectURL(item.preview);
    }
    updateMedia(media.filter(m => m.id !== id));
  };

  // Move media (reorder)
  const moveMedia = (index: number, direction: 'left' | 'right') => {
    const newMedia = [...media];
    const swapIndex = direction === 'left' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newMedia.length) return;
    [newMedia[index], newMedia[swapIndex]] = [newMedia[swapIndex], newMedia[index]];
    updateMedia(newMedia);
  };

  // Upload all pending files to Supabase
  const uploadAll = async () => {
    const pending = media.filter(m => m.status === 'pending');
    if (pending.length === 0) {
      const doneUrls = media.filter(m => m.status === 'done' && m.publicUrl).map(m => m.publicUrl!);
      onUploadComplete?.(doneUrls);
      return;
    }

    let successCount = 0;

    for (const item of pending) {
      // Update status to uploading
      setMedia(prev => prev.map(m => m.id === item.id ? { ...m, status: 'uploading' as const, progress: 0 } : m));

      try {
        const fileName = `${folder}/${userId}/${Date.now()}_${item.file.name}`;
        const { error } = await supabase.storage.from(bucket).upload(fileName, item.file, {
          contentType: item.file.type,
          upsert: false,
        });

        if (error) throw error;

        const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
        const publicUrl = data?.publicUrl || '';

        successCount++;
        setMedia(prev => prev.map(m => m.id === item.id ? {
          ...m, status: 'done' as const, progress: 100, publicUrl
        } : m));
      } catch (err: any) {
        setMedia(prev => prev.map(m => m.id === item.id ? {
          ...m, status: 'error' as const, error: err.message || 'Upload failed'
        } : m));
        toast.error(`Failed to upload ${item.file.name}`);
      }
    }

    // Get all done URLs
    const allDone = media.filter(m => m.status === 'done' || m.status === 'uploading').map(m => m.publicUrl || m.preview);
    if (successCount > 0) {
      toast.success(`${successCount} file(s) uploaded successfully`);
      onUploadComplete?.(allDone);
    }
  };

  // Get done URLs
  const getUploadedUrls = (): string[] => {
    return media.filter(m => m.status === 'done' && m.publicUrl).map(m => m.publicUrl!);
  };

  const pendingCount = media.filter(m => m.status === 'pending').length;
  const doneCount = media.filter(m => m.status === 'done').length;
  const uploadingCount = media.filter(m => m.status === 'uploading').length;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer
          transition-all duration-200
          ${isDragging
            ? 'border-violet-500 bg-violet-500/5 scale-[1.02]'
            : 'border-[#2A2A3A] hover:border-[#3A3A4A] hover:bg-[#0E0E14]'
          }
          ${media.length >= maxFiles ? 'opacity-40 pointer-events-none' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedTypes}
          onChange={handleFileInput}
          className="hidden"
        />
        <div className="w-12 h-12 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7C5CFF" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
        </div>
        <p className="text-sm text-white font-medium mb-1">
          {isDragging ? 'Drop files here' : 'Tap or drag photos & videos'}
        </p>
        <p className="text-[10px] text-[#5C5E72]">
          {media.length >= maxFiles
            ? `Maximum ${maxFiles} files reached`
            : `Up to ${maxFiles} files · Max ${maxFileSizeMB}MB each · Images & Videos`
          }
        </p>
      </div>

      {/* Media preview grid */}
      {media.length > 0 && (
        <div className="space-y-2">
          {/* Status bar */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[#5C5E72]">
              {doneCount} uploaded · {pendingCount} pending · {uploadingCount} uploading
              {media.length > 0 && ` · ${media.length}/${maxFiles}`}
            </p>
            {pendingCount > 0 && (
              <button
                onClick={uploadAll}
                className="h-7 px-3 rounded-lg bg-gradient-to-r from-violet-500 to-violet-700 text-white text-[11px] font-semibold hover:opacity-90 transition-opacity"
              >
                Upload {pendingCount} file{pendingCount > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {media.map((item, index) => (
              <div
                key={item.id}
                className={`
                  relative aspect-square rounded-xl overflow-hidden group
                  ${item.status === 'uploading' ? 'ring-2 ring-violet-500/50' : ''}
                  ${item.status === 'error' ? 'ring-2 ring-red-500/50' : ''}
                  ${item.status === 'done' ? 'ring-1 ring-emerald-500/30' : ''}
                `}
              >
                {/* Preview */}
                {item.type === 'video' ? (
                  <video
                    src={item.preview}
                    className="w-full h-full object-cover"
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={item.preview}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Video badge */}
                {item.type === 'video' && (
                  <div className="absolute top-1.5 left-1.5 bg-black/60 rounded-md px-1.5 py-0.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                )}

                {/* Status overlay */}
                {item.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {item.status === 'error' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-[9px] text-red-400 text-center px-1">Failed</span>
                  </div>
                )}
                {item.status === 'done' && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}

                {/* Hover controls */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                  {/* Move left */}
                  {index > 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); moveMedia(index, 'left'); }}
                      className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                  )}
                  {/* Remove */}
                  <button
                    onClick={e => { e.stopPropagation(); removeMedia(item.id); }}
                    className="w-7 h-7 rounded-lg bg-red-500/80 backdrop-blur flex items-center justify-center text-white hover:bg-red-500 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                  {/* Move right */}
                  {index < media.length - 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); moveMedia(index, 'right'); }}
                      className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Order number */}
                <div className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                  <span className="text-[9px] text-white font-bold">{index + 1}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// MediaFile interface is already exported above
