import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { runSecretaryTool, type SecretaryToolName } from "@/lib/ai/secretary/tools/run-tool";

export const dynamic = "force-dynamic";

const TOOL_NAMES = new Set<string>([
  "getCalendarEvents",
  "proposeCreateCalendarEvent",
  "confirmPendingAction",
  "searchCustomers",
  "searchJobs",
  "getTodayOverview",
]);

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

  let body: { companyId?: string; toolName?: string; arguments?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? caller.companyId).trim();
  if (companyId !== caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const toolName = String(body.toolName ?? "").trim();
  if (!TOOL_NAMES.has(toolName)) {
    return NextResponse.json({ ok: false, error: "Neznámý nástroj." }, { status: 400 });
  }

  const result = await runSecretaryTool(
    db,
    caller,
    companyId,
    toolName as SecretaryToolName,
    body.arguments ?? {}
  );
  return NextResponse.json(result);
}
