import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/withTimeout";

export type ShowcasePost = {
  id: string; worker_id?: string; kind: "work_post"; media_type: "image" | "video";
  storage_path: string; caption: string | null; booking_id?: string | null;
  verified_job: boolean; job_confirmation_status?: "not_linked" | "pending" | "confirmed" | "declined";
  hidden_at?: string | null; expires_at: string | null; created_at: string; url?: string;
};
const columns = "id,worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,job_confirmation_status,hidden_at,expires_at,created_at";
const PAGE = 24;
/** Both surfaces use the same post model; database/storage policies remain authoritative. */
export function useWorkerShowcase(workerId: string, owner: boolean, enabled = true) {
  const [posts, setPosts] = useState<ShowcasePost[]>([]), [loading, setLoading] = useState(enabled), [error, setError] = useState("");
  const [more, setMore] = useState(false), [loadingMore, setLoadingMore] = useState(false), [loadedFor, setLoadedFor] = useState("");
  const generation = useRef(0), offset = useRef(0), loadingPage = useRef(false);
  const identity = `${workerId}:${owner}:${enabled}`;
  const latestIdentity = useRef(identity); latestIdentity.current = identity;
  const baseQuery = useCallback(() => {
    let query = supabase.from("worker_showcase_posts").select(columns).eq("worker_id", workerId).eq("kind", "work_post").is("deleted_at", null);
    if (!owner) query = query.is("hidden_at", null).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    return query;
  }, [workerId, owner]);
  const refreshPost = useCallback(async (post: ShowcasePost): Promise<ShowcasePost> => {
    const result = await withTimeout(supabase.storage.from("worker-showcase").createSignedUrl(post.storage_path, 3600), 12000, "Media took too long to load.");
    if (result.error || !result.data?.signedUrl) throw new Error("This work post could not be opened. Please try again.");
    return { ...post, url: result.data.signedUrl };
  }, []);
  const load = useCallback(async (append = false) => {
    if (!enabled || (append && loadingPage.current)) return;
    if (!append) { generation.current++; offset.current = 0; setPosts([]); setMore(false); setLoading(true); }
    const request = generation.current; loadingPage.current = true;
    setLoadingMore(append); setError("");
    try {
      const start = append ? offset.current : 0;
      const result = await withTimeout(baseQuery().order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + PAGE), 15000, "Work posts took too long to load.");
      if (result.error || !Array.isArray(result.data)) throw new Error("Work posts could not be loaded.");
      const rows = result.data as ShowcasePost[];
      const page = rows.slice(0, PAGE);
      if (request !== generation.current || latestIdentity.current !== identity) return;
      setPosts(current => append ? Array.from(new Map([...current, ...page].map(row => [row.id, row])).values()) : page);
      offset.current = start + page.length; setMore(rows.length > PAGE); setLoadedFor(identity); setLoading(false);
      // Signing failure does not manufacture an empty profile. The grid remains
      // selectable and each post can retry an individual authorised media request.
      if (page.length) void withTimeout(
        supabase.storage.from("worker-showcase").createSignedUrls(page.map(row => row.storage_path), 3600),
        12000, "Media previews took too long.",
      ).then(signed => {
        if (request !== generation.current || latestIdentity.current !== identity) return;
        const urls = new Map((signed.data || []).map(item => [item.path, item.signedUrl || ""]));
        const next = page.map(row => ({ ...row, url: urls.get(row.storage_path) || "" }));
        const updates = new Map(next.map(row => [row.id, row]));
        setPosts(current => current.map(row => updates.get(row.id) || row));
        if (signed.error || next.some(post => !post.url)) setError("Some media previews could not be loaded. Open a post to retry.");
      }).catch(() => {
        if (request === generation.current && latestIdentity.current === identity) setError("Some media previews could not be loaded. Open a post to retry.");
      });

    } catch {
      if (request === generation.current && latestIdentity.current === identity) { setError("Work posts could not be loaded. Please try again."); setLoadedFor(identity); }
    } finally {
      if (request === generation.current && latestIdentity.current === identity) { setLoading(false); setLoadingMore(false); loadingPage.current = false; }
    }
  }, [baseQuery, enabled, identity]);
  const findPost = useCallback(async (id: string) => {
    const result = await withTimeout(baseQuery().eq("id", id).maybeSingle(), 15000, "Post took too long to load.");
    if (result.error) throw result.error;
    return result.data ? refreshPost(result.data as ShowcasePost) : null;
  }, [baseQuery, refreshPost]);
  useEffect(() => {
    if (enabled) void load();
    else { setPosts([]); setError(""); setLoading(false); setMore(false); }
    return () => { generation.current++; loadingPage.current = false; };
  }, [enabled, load]);
  return { posts: loadedFor === identity && enabled ? posts : [], loading: enabled && (loading || loadedFor !== identity), error: loadedFor === identity ? error : "", more: loadedFor === identity && more, loadingMore: loadedFor === identity && loadingMore, load, refreshPost, findPost };
}
