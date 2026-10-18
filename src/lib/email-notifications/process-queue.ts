import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { MAIL_DISPATCH_QUEUE } from "./dispatch";
import { sendModuleNotification } from "./module-notify";
import { defaultSubjectForEvent } from "./subjects";
import { createNotification } from "@/lib/notification-service/notification-service";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import {
  PLATFORM_ORG_CAMPAIGNS_COLLECTION,
  COMPANIES_COLLECTION,
  SUPPORT_TICKETS_COLLECTION,
} from "@/lib/firestore-collections";

const MAX_ATTEMPTS = 5;
const PROCESSING_STALE_MS = 10 * 60 * 1000;

export type MailQueueStatus =
  | "pending"
  | "processing"
  | "provider_accepted"
  | "failed";

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

async function updateCampaignEmailStatus(
  db: Firestore,
  data: Record<string, unknown>,
  sent: { ok: true; messageId?: string | null } | { ok: false; error: string },
  status: MailQueueStatus
): Promise<void> {
  const campaignId = String(data.campaignId ?? "").trim();
  const organizationId = String(data.organizationId ?? "").trim();
  if (!campaignId || !organizationId) return;

  const campRef = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(campaignId);
  const emailStatus =
    status === "provider_accepted"
      ? "provider_accepted"
      : status === "failed"
        ? "error"
        : status === "processing"
          ? "processing"
          : "queued";

  await campRef.collection("recipients").doc(organizationId).set(
    {
      emailStatus,
      emailSentAt: sent.ok ? Timestamp.now() : null,
      emailError: sent.ok ? null : sent.error?.slice(0, 500) ?? "Chyba",
      providerMessageId: sent.ok ? sent.messageId ?? null : null,
      lastBatchId: String(data.batchId ?? "") || null,
    },
    { merge: true }
  );

  const batchId = String(data.batchId ?? "").trim();
  if (batchId) {
    const batchRef = campRef.collection("sendBatches").doc(batchId);
    if (sent.ok) {
      await batchRef.set({ emailsSent: FieldValue.increment(1) }, { merge: true });
      await campRef.set({ "stats.emailsSent": FieldValue.increment(1) }, { merge: true });
    } else {
      await batchRef.set({ emailsError: FieldValue.increment(1) }, { merge: true });
      await campRef.set({ "stats.emailsError": FieldValue.increment(1) }, { merge: true });
    }
  }

  const mailJobId = String(data.mailJobId ?? "").trim();
  if (mailJobId) {
    await campRef.collection("mailJobs").doc(mailJobId).set(
      {
        status: emailStatus,
        updatedAt: FieldValue.serverTimestamp(),
        providerMessageId: sent.ok ? sent.messageId ?? null : null,
        error: sent.ok ? null : sent.error?.slice(0, 500),
        attempts: FieldValue.increment(1),
      },
      { merge: true }
    );
  }
}

