import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import {
  DEFAULT_CONSULTATION_SETTINGS,
  type ConsultationType,
  type PlatformConsultationBooking,
} from "@/lib/platform-consultation/consultation-types";
import { availableSlotsForDate } from "@/lib/platform-consultation/consultation-slots";

const SETTINGS_DOC = "platform_consultation_settings/default";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error" }, { status: 503 });
  const body = (await request.json()) as Record<string, unknown>;
  const organizationName = String(body.organizationName ?? "").trim();
  const contactName = String(body.contactName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const consultationType = String(body.consultationType ?? "phone") as ConsultationType;
  const dateYmd = String(body.dateYmd ?? "").trim();
  const timeSlot = String(body.timeSlot ?? "").trim();
  const note = String(body.note ?? "").trim();
  const organizationId = String(body.organizationId ?? "").trim() || null;
  const campaignId = String(body.campaignId ?? "").trim() || null;

  if (!organizationName || !contactName || !email || !dateYmd || !timeSlot) {
    return NextResponse.json({ ok: false, error: "Vyplňte povinná pole." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return NextResponse.json({ ok: false, error: "Neplatné datum." }, { status: 400 });
  }

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
  if (!slots.includes(timeSlot)) {
    return NextResponse.json({ ok: false, error: "Termín již není dostupný." }, { status: 409 });
  }

  let meetLink: string | null = null;
  if (consultationType === "online") {
    const tpl = String(settings.meetLinkTemplate ?? "").trim();
    meetLink = tpl || null;
  }

  const ref = await db.collection("platform_consultation_bookings").add({
    organizationId,
    organizationName,
    contactName,
    email,
    phone,
    consultationType,
    dateYmd,
    timeSlot,
    note: note || null,
    status: "confirmed",
    meetLink,
    campaignId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (campaignId) {
    const campRef = db.collection("platform_org_campaigns").doc(campaignId);
    await campRef.set(
      { "stats.consultationsBooked": FieldValue.increment(1) },
      { merge: true }
    );
  }

  const typeLabel = consultationType === "online" ? "Online schůzka" : "Telefonická konzultace";
  const confirmHtml = `<p>Potvrzujeme rezervaci konzultace RAJMONDATA.</p>
<ul><li>${typeLabel}</li><li>${dateYmd} ${timeSlot}</li><li>${organizationName}</li></ul>
${meetLink ? `<p>Odkaz na schůzku: <a href="${meetLink}">${meetLink}</a></p>` : consultationType === "online" ? "<p>Odkaz na online schůzku vám zašleme e-mailem před termínem.</p>" : ""}`;

  await sendTransactionalEmail({
    to: [email],
    subject: "RAJMONDATA – potvrzení rezervace konzultace",
    html: confirmHtml,
  });

  const adminEmail = String(settings.adminNotifyEmail ?? process.env.PLATFORM_ADMIN_EMAIL ?? "").trim();
  if (adminEmail) {
    await sendTransactionalEmail({
      to: [adminEmail],
      subject: `Nová rezervace konzultace – ${organizationName}`,
      html: `<p>${contactName} (${email}, ${phone})</p><p>${typeLabel} · ${dateYmd} ${timeSlot}</p><p>${note || "—"}</p>`,
    });
  }

  return NextResponse.json({ ok: true, bookingId: ref.id, meetLink });
}
