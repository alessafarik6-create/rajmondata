import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import {
  listModuleUserAssignmentIds,
  setModuleUserAssignment,
} from "@/lib/platform-module-assignments.server";

export const dynamic = "force-dynamic";

function isCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const { id } = await params;
  const moduleCode = String(new URL(request.url).searchParams.get("moduleCode") ?? "").trim();
  if (!isCode(moduleCode)) return NextResponse.json({ error: "moduleCode" }, { status: 400 });
  const userIds = await listModuleUserAssignmentIds(db, id, moduleCode);
  return NextResponse.json({ ok: true, userIds });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const { id } = await params;
  const body = (await request.json()) as { moduleCode?: string; userId?: string; active?: boolean };
  const moduleCode = String(body.moduleCode ?? "").trim();
  const userId = String(body.userId ?? "").trim();
  if (!isCode(moduleCode) || !userId) {
    return NextResponse.json({ error: "Neplatná data." }, { status: 400 });
  }
  await setModuleUserAssignment({
    db,
    organizationId: id,
    moduleCode,
    userId,
    active: body.active !== false,
    actor: session.username,
  });
  return NextResponse.json({ ok: true });
}
