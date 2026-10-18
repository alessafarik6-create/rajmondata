import type { PlatformConsultationBooking, PlatformConsultationSettings } from "./consultation-types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function generateConsultationTimeSlots(settings: PlatformConsultationSettings): string[] {
  const dur = settings.slotDurationMinutes;
  const breakM = settings.breakMinutes;
  const step = dur + breakM;
  const out: string[] = [];
  for (let m = settings.slotStartHour * 60; m + dur <= settings.slotEndHour * 60; m += step) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    out.push(`${pad(h)}:${pad(min)}`);
  }
  return out;
}

export function isWorkDay(dateYmd: string, settings: PlatformConsultationSettings): boolean {
  if (settings.blockedDates.includes(dateYmd)) return false;
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const dow = new Date(y, mo - 1, d).getDay();
  return settings.workDays.includes(dow);
}

export function availableSlotsForDate(
  dateYmd: string,
  settings: PlatformConsultationSettings,
  existing: Pick<PlatformConsultationBooking, "dateYmd" | "timeSlot" | "status">[]
): string[] {
  if (!isWorkDay(dateYmd, settings)) return [];
  const dayBookings = existing.filter(
    (b) => b.dateYmd === dateYmd && b.status !== "cancelled"
  );
  if (dayBookings.length >= settings.maxBookingsPerDay) return [];
  const taken = new Set(dayBookings.map((b) => b.timeSlot));
  return generateConsultationTimeSlots(settings).filter((s) => !taken.has(s));
}
