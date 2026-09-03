import { WORKER_OCCUPATION_LABELS } from "@/types";

const OCCUPATION_RULES: Array<[RegExp, string]> = [
  [/hair\s*styl|hairdress|salon|beauty.*hair/i, "Hairstylist"],
  [/barb/i, "Barber"],
  [/electr|wiring/i, "Electrician"],
  [/plumb/i, "Plumber"],
  [/clean/i, "Cleaner"],
  [/carpent|woodwork|furniture/i, "Carpenter"],
  [/tailor|fashion|sew/i, "Tailor"],
  [/generator/i, "Generator Technician"],
  [/air\s*condition|\bac\b/i, "AC Technician"],
  [/internet|network|router/i, "Network Installer"],
  [/moving|delivery|logistic/i, "Mover"],
  [/security|guard/i, "Security Professional"],
  [/water\s*supply/i, "Water Supplier"],
  [/handyman|repairs?/i, "Handyperson"],
  [/auto|mechanic|vehicle/i, "Auto Technician"],
  [/garden|landscap/i, "Gardener"],
  [/health|caregiv/i, "Caregiver"],
  [/education|tutor|lesson/i, "Tutor"],
  [/event|decorat/i, "Event Professional"],
  [/tech|computer|phone/i, "IT Technician"],
  [/agric|farm/i, "Agricultural Professional"],
];

export function occupationForService(service?: string | null, specialty?: string | null) {
  const current = String(service || "").trim();
  const canonical = WORKER_OCCUPATION_LABELS[current.toLowerCase()];
  if (canonical) return canonical;
  const combined = `${specialty || ""} ${current}`.trim();
  const matched = OCCUPATION_RULES.find(([pattern]) => pattern.test(combined));
  if (matched) return matched[1];
  if (current && !/service|category|home|lifestyle|other/i.test(current)) return current;
  return specialty?.trim() || "Service professional";
}

export function workerOccupation(worker: {
  worker_occupation?: string | null;
  worker_skills?: string[] | null;
}) {
  const skills = Array.isArray(worker.worker_skills) ? worker.worker_skills : [];
  return occupationForService(worker.worker_occupation, skills.at(-1));
}

export function workerServiceNames(worker: {
  worker_occupation?: string | null;
  worker_skills?: string[] | null;
}) {
  const occupation = workerOccupation(worker).toLowerCase();
  const values = Array.isArray(worker.worker_skills) ? [...worker.worker_skills] : [];
  const legacyService = String(worker.worker_occupation || "").trim();
  if (/service|home|lifestyle|beauty|event|technology|security|education|agriculture|cleaning/i.test(legacyService)) {
    values.unshift(legacyService);
  }
  return values.filter((value, index, all) => {
    const clean = String(value || "").trim();
    return clean && clean.toLowerCase() !== occupation && all.findIndex((item) => String(item).trim().toLowerCase() === clean.toLowerCase()) === index;
  });
}
