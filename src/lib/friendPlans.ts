export type FriendPlan = { activity: string; when: string; timeZone: string; place: string };

const PREFIX = "Plan with Friend\n";
const MAX_ACTIVITY = 60;
const MAX_PLACE = 140;

export function createFriendPlanMessage(plan: FriendPlan) {
  const activity = plan.activity.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_ACTIVITY);
  const when = plan.when.trim().slice(0, 24);
  const timeZone = plan.timeZone.replace(/[\r\n]+/g, " ").trim().slice(0, 64);
  const place = plan.place.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_PLACE) || "Let’s decide together";
  if (!activity || !Number.isFinite(Date.parse(when)) || !timeZone || !isTimeZone(timeZone)) throw new Error("Plan details are incomplete");
  return `${PREFIX}Activity: ${activity}\nWhen: ${when}\nTime zone: ${timeZone}\nPlace: ${place}\nReply in this chat to confirm or suggest a change.`;
}

export function parseFriendPlanMessage(message: string): FriendPlan | null {
  if (!message.startsWith(PREFIX)) return null;
  const lines = message.slice(PREFIX.length).split("\n");
  const activity = lines.find((line) => line.startsWith("Activity: "))?.slice(10)?.trim();
  const when = lines.find((line) => line.startsWith("When: "))?.slice(6)?.trim();
  const timeZone = lines.find((line) => line.startsWith("Time zone: "))?.slice(11)?.trim();
  const place = lines.find((line) => line.startsWith("Place: "))?.slice(7)?.trim();
  if (!activity || activity.length > MAX_ACTIVITY || !when || !Number.isFinite(Date.parse(when)) || !timeZone || timeZone.length > 64 || !isTimeZone(timeZone) || !place || place.length > MAX_PLACE) return null;
  return { activity, when, timeZone, place };
}

export function formatFriendPlanTime(value: string, timeZone: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
}

function isTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
