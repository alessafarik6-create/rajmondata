import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getCompany } from "@/lib/superadmin-companies";

function getPublicOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return "";
}

/**
 * Docházkový terminál je na pevné cestě `/terminal` (bez tokenů v URL).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const { id: companyId } = await params;
  if (!companyId) {
    return NextResponse.json({ error: "ID chybí." }, { status: 400 });
  }

  try {
    const company = await getCompany(db, companyId);
    if (!company) {
      return NextResponse.json({ error: "Organizace nenalezena." }, { status: 404 });
    }

    const origin = getPublicOrigin(request);
    const path = "/terminal";
    const url = origin ? `${origin}${path}` : path;

    return NextResponse.json({
      companyId,
      companyName: company.name,
      url,
      path,
    });
  } catch (e) {
    console.error("[superadmin terminal GET]", e);
    return NextResponse.json({ error: "Načtení stavu terminálu se nezdařilo." }, { status: 500 });
  }
}
