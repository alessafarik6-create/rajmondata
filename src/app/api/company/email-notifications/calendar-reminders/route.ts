import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanTriggerOrgNotifications,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import {
  deleteCalendarReminderQueueForEvent,
  syncCalendarRemindersForEvent,
} from "@/lib/email-notifications/dispatch";

export const dynamic = "force-dynamic";

type Body = {
  companyId?: string;
  eventId?: string;
  eventStartsAtIso?: string;
  title?: string;
  calendarKind?: "meeting" | "measurement";
  /** Pokud true, smaže frontu připomenutí (např. po smazání události). */
  cancel?: boolean;
};

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }
  if (!callerCanTriggerOrgNotifications(caller)) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const eventId = String(body.eventId ?? "").trim();
  if (!companyId || !eventId || !callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Chybí údaje nebo přístup." }, { status: 400 });
  }

  if (body.cancel === true) {
    await deleteCalendarReminderQueueForEvent(db, eventId);
    return NextResponse.json({ ok: true });
  }

  const eventStartsAtIso = String(body.eventStartsAtIso ?? "").trim();
  const title = String(body.title ?? "Událost").trim();
  const calendarKind = body.calendarKind === "measurement" ? "measurement" : "meeting";

  if (!eventStartsAtIso) {
    return NextResponse.json({ ok: false, error: "Chybí čas události." }, { status: 400 });
  }

  await syncCalendarRemindersForEvent(db, companyId, {
    eventId,
    eventStartsAtIso,
    title,
    calendarKind,
  });
  return NextResponse.json({ ok: true });
}
