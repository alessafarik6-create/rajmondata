"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  parseISO,
  startOfDay,
} from "date-fns";
import { cs } from "date-fns/locale";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  XCircle,
} from "lucide-react";
import {
  collection,
  query,
  where,
  orderBy,
  Timestamp,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  addDoc,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { useFirestore, useMemoFirebase, useCollection, useUser, useDoc, useCompany } from "@/firebase";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseFirestoreScheduledAt } from "@/lib/lead-meeting-utils";
import type { MeasurementDoc, MeasurementStatus } from "@/lib/measurements";
import { MEASUREMENT_STATUS_LABELS } from "@/lib/measurements";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  deleteEmployeeNotificationsForEvent,
  upsertEmployeeNotificationsForEvent,
  type EmployeeNotificationType,
} from "@/lib/employee-notifications";
import {
  sendModuleEmailNotificationFromBrowser,
  syncCalendarEmailRemindersFromBrowser,
} from "@/lib/email-notifications/client";
import { mergeEmailNotifications } from "@/lib/email-notifications/schema";

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

type MeetingStatus = "planned" | "done" | "cancelled";

type CalendarEvent = {
  id: string;
  at: Date;
  /** Jméno zákazníka (stejné jako dříve `title` v mřížce) */
  title: string;
  /** Krátký název / poznámka nahoře na kartě */
  headline: string;
  kind: "meeting" | "measurement";
  detail?: string;
  phone?: string;
  address?: string;
  status: MeetingStatus | "measurement";
  statusLabel: string;
  /** Tailwind barva štítku */
  badgeClass: string;
  /** Barva levého proužku / akcentu karty */
  accentClass: string;
  /** Firestore id pro update (např. lead_meetings/{id}) */
  sourceId?: string;
  /** Poznámka z dokumentu schůzky (pro editaci formuláře). */
  eventNote?: string;
  sentToAllEmployees?: boolean;
  notificationType?: EmployeeNotificationType;
  notificationMessage?: string | null;
};

function isValidCalendarEvent(e: unknown): e is CalendarEvent {
  if (e == null || typeof e !== "object") return false;
  const o = e as Partial<CalendarEvent>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.headline !== "string") return false;
  if (typeof o.statusLabel !== "string") return false;
  if (typeof o.badgeClass !== "string") return false;
  if (typeof o.accentClass !== "string") return false;
  return o.at instanceof Date && !Number.isNaN(o.at.getTime());
}

function isMeasurementDeleted(m: { deletedAt?: unknown }): boolean {
  return m.deletedAt != null;
}

