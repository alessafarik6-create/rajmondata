export function formatDateCs(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("cs-CZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatTimeCs(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatSessionRangeCs(startedAt: string, endedAt: string | null): string {
  const from = formatTimeCs(startedAt);
  if (!endedAt) return `${from}–právě běží`;
  return `${from}–${formatTimeCs(endedAt)}`;
}
