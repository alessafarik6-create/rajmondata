import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { MAIL_DISPATCH_QUEUE } from "./dispatch";
import { sendModuleNotification } from "./module-notify";
import { defaultSubjectForEvent } from "./subjects";
import { createNotification } from "@/lib/notification-service/notification-service";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

async function pushCalendarReminderToParticipants(
  db: Firestore,
  companyId: string,
  eventId: string,
  title: string,
  offsetMinutes: number,
  eventStartsAt: string
): Promise<void> {
  const evRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("lead_meetings")
    .doc(eventId);
  const snap = await evRef.get();
  if (!snap.exists) return;
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data) return;
  const status = String(data.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "canceled") return;

  const recipientUids = new Set<string>();
  const createdBy = String(data.createdBy ?? "").trim();
  if (createdBy) recipientUids.add(createdBy);

  const assigned = Array.isArray(data.assignedEmployeeIds) ? data.assignedEmployeeIds : [];
  for (const rawEmpId of assigned) {
    const empId = String(rawEmpId ?? "").trim();
    if (!empId) continue;
    const empSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("employees")
      .doc(empId)
      .get();
    const emp = empSnap.data() as { authUserId?: string; userId?: string } | undefined;
    const uid = String(emp?.authUserId ?? emp?.userId ?? "").trim();
    if (uid) recipientUids.add(uid);
  }

  const start = eventStartsAt ? new Date(eventStartsAt) : null;
  const startLabel =
    start && !Number.isNaN(start.getTime())
      ? start.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" })
      : "—";
  const isInstall = String(data.calendarEventType ?? "") === "installation";
  const pushTitle =
    offsetMinutes >= 1440
      ? isInstall
        ? "Montáž zítra"
        : "Schůzka zítra"
      : offsetMinutes >= 60
        ? `Schůzka za ${Math.round(offsetMinutes / 60)} h`
        : `Schůzka za ${offsetMinutes} min`;

  for (const uid of recipientUids) {
    await createNotification({
      recipientUserId: uid,
      organizationId: companyId,
      type: "MEETING_REMINDER",
      title: pushTitle,
      body: `${startLabel} – ${title}`,
      url: `/portal/schedule?event=${encodeURIComponent(eventId)}`,
      eventId: `meeting:${eventId}:reminder:${offsetMinutes}`,
      priority: "NORMAL",
    });
  }
}

/**
 * Zpracuje frontu naplánovaných e-mailů (např. připomenutí kalendáře).
 * Volat z cronu nebo periodické úlohy s autorizací.
 */
export async function processDueMailDispatchQueue(
  db: Firestore,
  limit = 30
): Promise<{ processed: number; errors: string[] }> {
  const now = Timestamp.now();
  const errors: string[] = [];
  let processed = 0;
  const qs = await db
    .collection(MAIL_DISPATCH_QUEUE)
    .where("sendAt", "<=", now)
    .orderBy("sendAt", "asc")
    .limit(limit)
    .get();

  for (const doc of qs.docs) {
    const data = doc.data();
    const kind = String(data.kind ?? "");
    try {
      if (kind === "calendar_reminder") {
        const companyId = String(data.companyId ?? "").trim();
        const p = data.payload as Record<string, unknown> | undefined;
        const eventId = String(p?.eventId ?? "").trim();
        const title = String(p?.title ?? "Událost").trim();
        const eventStartsAt = String(p?.eventStartsAt ?? "").trim();
        const offsetMinutes = Number(p?.offsetMinutes ?? 0);
        if (!companyId || !eventId) {
          await doc.ref.delete();
          processed++;
          continue;
        }
        const startLabel = eventStartsAt
          ? new Date(eventStartsAt).toLocaleString("cs-CZ", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "—";
        const subject = defaultSubjectForEvent("calendar", "reminder");
        const res = await sendModuleNotification(db, {
          companyId,
          module: "calendar",
          eventKey: "reminder",
          entityId: eventId,
          title: `Připomenutí: ${title}`,
          lines: [
            `Začátek události: ${startLabel}`,
            offsetMinutes > 0 ? `Odesláno ${offsetMinutes} min před začátkem.` : "",
          ].filter(Boolean),
          actionPath: `/portal/schedule?event=${encodeURIComponent(eventId)}`,
          subjectOverride: subject,
        });
        if (!res.ok && res.error) errors.push(res.error);
        await pushCalendarReminderToParticipants(
          db,
          companyId,
          eventId,
          title,
          offsetMinutes,
          eventStartsAt
        );
      }
      await doc.ref.delete();
      processed++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      try {
        await doc.ref.delete();
      } catch {
        /* ignore */
      }
      processed++;
    }
  }

  return { processed, errors };
}
