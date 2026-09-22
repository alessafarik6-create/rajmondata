import { format, isToday, isTomorrow } from "date-fns";
import { cs } from "date-fns/locale";

/** Popisek data + času schůzky pro mobilní přehled (Dnes · 13:00). */
export function formatMeetingScheduleLabel(at: Date, now = new Date()): string {
  const time = format(at, "HH:mm");
  if (isToday(at)) return `Dnes · ${time}`;
  if (isTomorrow(at)) return `Zítra · ${time}`;
  void now;
  return `${format(at, "d. M.", { locale: cs })} · ${time}`;
}
