import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import { toast } from "sonner";

type PropertyType = {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
};
const DEFAULT_TYPES: PropertyType[] = [
  { id: 1, name: "Houses", icon: "house", sort_order: 1, is_active: true },
  {
    id: 2,
    name: "Apartments",
    icon: "apartment",
    sort_order: 2,
    is_active: true,
  },
  { id: 3, name: "Hotels", icon: "hotel", sort_order: 3, is_active: true },
];
const CORE_TYPE_IDS = new Set([1, 2, 3]);
const ICONS: Record<string, string> = {
  house:
    "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  apartment:
    "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  hotel:
    "M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zM9 7h6M9 11h6M9 15h6",
};

export default function PropertyTypeManager({ profile }: { profile: Profile }) {
  void profile;
  const [types, setTypes] = useState<PropertyType[]>([]),
    [original, setOriginal] = useState<PropertyType[]>([]),
    [deletedIds, setDeletedIds] = useState<number[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [newType, setNewType] = useState(""),
    [usingDefaults, setUsingDefaults] = useState(false);
  useEffect(() => {
    void load();
  }, []);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("property_types")
      .select("*")
      .order("sort_order");
    if (error) {
      toast.error(`Failed to load property types: ${error.message}`);
      setTypes([]);
      setOriginal([]);
      setUsingDefaults(false);
    } else {
      const next =
        data && data.length
          ? (data as PropertyType[])
          : DEFAULT_TYPES.map((t) => ({ ...t }));
      setTypes(next);
      setOriginal(next.map((t) => ({ ...t })));
      setUsingDefaults(!(data && data.length));
    }
    setDeletedIds([]);
    setLoading(false);
  }
  const dirty = useMemo(
    () =>
      usingDefaults ||
      deletedIds.length > 0 ||
      JSON.stringify(types) !== JSON.stringify(original),
    [types, original, deletedIds, usingDefaults],
  );
  async function saveTypes() {
    setSaving(true);
    const errors: string[] = [];
    for (const type of types) {
      const { error } = await supabase.from("property_types").upsert({
        id: type.id,
        name: type.name,
        icon: type.icon,
        sort_order: type.sort_order,
        is_active: type.is_active,
        updated_at: new Date().toISOString(),
      });
      if (error) errors.push(`${type.name}: ${error.message}`);
    }
    for (const id of deletedIds) {
      const { error } = await supabase
        .from("property_types")
        .delete()
        .eq("id", id);
      if (error) errors.push(`Delete #${id}: ${error.message}`);
    }
    setSaving(false);
    if (errors.length)
      return toast.error(`Some changes failed: ${errors.join("; ")}`);
    toast.success("Property marketplace updated");
    await load();
  }
  function addType() {
    const name = newType.trim();
    if (!name) return;
    if (types.some((t) => t.name.trim().toLowerCase() === name.toLowerCase()))
      return toast.error("That property group already exists");
    const id = Math.max(...types.map((t) => t.id), 0) + 1;
    setTypes((prev) => [
      ...prev,
      { id, name, icon: "house", sort_order: prev.length + 1, is_active: true },
    ]);
    setNewType("");
  }
  function remove(id: number) {
    if (CORE_TYPE_IDS.has(id)) {
      toast.error(
        "Core property groups cannot be deleted. Hide or rename this group instead.",
      );
      return;
    }
    setTypes((prev) =>
      prev
        .filter((t) => t.id !== id)
        .map((t, i) => ({ ...t, sort_order: i + 1 })),
    );
    if (!usingDefaults)
      setDeletedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }
  function toggle(id: number) {
    setTypes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, is_active: !t.is_active } : t)),
    );
  }
  function rename(id: number, name: string) {
    setTypes((prev) =>
      prev.map((type) => (type.id === id ? { ...type, name } : type)),
    );
  }
  function move(id: number, direction: -1 | 1) {
    const index = types.findIndex((t) => t.id === id),
      to = index + direction;
    if (index < 0 || to < 0 || to >= types.length) return;
    const next = types.map((t) => ({ ...t }));
    [next[index], next[to]] = [next[to], next[index]];
    next.forEach((t, i) => (t.sort_order = i + 1));
    setTypes(next);
  }
  function discard() {
    setTypes(original.map((t) => ({ ...t })));
    setDeletedIds([]);
    setUsingDefaults(false);
  }
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-500/12 bg-violet-500/[.04] p-3">
        <div className="flex items-start gap-3">
          <Step n="1" />
          <div>
            <p className="text-xs font-semibold">
              Choose what people can browse
            </p>
            <p className="mt-1 text-[9px] leading-relaxed text-[#6D7182]">
              These are the main property groups shown in discovery. Add only
              categories that should exist in the marketplace.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addType();
            }}
            placeholder="Add a property group"
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40"
          />
          <button
            onClick={addType}
            disabled={!newType.trim()}
            className="h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
      {usingDefaults && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[9px] leading-relaxed text-amber-200/75">
          This is a starter preview. Nothing is written to the marketplace until
          you save.
        </div>
      )}
      <div className="rounded-2xl border border-white/[.06] bg-[#0D1017] p-3">
        <div className="mb-3 flex items-start gap-3">
          <Step n="2" />
          <div>
            <p className="text-xs font-semibold">Order and visibility</p>
            <p className="mt-1 text-[9px] text-[#656A7B]">
              Move groups into the order customers should see them. Hide a group
              without deleting it.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {types.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[.08] p-8 text-center text-[10px] text-[#666B7C]">
              Add at least one property group.
            </div>
          ) : (
            types.map((type, index) => (
              <div
                key={type.id}
                className={`flex items-center gap-3 rounded-xl border border-white/[.05] bg-[#151821] p-3 ${!type.is_active ? "opacity-55" : ""}`}
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/[.07] text-violet-200">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d={ICONS[type.icon] || ICONS.house} />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    aria-label={`Rename ${type.name}`}
                    value={type.name}
                    onChange={(event) => rename(type.id, event.target.value)}
                    className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-xs font-medium outline-none transition focus:border-violet-500/30 focus:bg-black/20"
                  />
                  <p className="mt-1 text-[8px] text-[#5F6475]">
                    Position {index + 1}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => toggle(type.id)}
                    className={`rounded-lg px-2 py-1.5 text-[8px] font-semibold ${type.is_active ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#8A8E9E]"}`}
                  >
                    {type.is_active ? "Visible" : "Hidden"}
                  </button>
                  <button
                    onClick={() => move(type.id, -1)}
                    disabled={index === 0}
                    className="h-7 w-7 rounded-lg bg-white/[.04] text-[9px] disabled:opacity-20"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(type.id, 1)}
                    disabled={index === types.length - 1}
                    className="h-7 w-7 rounded-lg bg-white/[.04] text-[9px] disabled:opacity-20"
                  >
                    ↓
                  </button>
                  {!CORE_TYPE_IDS.has(type.id) && (
                    <button
                      onClick={() => remove(type.id)}
                      className="rounded-lg bg-red-500/10 px-2 py-1.5 text-[8px] text-red-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div
        className={`rounded-2xl border p-3 ${dirty ? "border-violet-500/20 bg-violet-500/[.05]" : "border-white/[.06] bg-[#0D1017]"}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Step n="3" />
            <div>
              <p className="text-xs font-semibold">
                Publish marketplace changes
              </p>
              <p className="mt-1 text-[9px] text-[#656A7B]">
                {dirty
                  ? "You have unsaved catalog changes."
                  : "The property catalog is up to date."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {dirty && !usingDefaults && (
              <button
                onClick={discard}
                className="h-10 rounded-xl border border-white/[.07] px-3 text-[9px] text-[#8D91A1]"
              >
                Discard
              </button>
            )}
            <button
              onClick={() => void saveTypes()}
              disabled={saving || !dirty || types.length === 0}
              className="h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35"
            >
              {saving ? "Saving…" : "Save marketplace"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Step({ n }: { n: string }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-[9px] font-bold text-violet-300">
      {n}
    </span>
  );
}
function Loading() {
  return (
    <div className="grid min-h-32 place-items-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
