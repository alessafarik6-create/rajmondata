import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanTriggerOrgNotifications,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { dispatchOrgModuleEmail } from "@/lib/email-notifications/dispatch";
import type { EmailModuleKey } from "@/lib/email-notifications/schema";

export const dynamic = "force-dynamic";

const MODULES: EmailModuleKey[] = [
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

type Body = {
  companyId?: string;
  module?: string;
  eventKey?: string;
  entityId?: string;
  title?: string;
  lines?: string[];
  actionPath?: string | null;
  subjectOverride?: string | null;
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
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const module = body.module as EmailModuleKey;
  const eventKey = String(body.eventKey ?? "").trim();
  const title = String(body.title ?? "").trim();

  if (!companyId || !module || !eventKey || !title) {
    return NextResponse.json({ ok: false, error: "Chybí povinná pole." }, { status: 400 });
  }
  if (!callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Nemáte přístup k organizaci." }, { status: 403 });
  }
  if (!MODULES.includes(module)) {
    return NextResponse.json({ ok: false, error: "Neplatný modul." }, { status: 400 });
  }

  const lines = Array.isArray(body.lines)
    ? body.lines.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const entityId = body.entityId ? String(body.entityId).trim() : undefined;
  const actionPath =
    body.actionPath === null || body.actionPath === undefined
      ? undefined
      : String(body.actionPath).trim() || undefined;
  const subjectOverride =
    typeof body.subjectOverride === "string" && body.subjectOverride.trim()
      ? body.subjectOverride.trim()
      : undefined;

  const result = await dispatchOrgModuleEmail(db, {
    companyId,
    module,
    eventKey,
    entityId,
    title,
    lines,
    actionPath,
    subjectOverride,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Odeslání se nezdařilo." },
      { status: 500 }
    );
  }
  return NextResponse.json({
    ok: true,
    skipped: result.skipped ?? null,
  });
}
