import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANY_LICENSES_COLLECTION, COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { remainingTrialDays } from "@/lib/platform-subscription";
import { createNotification } from "@/lib/notification-service/notification-service";
import type { CompanyLicenseDoc } from "@/lib/platform-config";

const REMINDER_DAYS = [7, 3, 1] as const;

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin unavailable" }, { status: 503 });

  const snap = await db
    .collection(COMPANY_LICENSES_COLLECTION)
    .where("subscriptionStatus", "==", "TRIAL")
    .limit(500)
    .get();

  let notified = 0;
  for (const doc of snap.docs) {
    const lic = doc.data() as CompanyLicenseDoc;
    const ends = lic.trialEndsAt ?? lic.expiresAt;
    const days = remainingTrialDays(ends);
    if (!REMINDER_DAYS.includes(days as (typeof REMINDER_DAYS)[number])) continue;

    const companyId = lic.companyId || doc.id;
    const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    const ownerId = String(companySnap.data()?.ownerId ?? companySnap.data()?.ownerUserId ?? "");
    if (!ownerId) continue;

    const title = "Zkušební období RAJMONDATA";
    const body = `Vaše bezplatné zkušební období RAJMONDATA končí za ${days} ${
      days === 1 ? "den" : days < 5 ? "dny" : "dní"
    }.`;
    const eventId = `trial-reminder-${companyId}-${days}d`;

    await createNotification({
      recipientUserId: ownerId,
      organizationId: companyId,
      type: "SYSTEM_ALERT",
      title,
      body,
      url: "/portal/vyuctovani",
      eventId,
      priority: days <= 1 ? "HIGH" : "NORMAL",
    });
    notified += 1;
  }

  return NextResponse.json({ ok: true, checked: snap.size, notified });
}
