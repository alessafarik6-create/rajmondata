import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  applySuperadminTrialAction,
  type SuperadminTrialAction,
} from "@/lib/platform-trial-service";
import { getCompanyLicenseDoc } from "@/lib/company-license-admin";
import { remainingTrialDays } from "@/lib/platform-subscription";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin unavailable" }, { status: 503 });
  const { id } = await params;
  const lic = await getCompanyLicenseDoc(db, id);
  if (!lic) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    subscriptionStatus: lic.subscriptionStatus ?? null,
    trialStartedAt: lic.trialStartedAt ?? null,
    trialEndsAt: lic.trialEndsAt ?? null,
    trialConsumed: lic.trialConsumed ?? false,
    status: lic.status,
    active: lic.active,
    remainingDays: remainingTrialDays(lic.trialEndsAt ?? lic.expiresAt),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin unavailable" }, { status: 503 });
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  let action: SuperadminTrialAction;
  const kind = String(body.action ?? "");
  if (kind === "set_trial_end" && typeof body.trialEndsAt === "string") {
    action = { action: "set_trial_end", trialEndsAt: body.trialEndsAt };
  } else if (kind === "extend_trial") {
    const extraDays = Number(body.extraDays);
    if (!Number.isFinite(extraDays) || extraDays < 1) {
      return NextResponse.json({ error: "extraDays invalid" }, { status: 400 });
    }
    action = { action: "extend_trial", extraDays: Math.round(extraDays) };
  } else if (kind === "end_trial") {
    action = { action: "end_trial" };
  } else if (kind === "convert_to_paid") {
    action = { action: "convert_to_paid" };
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const next = await applySuperadminTrialAction(db, id, action, session.username);
    return NextResponse.json({
      ok: true,
      subscriptionStatus: next.subscriptionStatus,
      trialEndsAt: next.trialEndsAt,
      remainingDays: remainingTrialDays(next.trialEndsAt),
    });
  } catch (e) {
    console.error("[superadmin trial PATCH]", e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
