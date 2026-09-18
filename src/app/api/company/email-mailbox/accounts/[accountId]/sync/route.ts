import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ accountId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
  }

  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId =
    String(body.companyId ?? request.nextUrl.searchParams.get("companyId") ?? "").trim() ||
    perm.caller.companyId;
  const { accountId } = await ctx.params;

  const result = await syncEmailAccount(db, companyId, accountId);
  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error, ...result }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...result });
}
