import { supabase } from "./client";

export type SavedSearch = {
  id: string;
  user_id: string;
  name: string;
  search_kind: "homes" | "hotels";
  criteria: Record<string, unknown>;
  notifications_enabled: boolean;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].map(normalized).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== "" && item !== null && item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

export function savedSearchKey(kind: string, criteria: Record<string, unknown>) {
  return `${kind}:${JSON.stringify(normalized(criteria))}`;
}

export async function getMySavedSearches() {
  const { data, error } = await supabase
    .from("saved_searches")
    .select("id,user_id,name,search_kind,criteria,notifications_enabled,last_notified_at,created_at,updated_at")
    .order("updated_at", { ascending: false });
  return { searches: (data || []) as SavedSearch[], error };
}

export async function followPropertySearch(name: string, kind: "homes" | "hotels", criteria: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("save_my_property_search", {
    p_name: name,
    p_search_kind: kind,
    p_criteria: criteria,
  });
  return { id: data ? String(data) : null, error };
}

export async function setSavedSearchAlerts(id: string, enabled: boolean) {
  const { error } = await supabase
    .from("saved_searches")
    .update({ notifications_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error };
}

export async function removeSavedSearch(id: string) {
  const { error } = await supabase.from("saved_searches").delete().eq("id", id);
  return { error };
}
