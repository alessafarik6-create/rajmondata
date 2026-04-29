import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanTriggerOrgNotifications,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import {
  absoluteUrl,
  isValidEmail,
  normalizeEmail,
  loadCompanyEmailBranding,
  resolveCustomerEmailForJob,
  wrapPortalEmailHtml,
} from "@/lib/customer-portal-email";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  target?: { kind?: "photos" | "folderImages"; photoId?: string; folderId?: string; imageId?: string };
  fileLabel?: string;
  approvalNoteFromAdmin?: string;
  email?: string;
  fileId?: string;
  organizationId?: string;
};

function mediaRefFromBody(params: {
  companyId: string;
  jobId: string;
  body: Body;
  db: NonNullable<ReturnType<typeof getAdminFirestore>>;
}) {
  const target = params.body.target;
  if (!target?.kind) return null;
  if (target.kind === "photos" && target.photoId) {
    return params.db
      .collection("companies")
      .doc(params.companyId)
      .collection("jobs")
      .doc(params.jobId)
      .collection("photos")
      .doc(target.photoId);
  }
  if (target.kind === "folderImages" && target.folderId && target.imageId) {
    return params.db
      .collection("companies")
      .doc(params.companyId)
      .collection("jobs")
      .doc(params.jobId)
      .collection("folders")
      .doc(target.folderId)
      .collection("images")
      .doc(target.imageId);
  }
  return null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Server není nakonfigurován." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller || !callerCanTriggerOrgNotifications(caller)) {
    return NextResponse.json({ error: "Nemáte oprávnění." }, { status: 403 });
  }

  const { jobId } = await context.params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });
  }
  const companyId = caller.companyId;
  if (!callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ error: "Nemáte přístup k organizaci." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const mediaRef = mediaRefFromBody({ companyId, jobId, body, db });
  if (!mediaRef) {
    return NextResponse.json({ error: "Neplatná reference souboru." }, { status: 400 });
  }

  const jobRef = db.collection("companies").doc(companyId).collection("jobs").doc(jobId);
  const [jobSnap, mediaSnap] = await Promise.all([jobRef.get(), mediaRef.get()]);
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Zakázka nebyla nalezena." }, { status: 404 });
  }
  if (!mediaSnap.exists) {
    return NextResponse.json({ error: "Soubor nebyl nalezen." }, { status: 404 });
  }
  const job = (jobSnap.data() ?? {}) as Record<string, unknown>;
  const media = (mediaSnap.data() ?? {}) as Record<string, unknown>;
  const alreadySent = media.approvalEmailSent === true;
  const fileIdForLog =
    String(body.fileId ?? "").trim() ||
    (body.target?.kind === "photos"
      ? String(body.target.photoId ?? "")
      : `${String(body.target?.folderId ?? "")}:${String(body.target?.imageId ?? "")}`);

  // Vždy nastav stav čekajícího schválení při této akci.
  await mediaRef.set(
    {
      requiresCustomerApproval: true,
      approvalStatus: "pending",
      approvalRequestedAt: FieldValue.serverTimestamp(),
      approvalRequestedBy: caller.uid,
      ...(typeof body.approvalNoteFromAdmin === "string"
        ? { approvalNoteFromAdmin: body.approvalNoteFromAdmin.trim().slice(0, 2000) }
        : {}),
    },
    { merge: true }
  );

  if (alreadySent) {
    return NextResponse.json({
      ok: true,
      skipped: "already_sent",
      message: "Upozornění už bylo odesláno dříve. Použijte Odeslat upozornění znovu.",
    });
  }

  const overrideEmail = normalizeEmail(body.email ?? "");
  const customerEmail =
    isValidEmail(overrideEmail)
      ? overrideEmail
      : await resolveCustomerEmailForJob({ db, companyId, job });
  if (!customerEmail) {
    return NextResponse.json({ error: "Zákazník nemá vyplněný e-mail" }, { status: 400 });
  }
  const branding = await loadCompanyEmailBranding(db, companyId);
  const jobName = String(job.name ?? "").trim() || jobId;
  const jobLink = absoluteUrl(`/portal/customer/jobs/${encodeURIComponent(jobId)}`);
  const subject = `Nový výkres / dokument ke schválení – ${jobName}`;
  const html = wrapPortalEmailHtml({
    greeting: "Dobrý den,",
    paragraphs: [
      `v zákaznickém portálu máte nový výkres nebo dokument ke schválení k zakázce: ${jobName}.`,
      "Přihlaste se prosím do portálu a dokument zkontrolujte.",
      `Odkaz: ${jobLink}`,
    ],
    actionUrl: jobLink,
    actionLabel: "Otevřít zakázku v portálu",
    companyName: branding.companyName,
    logoUrl: branding.logoUrl,
    contactEmail: branding.contactEmail,
  });
  console.info("[approval-email] sending", {
    email: customerEmail,
    jobId,
    fileId: fileIdForLog,
    organizationId: companyId,
    resend: false,
    hasResendApiKey: Boolean(String(process.env.RESEND_API_KEY ?? "").trim()),
    hasEmailFrom: Boolean(String(process.env.EMAIL_FROM ?? "").trim()),
  });
  let sent:
    | Awaited<ReturnType<typeof sendTransactionalEmail>>
    | null = null;
  try {
    sent = await sendTransactionalEmail({
      to: [customerEmail],
      subject,
      html,
    });
  } catch (error) {
    console.error("[approval-email] EMAIL ERROR:", error);
    return NextResponse.json(
      { error: "E-mail se nepodařilo odeslat.", detail: error instanceof Error ? error.message : null },
      { status: 502 }
    );
  }
  console.info("[approval-email] email service response", {
    email: customerEmail,
    jobId,
    fileId: fileIdForLog,
    response: sent,
  });
  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error || "Nepodařilo se odeslat e-mail.", detail: sent.detail ?? null },
      { status: 502 }
    );
  }

  await mediaRef.set(
    {
      approvalEmailSent: true,
      approvalEmailSentAt: FieldValue.serverTimestamp(),
      approvalEmail: customerEmail,
      approvalEmailResentCount: media.approvalEmailResentCount ?? 0,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}
