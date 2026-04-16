import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { buildNotificationHtml, sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { resolveGlobalRecipientEmails, loadCompanyEmailSettings } from "@/lib/email-notifications/dispatch";
import { defaultSubjectForEvent, moduleLabelCs } from "@/lib/email-notifications/subjects";

export const dynamic = "force-dynamic";

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
  if (!callerCanManageOrgEmailSettings(caller)) {
    return NextResponse.json({ ok: false, error: "Pouze administrátor organizace." }, { status: 403 });
  }

  let body: { companyId?: string };
  try {
    body = (await request.json()) as { companyId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId || !callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 400 });
  }

  const loaded = await loadCompanyEmailSettings(db, companyId);
  if (!loaded) {
    return NextResponse.json({ ok: false, error: "Organizace nenalezena." }, { status: 404 });
  }
  const recipients = await resolveGlobalRecipientEmails(db, companyId, loaded);
  if (recipients.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Nejsou nastavení žádní příjemci e-mailů." },
      { status: 400 }
    );
  }

  const subject = defaultSubjectForEvent("system", "test");
  const html = buildNotificationHtml({
    moduleLabel: moduleLabelCs("system"),
    title: "Test e-mailových notifikací",
    lines: [
      "Toto je zkušební zpráva z nastavení organizace.",
      "Pokud ji vidíte, odesílání přes Resend funguje.",
    ],
    actionUrl: null,
    companyName: null,
  });

  const sent = await sendTransactionalEmail({ to: recipients, subject, html });
  if (!sent.ok) {
    return NextResponse.json(
      { ok: false, error: sent.error, detail: sent.detail },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
