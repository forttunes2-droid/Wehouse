import { useEffect, useMemo, useState } from "react";
import {
  getServiceCategories,
  getServiceSubcategories,
  createServiceCategory,
  createServiceSubcategory,
  deleteServiceCategory,
  deleteServiceSubcategory,
  updateServiceCategory,
  updateServiceSubcategory,
} from "@/lib/supabase";
import type { Profile, ServiceCategory, ServiceSubcategory } from "@/types";
import { toast } from "sonner";

export default function ServiceCategoryManager({
  profile,
}: {
  profile: Profile;
}) {
  void profile;
  const [categories, setCategories] = useState<ServiceCategory[]>([]),
    [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]),
    [loading, setLoading] = useState(true),
    [newCategory, setNewCategory] = useState(""),
    [newService, setNewService] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [saving, setSaving] = useState(false),
    [renameTarget, setRenameTarget] = useState<{
      type: "category" | "service";
      id: string;
      name: string;
    } | null>(null),
    [deleteTarget, setDeleteTarget] = useState<{
      type: "category" | "service";
      id: string;
      name: string;
    } | null>(null);
  async function load(preferred?: string) {
    setLoading(true);
    const [{ categories: cats }, { subcategories: subs }] = await Promise.all([
      getServiceCategories(true),
      getServiceSubcategories(undefined, true),
    ]);
    const nextCats = cats || [];
    setCategories(nextCats);
    setSubcategories(subs || []);
    setSelectedId((current) =>
      preferred && nextCats.some((c) => c.id === preferred)
        ? preferred
        : nextCats.some((c) => c.id === current)
          ? current
          : nextCats[0]?.id || "",
    );
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);
  const selected = useMemo(
    () => categories.find((c) => c.id === selectedId) || null,
    [categories, selectedId],
  );
  const services = useMemo(
    () =>
      subcategories
        .filter((s) => s.category_id === selectedId)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [subcategories, selectedId],
  );
  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      return toast.error("That category already exists");
    setSaving(true);
    const { category, error } = await createServiceCategory(
      name,
      "",
      categories.length + 1,
    );
    setSaving(false);
    if (error || !category)
      return toast.error(error?.message || "Could not add category");
    setNewCategory("");
    toast.success("Category added");
    await load(category.id);
  }
  async function addService() {
    const name = newService.trim();
    if (!selectedId || !name) return;
    if (services.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      return toast.error("That service already exists in this category");
    setSaving(true);
    const { error } = await createServiceSubcategory(
      selectedId,
      name,
      "",
      services.length + 1,
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    setNewService("");
    toast.success("Service added");
    await load(selectedId);
  }
  async function toggleCategory(cat: ServiceCategory) {
    const { error } = await updateServiceCategory(cat.id, {
      is_active: !cat.is_active,
    });
    if (error) return toast.error(error.message);
    await load(cat.id);
  }
  async function toggleService(service: ServiceSubcategory) {
    const { error } = await updateServiceSubcategory(service.id, {
      is_active: !service.is_active,
    });
    if (error) return toast.error(error.message);
    await load(selectedId);
  }
  async function rename() {
    if (!renameTarget?.name.trim()) return;
    setSaving(true);
    const result =
      renameTarget.type === "category"
        ? await updateServiceCategory(renameTarget.id, {
            name: renameTarget.name.trim(),
          })
        : await updateServiceSubcategory(renameTarget.id, {
            name: renameTarget.name.trim(),
          });
    setSaving(false);
    if (result.error) return toast.error(result.error.message);
    toast.success("Service name updated");
    setRenameTarget(null);
    await load(selectedId);
  }
  async function remove() {
    if (!deleteTarget) return;
    setSaving(true);
    const error =
      deleteTarget.type === "category"
        ? (await deleteServiceCategory(deleteTarget.id)).error
        : (await deleteServiceSubcategory(deleteTarget.id)).error;
    setSaving(false);
    if (error) return toast.error(error.message);
    const wasCategory = deleteTarget.type === "category";
    setDeleteTarget(null);
    toast.success(wasCategory ? "Category removed" : "Service removed");
    await load(wasCategory ? undefined : selectedId);
  }
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-3">
        <div className="flex items-start gap-3">
          <Step n="1" />
          <div>
            <p className="text-xs font-semibold">Create service groups</p>
            <p className="mt-1 text-[9px] leading-relaxed text-[#6E7487]">
              Examples: Electrical, Plumbing, Cleaning. Users see these first
              when looking for a worker.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCategory();
            }}
            placeholder="Add a service group"
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40"
          />
          <button
            onClick={() => void addCategory()}
            disabled={saving || !newCategory.trim()}
            className="h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
      {categories.length === 0 ? (
        <Empty text="Add your first service group to start building the worker marketplace." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(190px,.75fr)_minmax(0,1.25fr)]">
          <section className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#0D1017]">
            <div className="border-b border-white/[.05] px-3 py-3">
              <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#626779]">
                Service groups
              </p>
            </div>
            <div className="max-h-[430px] space-y-1 overflow-y-auto p-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedId(cat.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${selectedId === cat.id ? "bg-violet-500/10" : "hover:bg-white/[.03]"}`}
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${cat.is_active ? "bg-emerald-400" : "bg-[#444A5A]"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-xs font-medium ${selectedId === cat.id ? "text-violet-100" : "text-[#D5D7DF]"}`}
                    >
                      {cat.name}
                    </p>
                    <p className="mt-0.5 text-[8px] text-[#606577]">
                      {
                        subcategories.filter((s) => s.category_id === cat.id)
                          .length
                      }{" "}
                      services
                    </p>
                  </div>
                  <span className="text-[#555B6B]">›</span>
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
            {selected && (
              <>
                <div className="flex flex-col gap-3 border-b border-white/[.05] pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Step n="2" />
                      <p className="text-sm font-semibold">{selected.name}</p>
                    </div>
                    <p className="mt-2 text-[9px] leading-relaxed text-[#666B7D]">
                      Add the specific jobs workers can offer inside this group.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setRenameTarget({
                          type: "category",
                          id: selected.id,
                          name: selected.name,
                        })
                      }
                      className="rounded-xl bg-violet-500/10 px-3 py-2 text-[9px] font-semibold text-violet-200"
                    >
                      Edit name
                    </button>
                    <button
                      onClick={() => void toggleCategory(selected)}
                      className={`rounded-xl px-3 py-2 text-[9px] font-semibold ${selected.is_active ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#8B8F9E]"}`}
                    >
                      {selected.is_active ? "Visible" : "Hidden"}
                    </button>
                    <button
                      onClick={() =>
                        setDeleteTarget({
                          type: "category",
                          id: selected.id,
                          name: selected.name,
                        })
                      }
                      className="rounded-xl bg-red-500/10 px-3 py-2 text-[9px] font-semibold text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {renameTarget?.type === "category" && (
                  <RenameEditor
                    value={renameTarget.name}
                    onChange={(name) =>
                      setRenameTarget((current) =>
                        current ? { ...current, name } : current,
                      )
                    }
                    onCancel={() => setRenameTarget(null)}
                    onSave={() => void rename()}
                    saving={saving}
                  />
                )}
                <div className="mt-4 flex gap-2">
                  <input
                    value={newService}
                    onChange={(e) => setNewService(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addService();
                    }}
                    placeholder={`Add a service inside ${selected.name}`}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40"
                  />
                  <button
                    onClick={() => void addService()}
                    disabled={saving || !newService.trim()}
                    className="h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  {services.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/[.08] p-6 text-center text-[10px] text-[#656A7B]">
                      No specific services in this group yet.
                    </div>
                  ) : (
                    services.map((service) => (
                      <div key={service.id}>
                        <div
                          className={`flex items-center gap-3 rounded-xl border border-white/[.05] bg-[#151821] p-3 ${!service.is_active ? "opacity-60" : ""}`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">
                              {service.name}
                            </p>
                            <p className="mt-1 text-[8px] text-[#5E6375]">
                              Shown to workers and customers
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              setRenameTarget({
                                type: "service",
                                id: service.id,
                                name: service.name,
                              })
                            }
                            className="rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-[8px] text-violet-200"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void toggleService(service)}
                            className={`rounded-lg px-2.5 py-1.5 text-[8px] font-semibold ${service.is_active ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#8A8E9E]"}`}
                          >
                            {service.is_active ? "On" : "Off"}
                          </button>
                          <button
                            onClick={() =>
                              setDeleteTarget({
                                type: "service",
                                id: service.id,
                                name: service.name,
                              })
                            }
                            className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[8px] text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                        {renameTarget?.type === "service" &&
                          renameTarget.id === service.id && (
                            <RenameEditor
                              value={renameTarget.name}
                              onChange={(name) =>
                                setRenameTarget((current) =>
                                  current ? { ...current, name } : current,
                                )
                              }
                              onCancel={() => setRenameTarget(null)}
                              onSave={() => void rename()}
                              saving={saving}
                            />
                          )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {deleteTarget && (
        <div className="rounded-2xl border border-red-500/15 bg-red-500/[.05] p-4">
          <p className="text-xs font-semibold text-red-200">
            Remove “{deleteTarget.name}”?
          </p>
          <p className="mt-1 text-[9px] leading-relaxed text-red-200/60">
            {deleteTarget.type === "category"
              ? "This also removes its specific services."
              : "This service will no longer be available for new selection."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-white/[.07] px-3 py-2 text-[9px]"
            >
              Keep it
            </button>
            <button
              onClick={() => void remove()}
              disabled={saving}
              className="rounded-xl bg-red-500 px-3 py-2 text-[9px] font-semibold disabled:opacity-40"
            >
              {saving ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function RenameEditor({
  value,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="mt-2 flex gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.04] p-2">
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 flex-1 rounded-lg border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none"
      />
      <button onClick={onCancel} className="px-3 text-[9px] text-[#8C91A1]">
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving || !value.trim()}
        className="rounded-lg bg-violet-500 px-3 text-[9px] font-semibold disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
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
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] p-8 text-center text-[10px] text-[#666B7C]">
      {text}
    </div>
  );
}
