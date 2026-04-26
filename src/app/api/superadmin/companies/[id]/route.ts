import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { getCompany, updateCompany } from "@/lib/superadmin-companies";
import {
  billingAutomationFirestorePayload,
  loadPlatformPricingDoc,
  normalizeBillingAutomation,
} from "@/lib/platform-invoice-auto";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

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

    const billingAutomationRaw = (body as Record<string, unknown>).billingAutomation;
    const hasBillingPatch =
      billingAutomationRaw !== undefined &&
      billingAutomationRaw !== null &&
      typeof billingAutomationRaw === "object";

    if (isActive === undefined && !license && !companyLicense && !hasBillingPatch) {
      return NextResponse.json({ error: "Žádné změny." }, { status: 400 });
    }

    if (isActive !== undefined || license || companyLicense) {
      await updateCompany(
        db,
        id,
        { isActive, license, companyLicense },
        { actorLabel: session.username }
      );
    }

    if (hasBillingPatch) {
      await ensureAllPlatformData(db);
      const pricingDefaults = await loadPlatformPricingDoc(db);
      const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(id).get();
      const prevBa =
        orgSnap.exists && orgSnap.data()?.billingAutomation && typeof orgSnap.data()!.billingAutomation === "object"
          ? (orgSnap.data()!.billingAutomation as Record<string, unknown>)
          : {};
      const mergedBilling = { ...prevBa, ...(billingAutomationRaw as Record<string, unknown>) };
      const state = normalizeBillingAutomation(mergedBilling, {
        intervalDays: pricingDefaults.automationDefaultIntervalDays,
        dueDays: pricingDefaults.automationDefaultDueDays,
      });
      const patch = billingAutomationFirestorePayload(state);
      await db.collection(ORGANIZATIONS_COLLECTION).doc(id).set({ ...patch, updatedAt: new Date() }, { merge: true });
      await db.collection(COMPANIES_COLLECTION).doc(id).set({ ...patch, updatedAt: new Date() }, { merge: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin company update]", e);
    return NextResponse.json(
      { error: "Aktualizace se nezdařila." },
      { status: 500 }
    );
  }
}
