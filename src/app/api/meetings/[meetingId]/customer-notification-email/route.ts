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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  email?: string;
  jobId?: string;
  customerId?: string;
  organizationId?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ meetingId: string }> }
) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }

  const companyId = caller.companyId;
  const { meetingId } = await context.params;
  const meetingIdStr = String(meetingId ?? "").trim();
  if (!meetingIdStr) {
    return NextResponse.json({ ok: false, error: "Chybí meetingId." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const orgIdFromBody = String(body.organizationId ?? "").trim();
  if (orgIdFromBody && orgIdFromBody !== companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const meetingRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("meetingRecords")
    .doc(meetingIdStr);
  const meetingSnap = await meetingRef.get();
  if (!meetingSnap.exists) {
    return NextResponse.json({ ok: false, error: "Záznam schůzky nebyl nalezen." }, { status: 404 });
  }
  const meeting = (meetingSnap.data() ?? {}) as Record<string, unknown>;
  const meetingCompany = String(meeting.companyId ?? "").trim();
  if (meetingCompany && meetingCompany !== companyId) {
    return NextResponse.json({ ok: false, error: "Záznam nepatří k této organizaci." }, { status: 403 });
  }

  const isVisibleToCustomer =
    meeting.sentToCustomer === true ||
    meeting.sharedWithCustomer === true ||
    meeting.isSharedWithCustomer === true ||
    String(meeting.visibility ?? "").trim().toLowerCase() === "customer";
  if (!isVisibleToCustomer) {
    return NextResponse.json(
      { ok: false, error: "Upozornění lze poslat jen u záznamu viditelného zákazníkovi." },
      { status: 400 }
    );
  }

  const jobIdFromMeeting = String(meeting.jobId ?? "").trim();
  const customerIdFromMeeting = String(meeting.customerId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim() || jobIdFromMeeting || null;
  const customerId = String(body.customerId ?? "").trim() || customerIdFromMeeting || null;

  if (!jobId && !customerId) {
    return NextResponse.json(
      { ok: false, error: "Záznam není přiřazen k zakázce ani zákazníkovi." },
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
      { ok: false, error: "Zákazník nemá vyplněný e-mail" },
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

  console.info("[meetings/customer-notification-email] sending", {
    email: customerEmail,
    meetingId: meetingIdStr,
    jobId,
    customerId,
    organizationId: companyId,
    hasResendApiKey: Boolean(String(process.env.RESEND_API_KEY ?? "").trim()),
    hasEmailFrom: Boolean(String(process.env.EMAIL_FROM ?? "").trim()),
  });

  let sent: Awaited<ReturnType<typeof sendTransactionalEmail>> | null = null;
  try {
    sent = await sendTransactionalEmail({
      to: [customerEmail],
      subject,
      html,
    });
  } catch (error) {
    console.error("[meetings/customer-notification-email] EMAIL ERROR:", error);
    return NextResponse.json(
      { ok: false, error: "E-mail se nepodařilo odeslat.", detail: error instanceof Error ? error.message : null },
      { status: 502 }
    );
  }

  console.info("[meetings/customer-notification-email] email service response", {
    email: customerEmail,
    meetingId: meetingIdStr,
    response: sent,
  });

  if (!sent.ok) {
    return NextResponse.json(
      { ok: false, error: sent.error || "Nepodařilo se odeslat e-mail.", detail: sent.detail ?? null },
      { status: 502 }
    );
  }

  const prevResentCountRaw = meeting.customerNotificationEmailResentCount;
  const prevResentCount =
    typeof prevResentCountRaw === "number" && Number.isFinite(prevResentCountRaw)
      ? prevResentCountRaw
      : 0;
  const nextResentCount = meeting.customerNotificationEmailSent === true ? prevResentCount + 1 : prevResentCount;

  await meetingRef.set(
    {
      customerNotificationEmailSent: true,
      customerNotificationEmailSentAt: FieldValue.serverTimestamp(),
      customerNotificationEmail: customerEmail,
      customerNotificationEmailResentCount: nextResentCount,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true as const });
}

