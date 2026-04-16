import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { MAIL_DISPATCH_QUEUE } from "./dispatch";
import { sendModuleNotification } from "./module-notify";
import { defaultSubjectForEvent } from "./subjects";

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
          actionPath: "/portal/dashboard",
          subjectOverride: subject,
        });
        if (!res.ok && res.error) errors.push(res.error);
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
