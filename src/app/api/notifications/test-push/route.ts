import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { createNotification } from "@/lib/notification-service/notification-service";

export async function POST(request: NextRequest) {
  const auth = getAdminAuth();
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Auth není k dispozici." }, { status: 503 });
  }

  const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "Chybí token." }, { status: 401 });
  }

  let uid: string;
  let companyId = "";
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný token." }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { companyId?: string };
    companyId = String(body.companyId ?? "").trim();
  } catch {
    /* empty */
  }

  const result = await createNotification({
    organizationId: companyId,
    recipientUserId: uid,
    type: "SYSTEM_ALERT",
    title: "RAJMONDATA",
    body: "Test oznámení funguje.",
    url: "/portal/notifications",
    priority: "NORMAL",
    eventId: `test-push:${uid}:${Math.floor(Date.now() / 60_000)}`,
    source: "api/notifications/test-push",
    forcePush: true,
  });

  if (!result.inboxId && result.skippedDuplicate) {
    return NextResponse.json({
      ok: true,
      message: "Test již byl odeslán v poslední minutě.",
      pushOk: result.pushOk,
    });
  }

  return NextResponse.json({
    ok: true,
    message:
      result.pushOk > 0
        ? "Test odeslán."
        : "In-app záznam vytvořen, push se nepodařilo doručit (zkontrolujte subscription a VAPID).",
    pushAttempted: result.pushAttempted,
    pushOk: result.pushOk,
    inboxId: result.inboxId,
  });
}
