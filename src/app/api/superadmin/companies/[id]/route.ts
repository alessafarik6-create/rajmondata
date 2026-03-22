import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getCompany, updateCompany } from "@/lib/superadmin-companies";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID chybí." }, { status: 400 });
  }

  try {
    const company = await getCompany(db, id);
    if (!company) {
      return NextResponse.json({ error: "Organizace nenalezena." }, { status: 404 });
    }
    return NextResponse.json(company);
  } catch (e) {
    console.error("[superadmin company]", e);
    return NextResponse.json(
      { error: "Načtení organizace se nezdařilo." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID chybí." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;
    const license =
      body.license && typeof body.license === "object"
        ? {
            licenseType: body.license.licenseType,
            licenseStatus: body.license.licenseStatus,
            status: body.license.status,
            expirationDate: body.license.expirationDate ?? body.license.licenseExpiresAt,
            licenseExpiresAt: body.license.licenseExpiresAt ?? body.license.expirationDate,
            maxUsers: body.license.maxUsers,
            enabledModules: body.license.enabledModules,
          }
        : undefined;

    const companyLicense =
      body.companyLicense && typeof body.companyLicense === "object"
        ? body.companyLicense
        : undefined;

    if (isActive === undefined && !license && !companyLicense) {
      return NextResponse.json({ error: "Žádné změny." }, { status: 400 });
    }

    await updateCompany(
      db,
      id,
      { isActive, license, companyLicense },
      { actorLabel: session.username }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin company update]", e);
    return NextResponse.json(
      { error: "Aktualizace se nezdařila." },
      { status: 500 }
    );
  }
}
