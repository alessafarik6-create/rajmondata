import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import {
  DEFAULT_CONSULTATION_SETTINGS,
  type PlatformConsultationSettings,
} from "@/lib/platform-consultation/consultation-types";

const DOC = "platform_consultation_settings/default";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const snap = await db.doc(DOC).get();
  return NextResponse.json({
    ok: true,
    settings: snap.exists
      ? ({ ...DEFAULT_CONSULTATION_SETTINGS, ...snap.data() } as PlatformConsultationSettings)
      : DEFAULT_CONSULTATION_SETTINGS,
  });
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const body = (await request.json()) as Partial<PlatformConsultationSettings>;
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (Array.isArray(body.workDays)) patch.workDays = body.workDays;
  if (body.slotStartHour != null) patch.slotStartHour = Number(body.slotStartHour);
  if (body.slotEndHour != null) patch.slotEndHour = Number(body.slotEndHour);
  if (body.slotDurationMinutes != null) patch.slotDurationMinutes = body.slotDurationMinutes;
  if (body.breakMinutes != null) patch.breakMinutes = Number(body.breakMinutes);
  if (body.maxBookingsPerDay != null) patch.maxBookingsPerDay = Number(body.maxBookingsPerDay);
  if (body.blockedDates != null) patch.blockedDates = body.blockedDates;
  if (body.meetLinkTemplate !== undefined) patch.meetLinkTemplate = body.meetLinkTemplate;
  if (body.adminNotifyEmail !== undefined) patch.adminNotifyEmail = body.adminNotifyEmail;
  await db.doc(DOC).set(patch, { merge: true });
  return NextResponse.json({ ok: true });
}