async function processOneQueueDoc(
  db: Firestore,
  doc: QueryDocumentSnapshot
): Promise<{ ok: boolean; error?: string }> {
  const data = doc.data();
  const kind = String(data.kind ?? "");
  const status = String(data.status ?? "pending") as MailQueueStatus;
  const attempts = Number(data.attempts ?? 0);

  if (status === "processing") {
    const started = data.processingStartedAt as Timestamp | undefined;
    const startedMs = started?.toMillis?.() ?? 0;
    if (startedMs && Date.now() - startedMs < PROCESSING_STALE_MS) {
      return { ok: false, error: "skip_processing" };
    }
  }

  await doc.ref.set(
    {
      status: "processing",
      processingStartedAt: FieldValue.serverTimestamp(),
      attempts: attempts + 1,
    },
    { merge: true }
  );

  try {
    if (kind === "platform_campaign_email") {
      const toRaw = data.to;
      const to = Array.isArray(toRaw)
        ? [...new Set(toRaw.map((x) => String(x).trim().toLowerCase()).filter(Boolean))]
        : [];
      const subject = String(data.subject ?? "RAJMONDATA").trim();
      const html = String(data.html ?? "").trim();
      if (!to.length || !html) {
        await doc.ref.delete();
        return { ok: true };
      }
      const sent = await sendTransactionalEmail({ to, subject, html });
      if (sent.ok) {
        await updateCampaignEmailStatus(db, data, sent, "provider_accepted");
        await doc.ref.delete();
        return { ok: true };
      }
      await updateCampaignEmailStatus(db, data, sent, attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending");
      if (attempts + 1 >= MAX_ATTEMPTS) {
        await doc.ref.set(
          {
            status: "failed",
            lastError: sent.error?.slice(0, 500),
            failedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { ok: false, error: sent.error };
      }
      const backoffSec = Math.min(900, 30 * (attempts + 1));
      await doc.ref.set(
        {
          status: "pending",
          sendAt: Timestamp.fromMillis(Date.now() + backoffSec * 1000),
          lastError: sent.error?.slice(0, 500),
        },
        { merge: true }
      );
      return { ok: false, error: sent.error };
    }

    if (kind === "support_ticket_reply") {
      const to = String(data.to ?? "").trim().toLowerCase();
      const subject = String(data.subject ?? "").trim();
      const html = String(data.html ?? "").trim();
      if (!to || !html) {
        await doc.ref.delete();
        return { ok: true };
      }
      const sent = await sendTransactionalEmail({ to: [to], subject, html });
      if (sent.ok) {
        const ticketId = String(data.ticketId ?? "").trim();
        if (ticketId) {
          await db.collection(SUPPORT_TICKETS_COLLECTION).doc(ticketId).set(
            {
              lastReplyEmailStatus: "provider_accepted",
              lastReplyEmailAt: FieldValue.serverTimestamp(),
              lastReplyEmailError: null,
            },
            { merge: true }
          );
        }
        await doc.ref.delete();
        return { ok: true };
      }
      if (attempts + 1 >= MAX_ATTEMPTS) {
        await doc.ref.set({ status: "failed", lastError: sent.error }, { merge: true });
      } else {
        await doc.ref.set(
          {
            status: "pending",
            sendAt: Timestamp.fromMillis(Date.now() + 60_000 * (attempts + 1)),
            lastError: sent.error,
          },
          { merge: true }
        );
      }
      return { ok: false, error: sent.error };
    }

    if (kind === "calendar_reminder") {
      const companyId = String(data.companyId ?? "").trim();
      const p = data.payload as Record<string, unknown> | undefined;
      const eventId = String(p?.eventId ?? "").trim();
      const title = String(p?.title ?? "Událost").trim();
      const eventStartsAt = String(p?.eventStartsAt ?? "").trim();
      const offsetMinutes = Number(p?.offsetMinutes ?? 0);
      if (!companyId || !eventId) {
        await doc.ref.delete();
        return { ok: true };
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
      await pushCalendarReminderToParticipants(
        db,
        companyId,
        eventId,
        title,
        offsetMinutes,
        eventStartsAt
      );
      await doc.ref.delete();
      if (!res.ok && res.error) return { ok: false, error: res.error };
      return { ok: true };
    }

    await doc.ref.delete();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (attempts + 1 >= MAX_ATTEMPTS) {
      await doc.ref.set({ status: "failed", lastError: msg }, { merge: true });
    } else {
      await doc.ref.set(
        {
          status: "pending",
          sendAt: Timestamp.fromMillis(Date.now() + 60_000 * (attempts + 1)),
          lastError: msg,
        },
        { merge: true }
      );
    }
    return { ok: false, error: msg };
  }
}

/**
 * Zpracuje frontu naplánovaných e-mailů.
 */
export async function processDueMailDispatchQueue(
  db: Firestore,
  limit = 30
): Promise<{ processed: number; errors: string[]; skipped: number }> {
  const now = Timestamp.now();
  const errors: string[] = [];
  let processed = 0;
  let skipped = 0;

  const qs = await db
    .collection(MAIL_DISPATCH_QUEUE)
    .where("sendAt", "<=", now)
    .orderBy("sendAt", "asc")
    .limit(limit)
    .get();

  for (const doc of qs.docs) {
    const st = String(doc.data().status ?? "pending");
    if (st === "failed" || st === "provider_accepted") {
      skipped++;
      continue;
    }
    const result = await processOneQueueDoc(db, doc);
    if (result.error === "skip_processing") {
      skipped++;
      continue;
    }
    if (!result.ok && result.error) errors.push(result.error);
    processed++;
  }

  return { processed, errors, skipped };
}

/** Opakované zpracování fronty (po publikaci kampaně nebo z cronu). */
export async function drainMailDispatchQueue(
  db: Firestore,
  opts?: { maxRounds?: number; batchSize?: number }
): Promise<{ processed: number; errors: string[] }> {
  const maxRounds = opts?.maxRounds ?? 8;
  const batchSize = opts?.batchSize ?? 25;
  let processed = 0;
  const errors: string[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const r = await processDueMailDispatchQueue(db, batchSize);
    processed += r.processed;
    errors.push(...r.errors);
    if (r.processed === 0) break;
  }
  return { processed, errors: [...new Set(errors)] };
}

/** Znovu zařadí neúspěšné položky kampaně do fronty. */
export async function requeueFailedCampaignEmails(
  db: Firestore,
  campaignId: string
): Promise<number> {
  const qs = await db
    .collection(MAIL_DISPATCH_QUEUE)
    .where("kind", "==", "platform_campaign_email")
    .where("campaignId", "==", campaignId)
    .where("status", "==", "failed")
    .limit(100)
    .get();
  let n = 0;
  for (const doc of qs.docs) {
    await doc.ref.set(
      {
        status: "pending",
        sendAt: Timestamp.now(),
        attempts: 0,
        lastError: FieldValue.delete(),
      },
      { merge: true }
    );
    n++;
  }
  return n;
}
