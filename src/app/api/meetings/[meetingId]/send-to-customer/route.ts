import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { assertCallerCanMeetingRecordsStaffActions } from "@/lib/meeting-records-api-auth";
import {
  absoluteUrl,
  buildMeetingRecordCustomerNotificationEmailHtml,
  isValidEmail,
  normalizeEmail,
  loadCompanyEmailBranding,
  resolveCustomerEmailForJob,
} from "@/lib/customer-portal-email";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { resolveMeetingTitle } from "@/lib/meeting-records-types";
import { sendMeetingRecordPdfEmailToCustomer } from "@/lib/meeting-records-send-pdf-email-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type SendMode = "portalNotification" | "pdfEmail";

type Body = {
  email?: string;
  mode?: string;
  jobId?: string;
  customerId?: string;
  organizationId?: string;
};

function isSendMode(v: string): v is SendMode {
  return v === "portalNotification" || v === "pdfEmail";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ meetingId: string }> }
) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ success: false, ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ success: false, ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }

  const companyId = caller.companyId;
  const { meetingId } = await context.params;
  const meetingIdStr = String(meetingId ?? "").trim();
  if (!meetingIdStr) {
    return NextResponse.json({ success: false, ok: false, error: "Chybí meetingId." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, ok: false, error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const orgIdFromBody = String(body.organizationId ?? "").trim();
  if (orgIdFromBody && orgIdFromBody !== companyId) {
    return NextResponse.json({ success: false, ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const modeRaw = String(body.mode ?? "").trim();
  if (!isSendMode(modeRaw)) {
    return NextResponse.json(
      { success: false, ok: false, error: "Neplatný režim odeslání (mode)." },
      { status: 400 }
    );
  }
  const mode = modeRaw;

  const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
  if (!gate.ok) {
    return NextResponse.json({ success: false, ok: false, error: gate.error }, { status: gate.status });
  }

  const meetingRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("meetingRecords")
    .doc(meetingIdStr);
  const meetingSnap = await meetingRef.get();
  if (!meetingSnap.exists) {
    return NextResponse.json({ success: false, ok: false, error: "Záznam schůzky nebyl nalezen." }, { status: 404 });
  }
  const meeting = (meetingSnap.data() ?? {}) as Record<string, unknown>;
  const meetingCompany = String(meeting.companyId ?? "").trim();
  if (meetingCompany && meetingCompany !== companyId) {
    return NextResponse.json({ success: false, ok: false, error: "Záznam nepatří k této organizaci." }, { status: 403 });
  }

  const isVisibleToCustomer =
    meeting.sentToCustomer === true ||
    meeting.sharedWithCustomer === true ||
    meeting.isSharedWithCustomer === true ||
    String(meeting.visibility ?? "").trim().toLowerCase() === "customer";
  if (!isVisibleToCustomer) {
    return NextResponse.json(
      { success: false, ok: false, error: "Odeslat lze jen záznam viditelný zákazníkovi." },
      { status: 400 }
    );
  }

  const jobIdFromMeeting = String(meeting.jobId ?? "").trim();
  const customerIdFromMeeting = String(meeting.customerId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim() || jobIdFromMeeting || null;
  const customerId = String(body.customerId ?? "").trim() || customerIdFromMeeting || null;

  if (!jobId && !customerId) {
    return NextResponse.json(
      { success: false, ok: false, error: "Záznam není přiřazen k zakázce ani zákazníkovi." },
      { status: 400 }
    );
  }

  let job: Record<string, unknown> | null = null;
  let jobName: string | null = null;
  if (jobId) {
    const jobSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .get();
    if (jobSnap.exists) {
      job = (jobSnap.data() ?? {}) as Record<string, unknown>;
      jobName = String(job.name ?? meeting.jobName ?? "").trim() || jobId;
    } else {
      jobName = String(meeting.jobName ?? "").trim() || jobId;
    }
  }

  const overrideEmail = normalizeEmail(body.email ?? "");
  let customerEmail: string | null = null;
  if (isValidEmail(overrideEmail)) {
    customerEmail = overrideEmail;
  } else if (job) {
    customerEmail = await resolveCustomerEmailForJob({ db, companyId, job });
  }
  if (!customerEmail && customerId) {
    const cSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .doc(customerId)
      .get();
    const c = (cSnap.data() ?? {}) as Record<string, unknown>;
    const fromCustomer = normalizeEmail(c.customerPortalEmail ?? c.email);
    if (isValidEmail(fromCustomer)) customerEmail = fromCustomer;
  }
  if (!customerEmail) {
    return NextResponse.json(
      { success: false, ok: false, error: "Zákazník nemá vyplněný e-mail" },
      { status: 400 }
    );
  }

  const branding = await loadCompanyEmailBranding(db, companyId);
  const loginUrl = absoluteUrl("/login");
  const actionUrl = jobId
    ? absoluteUrl(`/portal/customer/jobs/${encodeURIComponent(jobId)}`)
    : absoluteUrl("/portal/customer/profile");

  const customerName =
    String(meeting.customerName ?? "").trim() ||
    String((job ?? {}).customerName ?? "").trim() ||
    "zákazníku";

  const meetingTitle = resolveMeetingTitle({
    title: typeof meeting.title === "string" ? meeting.title : "",
    meetingTitle: typeof meeting.meetingTitle === "string" ? meeting.meetingTitle : null,
  });

  if (mode === "portalNotification") {
    const subject = `Nový záznam ze schůzky – ${branding.companyName}`;
    const html = buildMeetingRecordCustomerNotificationEmailHtml({
      portalName: PLATFORM_NAME,
      organizationName: branding.companyName,
      customerName,
      jobName,
      actionUrl,
      loginUrl,
      logoUrl: branding.logoUrl,
      contactEmail: branding.contactEmail,
    });

    console.info("[meetings/send-to-customer] portal notification", {
      email: customerEmail,
      meetingId: meetingIdStr,
      jobId,
      customerId,
      organizationId: companyId,
    });

    let sent: Awaited<ReturnType<typeof sendTransactionalEmail>> | null = null;
    try {
      sent = await sendTransactionalEmail({
        to: [customerEmail],
        subject,
        html,
      });
    } catch (error) {
      console.error("[meetings/send-to-customer] portal EMAIL ERROR:", error);
      return NextResponse.json(
        {
          success: false,
          ok: false,
          error: "E-mail se nepodařilo odeslat.",
          detail: error instanceof Error ? error.message : null,
        },
        { status: 502 }
      );
    }

    if (!sent.ok) {
      return NextResponse.json(
        {
          success: false,
          ok: false,
          error: sent.error || "Nepodařilo se odeslat e-mail.",
          detail: sent.detail ?? null,
        },
        { status: 502 }
      );
    }

    const prevPortalResentRaw = meeting.customerNotificationEmailResentCount;
    const prevPortalResent =
      typeof prevPortalResentRaw === "number" && Number.isFinite(prevPortalResentRaw)
        ? prevPortalResentRaw
        : 0;
    const nextPortalResent =
      meeting.customerNotificationEmailSent === true ? prevPortalResent + 1 : prevPortalResent;

    await meetingRef.set(
      {
        customerNotificationType: "portalNotification",
        customerNotificationEmailSent: true,
        customerNotificationEmailSentAt: FieldValue.serverTimestamp(),
        customerNotificationEmail: customerEmail,
        customerNotificationEmailResentCount: nextPortalResent,
        customerLastSendMode: "portalNotification",
        customerLastSendAt: FieldValue.serverTimestamp(),
        customerLastSendEmail: customerEmail,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true, ok: true as const });
  }

  const subjectPdf = `Zápis ze schůzky — ${meetingTitle || "schůzka"}`;
  const bodyPlainPdf =
    "Dobrý den,\n\n" +
    "v příloze zasíláme zápis ze schůzky ve formátu PDF.\n\n" +
    "S pozdravem";

  const pdfSend = await sendMeetingRecordPdfEmailToCustomer({
    db,
    caller,
    companyId,
    recordId: meetingIdStr,
    to: customerEmail,
    cc: "",
    subject: subjectPdf,
    bodyPlain: bodyPlainPdf,
    updateLegacySentFields: true,
  });

  if (!pdfSend.ok) {
    return NextResponse.json(
      { success: false, ok: false, error: pdfSend.error, detail: pdfSend.detail },
      { status: 502 }
    );
  }

  const prevPdfResentRaw = meeting.customerPdfEmailResentCount;
  const prevPdfResent =
    typeof prevPdfResentRaw === "number" && Number.isFinite(prevPdfResentRaw) ? prevPdfResentRaw : 0;
  const nextPdfResent = meeting.customerPdfEmailSent === true ? prevPdfResent + 1 : prevPdfResent;

  await meetingRef.set(
    {
      customerNotificationType: "pdfEmail",
      customerPdfEmailSent: true,
      customerPdfEmailSentAt: FieldValue.serverTimestamp(),
      customerNotificationEmail: customerEmail,
      customerPdfEmailResentCount: nextPdfResent,
      customerLastSendMode: "pdfEmail",
      customerLastSendAt: FieldValue.serverTimestamp(),
      customerLastSendEmail: customerEmail,
    },
    { merge: true }
  );

  return NextResponse.json({ success: true, ok: true as const });
}
