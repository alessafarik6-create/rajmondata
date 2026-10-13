export type PresenceState = "online" | "idle" | "offline";

/** Heartbeat klienta cca každých 30 s — online do ~45 s od poslední interakce / heartbeat. */
export const PRESENCE_ONLINE_MS = 45_000;
/** Nečinný: aplikace otevřená, ale bez interakce. */
export const PRESENCE_IDLE_MS = 5 * 60_000;
/** Po této době bez heartbeat považuj relaci za ukončenou (i když isActive). */
export const PRESENCE_SESSION_STALE_MS = 2 * 60_000;

export function timestampToMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return Date.parse(v);
  return null;
}

export function resolvePresenceState(
  lastSeenMs: number | null,
  lastInteractionMs: number | null,
  nowMs = Date.now()
): PresenceState {
  const interaction = lastInteractionMs ?? lastSeenMs;
  const heartbeat = lastSeenMs;
  const latest = Math.max(interaction ?? 0, heartbeat ?? 0);
  if (!latest) return "offline";
  const since = nowMs - latest;
  if (since > PRESENCE_SESSION_STALE_MS) return "offline";
  if (since <= PRESENCE_ONLINE_MS) return "online";
  if (since <= PRESENCE_IDLE_MS) return "idle";
  return "offline";
}

export function formatRelativeCs(fromMs: number, nowMs = Date.now()): string {
  const diff = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (diff < 10) return "právě teď";
  if (diff < 60) return `před ${diff} s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `před ${h} h`;
  return new Date(fromMs).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    dateStyle: "short",
    timeStyle: "short",
  });
}
