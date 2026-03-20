/** Čas ve formátu „HH:mm“ → minuty od půlnoci. */
export function minutesFromHm(s: string): number {
  const t = s.trim();
  const [h, m = "0"] = t.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

/** Rozdíl hodin mezi časy od–do (stejný den). */
export function hoursBetween(startHm: string, endHm: string): number {
  const a = minutesFromHm(startHm);
  const b = minutesFromHm(endHm);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}
