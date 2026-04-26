import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { deletePlatformInvoiceAdmin } from "@/lib/platform-invoice-delete-admin";

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Mazání faktur je povoleno jen superadministrátorovi." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const { id: rawId } = await ctx.params;
  const id = String(rawId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí ID faktury." }, { status: 400 });
  try {
    await deletePlatformInvoiceAdmin(db, id);
    return NextResponse.json({ ok: true, success: true });
  } catch (e) {
    console.error("[admin platform-invoices DELETE]", e);
    const msg = e instanceof Error ? e.message : "Smazání se nezdařilo.";
    if (msg === "Faktura neexistuje.") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
