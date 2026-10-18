import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  DEFAULT_CONSULTATION_SETTINGS,
  type PlatformConsultationBooking,
} from "@/lib/platform-consultation/consultation-types";
import { availableSlotsForDate } from "@/lib/platform-consultation/consultation-slots";

const SETTINGS_DOC = "platform_consultation_settings/default";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dateYmd = String(new URL(request.url).searchParams.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return NextResponse.json({ ok: false, error: "Neplatné datum." }, { status: 400 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error" }, { status: 503 });
  const settingsSnap = await db.doc(SETTINGS_DOC).get();
  const settings = settingsSnap.exists
    ? { ...DEFAULT_CONSULTATION_SETTINGS, ...settingsSnap.data() }
    : DEFAULT_CONSULTATION_SETTINGS;
  const existingSnap = await db
    .collection("platform_consultation_bookings")
    .where("dateYmd", "==", dateYmd)
    .limit(100)
    .get();
  const existing = existingSnap.docs.map((d) => d.data()) as Pick<
    PlatformConsultationBooking,
    "dateYmd" | "timeSlot" | "status"
  >[];
  const slots = availableSlotsForDate(dateYmd, settings, existing);
  return NextResponse.json({ ok: true, slots });
}