function parseMeasurementTime(raw: string): Date | null {
  try {
    const d = parseISO(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function measurementVisuals(status: MeasurementStatus | undefined): {
  badgeClass: string;
  accentClass: string;
} {
  switch (status) {
    case "completed":
      return {
        badgeClass: "border-sky-200 bg-sky-100 text-sky-950",
        accentClass: "border-l-sky-500",
      };
    case "converted":
      return {
        badgeClass: "border-violet-200 bg-violet-100 text-violet-950",
        accentClass: "border-l-violet-500",
      };
    case "cancelled":
      return {
        badgeClass: "border-slate-200 bg-slate-100 text-slate-800",
        accentClass: "border-l-slate-400",
      };
    default:
      return {
        badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-950",
        accentClass: "border-l-emerald-500",
      };
  }
}

function meetingVisuals(status: MeetingStatus | undefined): {
  statusLabel: string;
  badgeClass: string;
  accentClass: string;
  titleClass: string;
} {
  switch (status) {
    case "done":
      return {
        statusLabel: "Vyřízeno",
        badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-950",
        accentClass: "border-l-emerald-500",
        titleClass: "opacity-80",
      };
    case "cancelled":
      return {
        statusLabel: "Zrušeno",
        badgeClass: "border-rose-200 bg-rose-50 text-rose-900",
        accentClass: "border-l-rose-400",
        titleClass: "line-through text-slate-500",
      };
    default:
      return {
        statusLabel: "Plánováno",
        badgeClass: "border-orange-200 bg-orange-100 text-orange-950",
        accentClass: "border-l-orange-500",
        titleClass: "",
      };
  }
}

function scheduleMobileEventCountLabel(n: number): string {
  if (n === 0) return "žádná událost";
  if (n === 1) return "1 událost";
  if (n >= 2 && n <= 4) return `${n} události`;
  return `${n} událostí`;
}

function ScheduleMobileEventCard({ ev }: { ev: CalendarEvent }) {
  const telHref = ev.phone
    ? `tel:${ev.phone.replace(/\s/g, "")}`
    : undefined;

  return (
    <article
      className={cn(
        "min-h-[44px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm border-l-[6px]",
        ev.accentClass
      )}
    >
      <div className="flex flex-col gap-3.5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Název
          </p>
          <p className="text-[1.05rem] font-semibold leading-snug text-slate-900 sm:text-lg">
            <span className={cn(ev.kind === "meeting" ? (ev as any).titleClass : "")}>
              {ev.headline}
            </span>
            {ev.sentToAllEmployees ? (
              <span className="ml-2 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 align-middle text-[10px] font-semibold text-indigo-900">
                Rozesláno
              </span>
            ) : null}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Čas</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">
              {format(ev.at, "HH:mm")}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Zákazník</p>
            <p className="text-base font-medium leading-snug text-slate-900">
              {ev.title}
            </p>
          </div>
        </div>

        {ev.address ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Adresa</p>
            <p className="text-sm leading-relaxed text-slate-800">{ev.address}</p>
          </div>
        ) : null}

        {ev.phone ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Telefon</p>
            <a
              href={telHref}
              className="inline-flex min-h-[44px] items-center text-base font-semibold text-blue-700 underline-offset-2 hover:underline active:text-blue-900"
            >
              {ev.phone}
            </a>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span
            className={cn(
              "inline-flex max-w-full rounded-full border px-3 py-1.5 text-xs font-bold leading-tight",
              ev.badgeClass
            )}
          >
            {ev.statusLabel}
          </span>
          <span
            className={cn(
              "inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold",
              ev.kind === "meeting"
                ? "border-orange-300 bg-orange-50 text-orange-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-900"
            )}
          >
            {ev.kind === "meeting" ? "Schůzka" : "Zaměření"}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CompanyScheduleCalendar({
  companyId,
}: {
  companyId: string;
}) {
  const firestore = useFirestore();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { user } = useUser();
  const { company } = useCompany();
  const emailPref = React.useMemo(
    () =>
      mergeEmailNotifications(
        (company as { emailNotifications?: unknown } | null | undefined)?.emailNotifications
      ),
    [company]
  );

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);
  const role = String(profile?.role ?? "");
  const canSendToAllEmployees =
    role === "owner" || role === "admin" || role === "manager" || role === "accountant";

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !canSendToAllEmployees) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId, canSendToAllEmployees]);
  const { data: employeesRaw = [] } = useCollection(employeesQuery);
  const employeeIds = useMemo(() => {
    const raw = Array.isArray(employeesRaw) ? employeesRaw : [];
    return raw
      .map((e: any) => String(e?.id ?? "").trim())
      .filter(Boolean);
  }, [employeesRaw]);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [mobileSelectedDay, setMobileSelectedDay] = useState(() =>
    startOfDay(new Date())
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingCustomerName, setMeetingCustomerName] = useState("");
  const [meetingPlace, setMeetingPlace] = useState("");
  const [meetingPhone, setMeetingPhone] = useState("");
  const [meetingNote, setMeetingNote] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [meetingTime, setMeetingTime] = useState(() => format(new Date(), "HH:mm"));
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>("planned");
  const [sendToAllEmployees, setSendToAllEmployees] = useState(false);
  const [notificationType, setNotificationType] =
    useState<EmployeeNotificationType>("info");
  const [notificationText, setNotificationText] = useState("");

  const monthStart = startOfMonth(visibleMonth);
  const monthEnd = endOfMonth(visibleMonth);

  const meetingsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "lead_meetings"),
      where("scheduledAt", ">=", Timestamp.fromDate(monthStart)),
      where("scheduledAt", "<=", Timestamp.fromDate(monthEnd)),
      orderBy("scheduledAt", "asc")
    );
  }, [firestore, companyId, monthStart.getTime(), monthEnd.getTime()]);

  const measurementsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const startIso = monthStart.toISOString();
    const endIso = monthEnd.toISOString();
    return query(
      collection(firestore, "companies", companyId, "measurements"),
      where("scheduledAt", ">=", startIso),
      where("scheduledAt", "<=", endIso),
      orderBy("scheduledAt", "asc")
    );
  }, [firestore, companyId, monthStart.getTime(), monthEnd.getTime()]);

  const { data: meetingsRaw = [], isLoading: meetingsLoading } =
    useCollection(meetingsQuery);
  const { data: measurementsRaw = [], isLoading: measurementsLoading } =
    useCollection(measurementsQuery);

  const events = useMemo(() => {
    const out: CalendarEvent[] = [];
    const list = Array.isArray(meetingsRaw) ? meetingsRaw : [];
    for (const raw of list as Record<string, unknown>[]) {
      const id = String(raw?.id ?? "");
      if (!id) continue;
      const at = parseFirestoreScheduledAt(raw.scheduledAt);
      if (!at) continue;
      const customerName = String(raw.customerName ?? "—");
      const note = String(raw.note ?? "").trim();
      const phone = String(raw.phone ?? "").trim();
      const place = String(raw.place ?? "").trim();
      const stRaw = String(raw.status ?? "").trim();
      const st: MeetingStatus =
        stRaw === "done" || stRaw === "cancelled" || stRaw === "planned"
          ? (stRaw as MeetingStatus)
          : "planned";
      const v = meetingVisuals(st);
      const headline = String(raw.title ?? "").trim() || note || "Schůzka";
      const sentToAllEmployees = raw?.sentToAllEmployees === true;
      const notificationType =
        String(raw?.notificationType ?? "").trim() as EmployeeNotificationType;
      const nt: EmployeeNotificationType =
        notificationType === "important" ||
        notificationType === "training" ||
        notificationType === "meeting" ||
        notificationType === "info"
          ? notificationType
          : "info";
      const notificationMessage =
        typeof raw?.notificationMessage === "string" && raw.notificationMessage.trim()
          ? raw.notificationMessage.trim()
          : null;
      out.push({
        id: `m-${id}`,
        at,
        title: customerName,
        headline,
        kind: "meeting",
        detail: note || "Schůzka",
        phone: phone || undefined,
        address: place || undefined,
        status: st,
        statusLabel: v.statusLabel,
        badgeClass: v.badgeClass,
        accentClass: v.accentClass,
        sourceId: id,
        eventNote: note,
        sentToAllEmployees,
        notificationType: nt,
        notificationMessage,
        // @ts-expect-error: internal styling field for meeting only
        titleClass: v.titleClass,
      });
    }

    const mlist = Array.isArray(measurementsRaw) ? measurementsRaw : [];
    for (const raw of mlist as (MeasurementDoc & { id?: string })[]) {
      if (!raw?.id || isMeasurementDeleted(raw)) continue;
      const st = raw.status as MeasurementStatus | undefined;
      const at = parseMeasurementTime(raw.scheduledAt);
      if (!at) continue;
      const label = MEASUREMENT_STATUS_LABELS[st ?? "planned"] ?? "Zaměření";
      const visuals = measurementVisuals(st);
      const note = String(raw.note ?? "").trim();
      const phone = String(raw.phone ?? "").trim();
      const address = String(raw.address ?? "").trim();
      out.push({
        id: `z-${raw.id}`,
        at,
        title: raw.customerName?.trim() || "—",
        headline: note || "Zaměření",
        kind: "measurement",
        detail: `Zaměření · ${label}`,
        phone: phone || undefined,
        address: address || undefined,
        status: "measurement",
        statusLabel: label,
        badgeClass: visuals.badgeClass,
        accentClass: visuals.accentClass,
      });
    }

    const valid = out.filter(isValidCalendarEvent);
    valid.sort((a, b) => a.at.getTime() - b.at.getTime());
    return valid;
  }, [meetingsRaw, measurementsRaw]);

  React.useEffect(() => {
    setMobileSelectedDay((prev) => {
      if (isSameMonth(prev, visibleMonth)) return prev;
      return startOfDay(startOfMonth(visibleMonth));
    });
  }, [visibleMonth]);

  const eventsByDayKey = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!isValidCalendarEvent(ev)) continue;
      const key = format(ev.at, "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(ev);
      m.set(key, arr);
    }
    return m;
  }, [events]);

  const mobileSelectedDayKey = format(mobileSelectedDay, "yyyy-MM-dd");
  const mobileDayEvents = useMemo(() => {
    return (eventsByDayKey.get(mobileSelectedDayKey) ?? []).filter(
      isValidCalendarEvent
    );
  }, [eventsByDayKey, mobileSelectedDayKey]);

  const monthDaysOnly = useMemo(
    () => eachDayOfInterval({ start: monthStart, end: monthEnd }),
    [monthStart, monthEnd]
  );
  const mobileGridLeadingPad = (monthStart.getDay() + 6) % 7;

  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const loading = meetingsLoading || measurementsLoading;

  const openCreateForDay = (day: Date) => {
    console.log("[calendar] open create for day", format(day, "yyyy-MM-dd"));
    setEditingEvent(null);
    setMeetingStatus("planned");
    setMeetingTitle("");
    setMeetingCustomerName("");
    setMeetingPlace("");
    setMeetingPhone("");
    setMeetingNote("");
    setMeetingDate(format(day, "yyyy-MM-dd"));
    setMeetingTime("09:00");
    setSendToAllEmployees(false);
    setNotificationType("info");
    setNotificationText("");
    setFormOpen(true);
  };

  const openEditMeeting = (ev: CalendarEvent) => {
    if (ev.kind !== "meeting") return;
    console.log("[calendar] open edit meeting", {
      calendarId: ev.id,
      sourceId: ev.sourceId,
    });
    setEditingEvent(ev);
    setMeetingStatus((ev.status as MeetingStatus) ?? "planned");
    setMeetingTitle(ev.headline || "");
    setMeetingCustomerName(ev.title || "");
    setMeetingPlace(ev.address || "");
    setMeetingPhone(ev.phone || "");
    setMeetingNote(ev.eventNote ?? "");
    setMeetingDate(format(ev.at, "yyyy-MM-dd"));
    setMeetingTime(format(ev.at, "HH:mm"));
    setSendToAllEmployees(ev.sentToAllEmployees === true);
    setNotificationType(ev.notificationType ?? "info");
    setNotificationText(ev.notificationMessage ?? "");
    setFormOpen(true);
  };

  const buildDefaultNotificationText = (title: string, dateStr: string, timeStr: string) => {
    const t = timeStr.trim();
    const d = dateStr.trim();
    return `${title}${d ? ` · ${d}` : ""}${t ? ` ${t}` : ""}`;
  };

  const saveMeeting = async () => {
    if (!firestore || !companyId) return;
    const dateStr = meetingDate.trim();
    const timeStr = meetingTime.trim();
    if (!dateStr) {
      toast({ variant: "destructive", title: "Vyberte datum" });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(timeStr)) {
      toast({ variant: "destructive", title: "Neplatný čas", description: "Zadejte čas ve formátu HH:mm." });
      return;
    }
    const d = new Date(`${dateStr}T${timeStr}:00`);
    if (Number.isNaN(d.getTime())) {
      toast({ variant: "destructive", title: "Neplatný datum a čas" });
      return;
    }
    const status: MeetingStatus = meetingStatus;
    const title = meetingTitle.trim() || "Schůzka";
    const customerName = meetingCustomerName.trim() || "—";
    setSaving(true);
    try {
      console.log("[calendar] saveMeeting start", {
        companyId,
        isEdit: Boolean(editingEvent?.sourceId),
        sendToAllEmployees,
        employeeTargetCount: employeeIds.length,
      });
      const payload = {
        companyId,
        customerName,
        place: meetingPlace.trim(),
        note: meetingNote.trim(),
        phone: meetingPhone.trim(),
        scheduledAt: Timestamp.fromDate(d),
        calendarEventType: "lead_meeting",
        title,
        status,
        sentToAllEmployees: sendToAllEmployees === true,
        notificationType: notificationType,
        notificationMessage: notificationText.trim() || null,
        updatedAt: serverTimestamp(),
        ...(status === "done" ? { completedAt: serverTimestamp(), cancelledAt: null } : {}),
        ...(status === "cancelled" ? { cancelledAt: serverTimestamp(), completedAt: null } : {}),
      } as Record<string, unknown>;

      const eventIdExisting =
        editingEvent?.kind === "meeting" && editingEvent.sourceId
          ? editingEvent.sourceId
          : null;
      let createdEventId: string | null = null;

      if (editingEvent?.kind === "meeting" && editingEvent.sourceId) {
        console.log("[calendar] lead_meeting update", editingEvent.sourceId);
        await updateDoc(
          doc(firestore, "companies", companyId, "lead_meetings", editingEvent.sourceId),
          payload as UpdateData<DocumentData>
        );
        toast({ title: "Uloženo", description: "Schůzka byla upravena." });
      } else {
        const created = await addDoc(collection(firestore, "companies", companyId, "lead_meetings"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: "dashboard",
        });
        createdEventId = created.id;
        console.log("[calendar] lead_meeting created", createdEventId);
        toast({ title: "Uloženo", description: "Schůzka byla vytvořena." });
      }

      const realEventId =
        eventIdExisting ?? createdEventId;

      const wasSentBefore = editingEvent?.sentToAllEmployees === true;
      const shouldFanout =
        canSendToAllEmployees &&
        user?.uid &&
        realEventId &&
        sendToAllEmployees === true;

      if (shouldFanout) {
        const msg =
          notificationText.trim() ||
          buildDefaultNotificationText(title, dateStr, timeStr);
        console.log("[calendar] upsert employee notifications", {
          eventId: realEventId,
          recipients: employeeIds.length,
        });
        const res = await upsertEmployeeNotificationsForEvent({
          firestore,
          companyId,
          eventId: realEventId,
          employeeIds,
          title,
          message: msg,
          type: notificationType,
          eventDate: dateStr,
          eventTime: timeStr,
          sentBy: user.uid,
          linkUrl: "/portal/employee",
        });
        console.log("[calendar] upsert employee notifications done", res);
        toast({
          title: "Akce uložena",
          description: `Upozornění odesláno: ${res.upserted} zaměstnancům.`,
        });
      } else if (
        canSendToAllEmployees &&
        user?.uid &&
        realEventId &&
        wasSentBefore &&
        sendToAllEmployees === false
      ) {
        await deleteEmployeeNotificationsForEvent({
          firestore,
          companyId,
          eventId: realEventId,
        });
        toast({
          title: "Akce uložena",
          description: "Upozornění bylo deaktivováno (smazáno) pro zaměstnance.",
        });
      } else if (sendToAllEmployees && !canSendToAllEmployees) {
        toast({
          variant: "destructive",
          title: "Nelze odeslat upozornění",
          description: "Hromadné upozornění může odeslat jen admin / vedoucí / účetní.",
        });
      }

      if (realEventId) {
        const iso = d.toISOString();
        void syncCalendarEmailRemindersFromBrowser({
          companyId,
          eventId: realEventId,
          eventStartsAtIso: iso,
          title,
          calendarKind: "meeting",
        });
        const isEditMeeting = Boolean(eventIdExisting);
        void sendModuleEmailNotificationFromBrowser({
          companyId,
          module: "calendar",
          eventKey: isEditMeeting ? "eventUpdated" : "eventCreated",
          entityId: realEventId,
          title: isEditMeeting ? `Událost upravena: ${title}` : `Nová událost: ${title}`,
          lines: [`Začátek: ${format(d, "d. M. yyyy HH:mm", { locale: cs })}`],
          actionPath: "/portal/dashboard",
        });
        if (
          emailPref.enabled &&
          emailPref.modules.calendar.enabled &&
          emailPref.modules.calendar.todayEventReminder &&
          isToday(d)
        ) {
          void sendModuleEmailNotificationFromBrowser({
            companyId,
            module: "calendar",
            eventKey: "todayEventReminder",
            entityId: realEventId,
            title: `Dnešní událost: ${title}`,
            lines: [`Začátek: ${format(d, "HH:mm", { locale: cs })}`],
            actionPath: "/portal/dashboard",
          });
        }
      }

      setFormOpen(false);
      setEditingEvent(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  const performDeleteMeeting = async () => {
    if (!firestore || !companyId) {
      setDeleteConfirmOpen(false);
      return;
    }
    const eventId = editingEvent?.sourceId;
    if (editingEvent?.kind !== "meeting" || !eventId) {
      setDeleteConfirmOpen(false);
      return;
    }
    if (!canSendToAllEmployees) {
      toast({
        variant: "destructive",
        title: "Přístup zamítnut",
        description: "Smazání může provést jen oprávněná role.",
      });
      setDeleteConfirmOpen(false);
      return;
    }

    setIsDeleting(true);
    try {
      console.log("[calendar] delete meeting", { eventId, companyId });
      await deleteDoc(doc(firestore, "companies", companyId, "lead_meetings", eventId));

      void syncCalendarEmailRemindersFromBrowser({
        companyId,
        eventId,
        eventStartsAtIso: new Date().toISOString(),
        title: "",
        calendarKind: "meeting",
        cancel: true,
      });
      void sendModuleEmailNotificationFromBrowser({
        companyId,
        module: "calendar",
        eventKey: "eventDeleted",
        entityId: eventId,
        title: `Smazaná událost: ${editingEvent?.headline?.trim() || "schůzka"}`,
        lines: [],
        actionPath: "/portal/dashboard",
      });

      let notifError: unknown = null;
      try {
        await deleteEmployeeNotificationsForEvent({ firestore, companyId, eventId });
      } catch (n) {
        notifError = n;
        console.error("[calendar] delete linked notifications failed", n);
      }

      setDeleteConfirmOpen(false);
      setFormOpen(false);
      setEditingEvent(null);

      if (notifError) {
        toast({
          title: "Záznam byl smazán",
          description:
            "Kalendářová akce byla odstraněna. Navázaná upozornění se nepodařilo smazat — zkuste to prosím znovu nebo kontaktujte administrátora.",
        });
      } else {
        toast({
          title: "Záznam byl smazán",
          description: "Akce byla odstraněna z kalendáře včetně upozornění pro zaměstnance.",
        });
      }
    } catch (e) {
      console.error("Delete event error:", e);
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const setMeetingQuickStatus = async (ev: CalendarEvent, st: MeetingStatus) => {
    if (!firestore || !companyId) return;
    if (ev.kind !== "meeting" || !ev.sourceId) return;
    try {
      await updateDoc(doc(firestore, "companies", companyId, "lead_meetings", ev.sourceId), {
        status: st,
        updatedAt: serverTimestamp(),
        ...(st === "done" ? { completedAt: serverTimestamp(), cancelledAt: null } : {}),
        ...(st === "cancelled" ? { cancelledAt: serverTimestamp(), completedAt: null } : {}),
      });
      toast({
        title: st === "done" ? "Označeno jako vyřízeno" : "Označeno jako zrušeno",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Změna stavu se nezdařila",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Kalendář schůzek a zaměření
          </h2>
          <p className="text-sm text-slate-800">
            Schůzky z poptávek a naplánovaná zaměření — měsíční přehled.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="hidden h-9 gap-2 md:inline-flex"
            onClick={() => openCreateForDay(new Date())}
          >
            <Plus className="h-4 w-4" />
            Přidat
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={() => setVisibleMonth((d) => subMonths(d, 1))}
            aria-label="Předchozí měsíc"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[160px] text-center text-sm font-medium tabular-nums text-slate-900">
            {format(visibleMonth, "LLLL yyyy", { locale: cs })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={() => setVisibleMonth((d) => addMonths(d, 1))}
            aria-label="Další měsíc"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="inline-flex shrink-0 border border-slate-200 bg-slate-100 px-3 text-slate-900 hover:bg-slate-200"
            onClick={() => {
              const t = startOfDay(new Date());
              setVisibleMonth(startOfMonth(t));
              setMobileSelectedDay(t);
            }}
          >
            Dnes
          </Button>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <span
              className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              aria-label="Načítání"
            />
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-800 md:mb-3">
              <div className="hidden flex-wrap gap-4 md:flex">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-orange-100 ring-1 ring-orange-200" />
                  Schůzka (poptávka)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-200" />
                  Zaměření
                </span>
              </div>
              <div className="flex w-full flex-wrap gap-3 md:hidden">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-orange-100 ring-1 ring-orange-200" />
                  Schůzka
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-200" />
                  Zaměření
                </span>
              </div>
              {!loading && events.length === 0 ? (
                <span className="text-slate-800">
                  V tomto měsíci nic — naplánujte v{" "}
                  <Link
                    href="/portal/leads"
                    className="font-medium text-slate-900 underline underline-offset-2 hover:no-underline"
                  >
                    Poptávkách
                  </Link>
                  .
                </span>
              ) : null}
            </div>

            {/* Mobil: výběr dne + karty událostí */}
            <div className="md:hidden">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Button type="button" className="w-full min-h-[44px] gap-2" onClick={() => openCreateForDay(mobileSelectedDay)}>
                  <Plus className="h-4 w-4" /> Přidat schůzku / akci
                </Button>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {WEEKDAYS.map((wd) => (
                  <div
                    key={wd}
                    className="py-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
                  >
                    {wd}
                  </div>
                ))}
                {Array.from({ length: mobileGridLeadingPad }).map((_, i) => (
                  <div key={`pad-${i}`} className="min-h-[52px]" aria-hidden />
                ))}
                {monthDaysOnly.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayEvents = eventsByDayKey.get(key) ?? [];
                  const hasEvents = dayEvents.length > 0;
                  const selected = isSameDay(day, mobileSelectedDay);
                  const today = isToday(day);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMobileSelectedDay(startOfDay(day))}
                      className={cn(
                        "flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 px-0.5 py-2 text-sm font-bold tabular-nums transition-colors",
                        selected
                          ? "border-orange-500 bg-orange-50 text-slate-900 shadow-md"
                          : "border-slate-200 bg-white text-slate-800 active:bg-slate-50",
                        today && !selected ? "ring-2 ring-slate-400 ring-offset-1" : ""
                      )}
                    >
                      <span>{format(day, "d.", { locale: cs })}</span>
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 rounded-full",
                          hasEvents ? "bg-orange-500" : "bg-transparent"
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex flex-col gap-1 px-0.5 sm:flex-row sm:items-end sm:justify-between">
                  <h3 className="text-lg font-bold capitalize leading-tight text-slate-900">
                    {format(mobileSelectedDay, "EEEE d. MMMM yyyy", { locale: cs })}
                  </h3>
                  <p className="text-sm font-medium text-slate-600">
                    {scheduleMobileEventCountLabel(mobileDayEvents.length)}
                  </p>
                </div>
                {mobileDayEvents.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-base leading-relaxed text-slate-600">
                    Tento den nemáte žádné naplánované schůzky ani zaměření.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {mobileDayEvents.map((ev) => (
                      <li key={ev.id}>
                        <div className="space-y-2">
                          <ScheduleMobileEventCard ev={ev} />
                          {ev.kind === "meeting" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-[44px] gap-2"
                                onClick={() => openEditMeeting(ev)}
                              >
                                Upravit
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                className="min-h-[44px] gap-2"
                                onClick={() => void setMeetingQuickStatus(ev, "done")}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                Vyřízeno
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                className="min-h-[44px] gap-2"
                                onClick={() => void setMeetingQuickStatus(ev, "cancelled")}
                              >
                                <XCircle className="h-4 w-4" />
                                Zrušit
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Desktop: klasická měsíční mřížka */}
            <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid">
              {WEEKDAYS.map((wd) => (
                <div
                  key={wd}
                  className="bg-slate-100 px-1 py-2 text-center text-xs font-semibold text-slate-900"
                >
                  {wd}
                </div>
              ))}
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayEvents = (eventsByDayKey.get(key) ?? []).filter(
                  isValidCalendarEvent
                );
                const outside = !isSameMonth(day, visibleMonth);
                const today = isToday(day);
                return (
                  <div
                    key={key}
                    className={`min-h-[92px] bg-white p-1 sm:min-h-[104px] sm:p-1.5 ${
                      outside ? "opacity-40" : ""
                    } ${today ? "ring-1 ring-inset ring-slate-400" : ""}`}
                  >
                    <div
                      className={`mb-1 text-right text-xs font-medium tabular-nums ${
                        today ? "text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {format(day, "d.", { locale: cs })}
                    </div>
                    <ul className="space-y-0.5">
                      {dayEvents.slice(0, 4).map((ev) => (
                        <li key={ev.id} className="list-none">
                          <button
                            type="button"
                            className={cn(
                              "w-full min-h-[44px] cursor-pointer truncate rounded border px-1.5 py-1 text-left text-[10px] leading-tight transition-colors sm:min-h-[36px] sm:text-[11px] text-slate-900",
                              "hover:ring-2 hover:ring-orange-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
                              ev.kind === "meeting"
                                ? ev.status === "done"
                                  ? "border-emerald-200 bg-emerald-100"
                                  : ev.status === "cancelled"
                                    ? "border-slate-200 bg-slate-100 text-slate-600 line-through"
                                    : "border-orange-200 bg-orange-100"
                                : ev.badgeClass.includes("slate")
                                  ? "border-slate-200 bg-slate-100 text-slate-700"
                                  : "border-emerald-200 bg-emerald-100"
                            )}
                            title={`${format(ev.at, "HH:mm")} — ${ev.title} — ${ev.detail ?? ""}`}
                            onClick={() => {
                              console.log("[calendar] desktop event click", {
                                id: ev.id,
                                kind: ev.kind,
                              });
                              if (ev.kind === "meeting") {
                                openEditMeeting(ev);
                              } else {
                                toast({
                                  title: "Zaměření",
                                  description: "Otevřete detail v sekci Zaměření.",
                                });
                                router.push("/portal/jobs/measurements");
                              }
                            }}
                          >
                            <span className="font-semibold tabular-nums">{format(ev.at, "HH:mm")}</span>{" "}
                            <span className="font-medium">{ev.title}</span>
                            {ev.sentToAllEmployees ? (
                              <span className="ml-1 text-[9px] font-semibold text-indigo-900">
                                · rozesláno
                              </span>
                            ) : null}
                            {ev.detail ? (
                              <span className="block truncate text-[9px] opacity-90 sm:text-[10px]">
                                {ev.detail}
                              </span>
                            ) : null}
                            {ev.kind === "meeting" ? (
                              <span className="ml-1 text-[9px] opacity-80">
                                · {ev.statusLabel}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                      {dayEvents.length > 4 ? (
                        <li className="text-[10px] text-slate-800">
                          +{dayEvents.length - 4} další
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Sheet
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditingEvent(null);
            setDeleteConfirmOpen(false);
            setIsDeleting(false);
          }
        }}
      >
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "flex w-full flex-col overflow-y-auto sm:max-w-lg",
            isMobile ? "max-h-[92vh]" : "h-full max-h-screen"
          )}
        >
          <SheetHeader>
            <SheetTitle>{editingEvent ? "Upravit schůzku / akci" : "Nová schůzka / akce"}</SheetTitle>
            <SheetDescription>
              {isMobile
                ? "Formulář v dolním panelu — datum a čas pohodlně na výšku."
                : "Boční panel — úpravy schůzky, stav a upozornění pro zaměstnance."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label>Název</Label>
              <Input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Zákazník / subjekt</Label>
              <Input value={meetingCustomerName} onChange={(e) => setMeetingCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Datum</Label>
              <Input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Čas</Label>
              <Input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Místo / adresa</Label>
              <Input value={meetingPlace} onChange={(e) => setMeetingPlace(e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Telefon</Label>
              <Input value={meetingPhone} onChange={(e) => setMeetingPhone(e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Popis / poznámka</Label>
              <Textarea rows={3} value={meetingNote} onChange={(e) => setMeetingNote(e.target.value)} />
            </div>
            <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-slate-900">
                    Odeslat jako upozornění všem zaměstnancům
                  </p>
                  <p className="text-xs text-slate-700">
                    Upozornění se zobrazí v profilu zaměstnance a v jeho sekci Upozornění.
                  </p>
                </div>
                <Switch
                  checked={sendToAllEmployees}
                  onCheckedChange={setSendToAllEmployees}
                  disabled={!canSendToAllEmployees}
                />
              </div>
              {sendToAllEmployees ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Typ upozornění</Label>
                    <Select
                      value={notificationType}
                      onValueChange={(v) =>
                        setNotificationType(v as EmployeeNotificationType)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Informace</SelectItem>
                        <SelectItem value="important">Důležité</SelectItem>
                        <SelectItem value="training">Školení</SelectItem>
                        <SelectItem value="meeting">Porada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Text upozornění (volitelné)</Label>
                    <Textarea
                      rows={2}
                      value={notificationText}
                      onChange={(e) => setNotificationText(e.target.value)}
                      placeholder="Pokud necháte prázdné, použije se název a datum/čas akce."
                    />
                  </div>
                  {!canSendToAllEmployees ? (
                    <p className="text-xs text-rose-700 sm:col-span-2">
                      Hromadné upozornění může odeslat jen admin / vedoucí / účetní.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Stav</Label>
              <Select value={meetingStatus} onValueChange={(v) => setMeetingStatus(v as MeetingStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Plánováno</SelectItem>
                  <SelectItem value="done">Vyřízeno</SelectItem>
                  <SelectItem value="cancelled">Zrušeno</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <SheetFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={saving || isDeleting}
              onClick={() => (setFormOpen(false), setEditingEvent(null))}
            >
              Zrušit
            </Button>
            {editingEvent?.kind === "meeting" && editingEvent.sourceId ? (
              <Button
                type="button"
                variant="destructive"
                className="min-h-[44px]"
                disabled={saving || isDeleting}
                onClick={() => {
                  console.log("[calendar] delete button → confirm");
                  setDeleteConfirmOpen(true);
                }}
              >
                Smazat
              </Button>
            ) : null}
            <Button
              type="button"
              className="min-h-[44px]"
              disabled={saving || isDeleting}
              onClick={() => void saveMeeting()}
            >
              {saving ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent" /> : null}
              Uložit
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) setIsDeleting(false);
        }}
      >
        <AlertDialogContent className="border-slate-200 bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat záznam z kalendáře?</AlertDialogTitle>
            <AlertDialogDescription>
              Schůzka bude trvale odstraněna z kalendáře. Navázaná upozornění zaměstnancům budou
              smazána. Tuto akci nelze vrátit zpět.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={isDeleting}>
              Zrušit
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={() => void performDeleteMeeting()}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mažu…
                </>
              ) : (
                "Smazat záznam"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
