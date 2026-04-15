import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanManageOrgEmailSettings,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { buildNotificationHtml, sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import {
  loadCompanyEmailSettings,
  resolveNotificationEmailsForModule,
} from "@/lib/email-notifications/dispatch";
import { moduleLabelCs } from "@/lib/email-notifications/subjects";
import type { EmailModuleKey } from "@/lib/email-notifications/schema";

export const dynamic = "force-dynamic";

const MODULE_KEYS: EmailModuleKey[] = [
  "orders",
  "documents",
  "invoices",
  "leads",
  "calendar",
  "warehouse",
  "attendance",
  "messages",
  "system",
];

function isModuleKey(s: string): s is EmailModuleKey {
  return MODULE_KEYS.includes(s as EmailModuleKey);
}

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

  let body: { companyId?: string; module?: string };
  try {
    body = (await request.json()) as { companyId?: string; module?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  const module = String(body.module ?? "").trim();
  if (!companyId || !callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 400 });
  }
  if (!isModuleKey(module)) {
    return NextResponse.json({ ok: false, error: "Neplatný modul." }, { status: 400 });
  }

  const loaded = await loadCompanyEmailSettings(db, companyId);
  if (!loaded) {
    return NextResponse.json({ ok: false, error: "Organizace nenalezena." }, { status: 404 });
  }
  const recipients = await resolveNotificationEmailsForModule(db, companyId, loaded, module);
  if (recipients.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Pro tento modul nejsou nastavení žádní příjemci e-mailů." },
      { status: 400 }
    );
  }

  const subject = `Test e-mailu — ${moduleLabelCs(module)}`;
  const html = buildNotificationHtml({
    moduleLabel: moduleLabelCs(module),
    title: `Test notifikací: ${moduleLabelCs(module)}`,
    lines: [
      "Toto je zkušební zpráva pro vybraný modul.",
      "Příjemci odpovídají aktuálnímu nastavení (globální nebo vlastní příjemci modulu včetně administrátorů, pokud jsou zapnutí).",
    ],
    actionUrl: null,
    companyName: null,
  });

  const sent = await sendTransactionalEmail({ to: recipients, subject, html });
  if (!sent.ok) {
    return NextResponse.json({ ok: false, error: sent.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
