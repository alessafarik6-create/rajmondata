import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminStorageBucket } from "@/lib/firebase-admin";

/**
 * Smazání souboru z platform/landing/… (pouze superadmin).
 */
export async function DELETE(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const path = String(url.searchParams.get("path") || "").trim();
  if (!path.startsWith("platform/landing/")) {
    return NextResponse.json({ error: "Neplatná cesta." }, { status: 400 });
  }

  const bucket = getAdminStorageBucket();
  if (!bucket) {
    return NextResponse.json({ error: "Firebase Storage není k dispozici." }, { status: 503 });
  }

  try {
    await bucket.file(path).delete({ ignoreNotFound: true });
    console.info("[Platform]", "SEO media deleted", { path, by: session.username });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin seo-media-delete]", e);
    const msg = e instanceof Error ? e.message : "Smazání se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
