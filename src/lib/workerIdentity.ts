import { workerOccupation } from "@/lib/workerTaxonomy";

export type WorkerIdentitySource = {
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  worker_occupation?: string | null;
  worker_skills?: string[] | null;
};

export function workerDisplayName(worker: WorkerIdentitySource) {
  return (
    String(worker.full_name || "").trim() ||
    String(worker.username || "").trim().replace(/^@/, "") ||
    "Professional"
  );
}

export function workerAvatarUrl(worker: WorkerIdentitySource) {
  return String(worker.avatar_url || "").trim() || null;
}

export function workerInitial(worker: WorkerIdentitySource) {
  return workerDisplayName(worker).charAt(0).toUpperCase() || "W";
}

export function workerRoleLabel(worker: WorkerIdentitySource) {
  return workerOccupation(worker);
}
