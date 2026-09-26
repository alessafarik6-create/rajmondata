import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  createNotification,
  ensureWebPushVapid,
} from "@/lib/notification-service/notification-service";
import { sendPushToSubscriptions } from "@/lib/notification-service/push-delivery";

export async function POST(request: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) {
    return NextResponse.json({ ok: false, error: "Auth není k dispozici." }, { status: 503 });
  }

  const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "Chybí token." }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný token." }, { status: 401 });
  }

  let companyId = "";
  let scope: "current" | "all" = "all";
  let currentEndpoint: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      companyId?: string;
      scope?: string;
      currentEndpoint?: string;
    };
    companyId = String(body.companyId ?? "").trim();
    if (body.scope === "current") scope = "current";
    currentEndpoint =
      typeof body.currentEndpoint === "string" ? body.currentEndpoint.trim() : null;
  } catch {
    /* empty */
  }

  if (!companyId) {
    const userSnap = await db.collection("users").doc(uid).get();
    companyId = String(userSnap.data()?.companyId ?? userSnap.data()?.organizationId ?? "").trim();
  }

  const eventId = `test-push:${uid}:${Math.floor(Date.now() / 60_000)}:${scope}`;
  const title = "RAJMONDATA";
  const bodyText =
    scope === "current"
      ? "Test push na tomto zařízení."
      : "Test push na všechna vaše zařízení.";

  const result = await createNotification({
    organizationId: companyId,
    recipientUserId: uid,
    type: "SYSTEM_ALERT",
    title,
    body: bodyText,
    url: "/portal/notifications",
    priority: "NORMAL",
    eventId,
    source: "api/notifications/test-push",
    forcePush: scope === "all",
    skipPush: scope === "current",
  });

  if (!result.inboxId && result.skippedDuplicate) {
    return NextResponse.json({
      ok: true,
      message: "Test již byl odeslán v poslední minutě.",
      pushOk: result.pushOk,
      pushAttempted: result.pushAttempted,
    });
  }

  let pushAttempted = result.pushAttempted;
  let pushOk = result.pushOk;

  if (scope === "current") {
    if (!currentEndpoint) {
      return NextResponse.json({
        ok: false,
        error: "Chybí subscription tohoto zařízení — použijte „Obnovit push oznámení“.",
      });
    }
    if (!ensureWebPushVapid()) {
      return NextResponse.json({
        ok: false,
        error: "VAPID není nakonfigurováno na serveru.",
      });
    }
    const batch = await sendPushToSubscriptions({
      db,
      recipientUserId: uid,
      organizationId: companyId || null,
      onlyEndpoint: currentEndpoint,
      payload: {
        title,
        body: bodyText,
        url: "/portal/notifications",
        tag: `test-${eventId}`,
        priority: "NORMAL",
        eventType: "SYSTEM_ALERT",
      },
    });
    pushAttempted = batch.pushAttempted;
    pushOk = batch.pushOk;
  }

  return NextResponse.json({
    ok: true,
    message:
      pushOk > 0
        ? scope === "current"
          ? "Test odeslán na toto zařízení."
          : "Test odeslán na všechna aktivní zařízení."
        : "In-app záznam vytvořen, push se nepodařilo doručit (zkontrolujte subscription a VAPID).",
    pushAttempted,
    pushOk,
    inboxId: result.inboxId,
    scope,
  });
}
