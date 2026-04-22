import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanTriggerOrgNotifications,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  DOCUMENT_EMAIL_TYPES,
  type DocumentEmailType,
  hasNonEmptyTextSubjectAndBody,
  isValidEmailAddress,
  normalizeEmailBodyToHtml,
  parseCommaSeparatedEmails,
  stripHtmlToPlain,
} from "@/lib/document-email-outbound";
import { sendDocumentEmail } from "@/lib/document-email-outbound-admin";
import { getDocumentPdfBuffer } from "@/lib/document-email-pdf-server";
import {
  errorMessageFromUnknown,
  errorStackFromUnknown,
  serializeUnknownForLog,
} from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const ROUTE_LOG = "[document-email/send]";

type Body = {
  companyId?: string;
  jobId?: string;
  type?: string;
  to?: string;
  cc?: string;
  subject?: string;
  html?: string;
  documentUrl?: string | null;
  /** Legacy / alternativní id (některé klienty posílaly jen documentId). */
  documentId?: string | null;
  /** Legacy / alternativní org id (některé klienty posílaly organizationId). */
  organizationId?: string | null;
  invoiceId?: string | null;
  contractId?: string | null;
};

async function downloadStorageAttachment(params: {
  storagePath: string;
  filename: string;
  contentType: string | null;
}): Promise<{ filename: string; content: Buffer; contentType?: string }> {
  const bucket = getAdminStorageBucket();
  if (!bucket) {
    throw new Error("Storage bucket není dostupný (Firebase Admin).");
  }
  const [buf] = await bucket.file(params.storagePath).download();
  const ct =
    params.contentType != null && params.contentType.trim()
      ? params.contentType.trim()
      : undefined;
  return { filename: params.filename, content: buf, ...(ct ? { contentType: ct } : {}) };
}

function isDocEmailType(s: string): s is DocumentEmailType {
  return (DOCUMENT_EMAIL_TYPES as readonly string[]).includes(s);
}

function summarizeBody(body: Body): Record<string, unknown> {
  const html = String(body.html ?? "");
  return {
    companyId: body.companyId,
    jobId: body.jobId,
    type: body.type,
    to: body.to != null ? String(body.to).slice(0, 3) + "…" : null,
    ccLen: String(body.cc ?? "").length,
    subjectLen: String(body.subject ?? "").length,
    htmlLen: html.length,
    documentUrlLen: body.documentUrl != null ? String(body.documentUrl).length : 0,
    invoiceId: body.invoiceId,
    contractId: body.contractId,
  };
}

function jsonFail(
  status: number,
  error: string,
  detail: string | null,
  serverLog?: Record<string, unknown>
): NextResponse {
  if (serverLog) {
    console.error(ROUTE_LOG, "response error", serverLog);
  }
  return NextResponse.json({ ok: false as const, error, detail }, { status });
}

export async function POST(request: NextRequest) {
  const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return jsonFail(503, "Server není nakonfigurován.", "getAdminFirestore/getAdminAuth null", {
        step: "init",
      });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return jsonFail(401, "Neplatné přihlášení.", null, { step: "auth" });
    }
    if (!callerCanTriggerOrgNotifications(caller)) {
      return jsonFail(403, "Nemáte oprávnění.", null, { step: "permission", uid: caller.uid });
    }

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch (parseErr) {
      console.error(ROUTE_LOG, "JSON parse failed", { requestId, err: serializeUnknownForLog(parseErr) });
      return jsonFail(
        400,
        "Neplatné tělo požadavku.",
        errorStackFromUnknown(parseErr) ?? serializeUnknownForLog(parseErr),
        { step: "parseJson" }
      );
    }

    console.info(ROUTE_LOG, "start", {
      requestId,
      vercel: process.env.VERCEL,
      nodeEnv: process.env.NODE_ENV,
      runtime: "nodejs",
    });
    console.info(ROUTE_LOG, "payload summary", { requestId, ...summarizeBody(body) });

    const companyId =
      String(body.companyId ?? "").trim() || String(body.organizationId ?? "").trim();
    const jobId = String(body.jobId ?? "").trim();
    const type = String(body.type ?? "").trim();
    const to = String(body.to ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const html = String(body.html ?? "").trim();
    const docId = body.documentId != null ? String(body.documentId).trim() || null : null;
    const contractIdRaw = body.contractId != null ? String(body.contractId).trim() || null : null;
    const invoiceIdRaw = body.invoiceId != null ? String(body.invoiceId).trim() || null : null;
    const contractId =
      contractIdRaw || (type === "contract" ? docId : null);
    const invoiceId =
      invoiceIdRaw || (type === "invoice" || type === "advance_invoice" ? docId : null);

    if (!companyId || !jobId || !type || !to) {
      return jsonFail(400, "Chybí povinná pole.", null, {
        step: "validate",
        requestId,
        companyId: !!companyId,
        jobId: !!jobId,
        type: !!type,
        to: !!to,
      });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return jsonFail(403, "Nemáte přístup k organizaci.", `companyId=${companyId}`, {
        step: "companyAccess",
        requestId,
        uid: caller.uid,
      });
    }
    if (!isDocEmailType(type)) {
      return jsonFail(400, "Neplatný typ dokumentu.", `type=${type}`, { step: "docType", requestId });
    }
    if (!isValidEmailAddress(to)) {
      return jsonFail(400, "Neplatná e-mailová adresa příjemce.", `to=${to.slice(0, 40)}`, {
        step: "validateTo",
        requestId,
      });
    }
    const plainFromHtml = stripHtmlToPlain(html);
    if (!hasNonEmptyTextSubjectAndBody({ subject, bodyPlain: plainFromHtml })) {
      return jsonFail(400, "Vyplňte předmět i text zprávy.", null, { step: "validateBody", requestId });
    }

    if (type === "contract" && !contractId) {
      return jsonFail(400, "Chybí identifikátor smlouvy.", null, { step: "contractId", requestId });
    }
    if ((type === "invoice" || type === "advance_invoice") && !invoiceId) {
      return jsonFail(400, "Chybí identifikátor dokladu.", null, { step: "invoiceId", requestId });
    }
    if (type === "received_document" && !docId) {
      return jsonFail(400, "Chybí identifikátor dokladu.", null, { step: "documentId", requestId });
    }

    const jobRef = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    const jobData = jobSnap.exists ? (jobSnap.data() ?? {}) : null;
    console.info(ROUTE_LOG, "job lookup", {
      requestId,
      companyId,
      jobId,
      documentType: type,
      jobExists: jobSnap.exists,
      jobName: jobSnap.exists ? String((jobData as { name?: string })?.name ?? "").slice(0, 80) : null,
      jobHasData: jobData != null,
    });
    if (!jobSnap.exists) {
      return jsonFail(404, "Zakázka nenalezena.", `Firestore path=${jobRef.path} exists=false`, {
        step: "jobLookup",
        requestId,
        companyId,
        jobId,
      });
    }

    const ccExtra = parseCommaSeparatedEmails(String(body.cc ?? ""));
    for (const addr of ccExtra) {
      if (!isValidEmailAddress(addr)) {
        return jsonFail(400, `Neplatná adresa v kopii (CC): ${addr}`, null, { step: "cc", requestId });
      }
    }

    let sentByEmail: string | null = null;
    try {
      const u = await auth.getUser(caller.uid);
      sentByEmail = String(u.email ?? "").trim() || null;
    } catch (authUserErr) {
      console.warn(ROUTE_LOG, "auth.getUser failed", serializeUnknownForLog(authUserErr));
      sentByEmail = null;
    }

    console.info(ROUTE_LOG, "pdf generation start", {
      requestId,
      companyId,
      jobId,
      documentType: type,
      documentId: docId,
      contractId,
      invoiceId,
      htmlLen: html.length,
      recipient: to,
      organizationId: companyId,
    });

    type Attachment = { filename: string; content: Buffer; contentType?: string };
    let attachments: Attachment[] = [];

    if (type === "received_document") {
      const docRef = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("documents").doc(String(docId));
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        return jsonFail(404, "Doklad nenalezen.", `Firestore path=${docRef.path} exists=false`, {
          step: "companyDocumentLookup",
          requestId,
        });
      }
      const d = (docSnap.data() ?? {}) as Record<string, unknown>;
      const storagePath = typeof d.storagePath === "string" ? d.storagePath.trim() : "";
      const fileName =
        (typeof d.fileName === "string" && d.fileName.trim()) ||
        (typeof d.number === "string" && d.number.trim() ? d.number.trim() : "") ||
        "doklad";
      const mimeType = typeof d.mimeType === "string" ? d.mimeType.trim() : null;
      if (storagePath) {
        try {
          attachments = [
            await downloadStorageAttachment({
              storagePath,
              filename: fileName,
              contentType: mimeType,
            }),
          ];
        } catch (error) {
          const msg = errorMessageFromUnknown(error);
          const detail = errorStackFromUnknown(error) ?? serializeUnknownForLog(error);
          console.error(ROUTE_LOG, "attachment download threw", {
            requestId,
            companyId,
            jobId,
            documentType: type,
            documentId: docId,
            storagePath,
            message: msg,
            serialized: serializeUnknownForLog(error),
          });
          return jsonFail(500, "Přílohu dokladu se nepodařilo načíst.", detail.slice(0, 12_000), {
            step: "downloadAttachment.throw",
            requestId,
          });
        }
      } else {
        attachments = [];
      }
    } else {
      let pdf: Awaited<ReturnType<typeof getDocumentPdfBuffer>>;
      try {
        pdf = await getDocumentPdfBuffer({
          db,
          companyId,
          jobId,
          type,
          contractId,
          invoiceId,
        });
      } catch (error) {
        const msg = errorMessageFromUnknown(error);
        const detail = errorStackFromUnknown(error) ?? serializeUnknownForLog(error);
        console.error(ROUTE_LOG, "pdf generation threw", {
          requestId,
          companyId,
          jobId,
          documentType: type,
          contractId,
          invoiceId,
          message: msg,
          serialized: serializeUnknownForLog(error),
        });
        return jsonFail(500, "Server nedokázal vygenerovat PDF.", detail.slice(0, 12_000), {
          step: "getDocumentPdfBuffer.throw",
          requestId,
        });
      }

      if (!pdf.ok) {
        console.error(ROUTE_LOG, "pdf generation failed (ok=false)", {
          requestId,
          companyId,
          jobId,
          documentType: type,
          contractId,
          invoiceId,
          error: pdf.error,
          detail: pdf.detail,
        });
        return jsonFail(400, pdf.error, pdf.detail, { step: "getDocumentPdfBuffer.okFalse", requestId });
      }

      console.info(ROUTE_LOG, "pdf ok", {
        requestId,
        companyId,
        jobId,
        documentType: type,
        filename: pdf.filename,
        bufferBytes: pdf.buffer.length,
      });

      attachments = [
        {
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: "application/pdf",
        },
      ];
    }

    console.info(ROUTE_LOG, "email send start", {
      requestId,
      attachmentsCount: attachments.length,
      attachmentFilenames: attachments.map((a) => a.filename),
    });

    let result: Awaited<ReturnType<typeof sendDocumentEmail>>;
    try {
      result = await sendDocumentEmail(db, {
        companyId,
        jobId,
        type,
        to,
        ccExtra,
        subject,
        html: html.includes("<") ? html : normalizeEmailBodyToHtml(plainFromHtml),
        documentUrl: body.documentUrl != null ? String(body.documentUrl) : null,
        userId: caller.uid,
        sentByEmail,
        invoiceId,
        contractId,
        documentId: docId,
        attachments,
      });
    } catch (sendErr) {
      const msg = errorMessageFromUnknown(sendErr);
      const detail = errorStackFromUnknown(sendErr) ?? serializeUnknownForLog(sendErr);
      console.error(ROUTE_LOG, "sendDocumentEmail threw", {
        requestId,
        companyId,
        jobId,
        documentType: type,
        message: msg,
        serialized: serializeUnknownForLog(sendErr),
      });
      return jsonFail(502, msg, detail.slice(0, 12_000), { step: "sendDocumentEmail.throw" });
    }

    if (!result.ok) {
      console.error(ROUTE_LOG, "Resend / outbound failed", {
        requestId,
        companyId,
        jobId,
        documentType: type,
        error: result.error,
        detail: result.detail,
      });
      return jsonFail(502, result.error, result.detail, { step: "sendDocumentEmail.result" });
    }
    console.info(ROUTE_LOG, "email sent ok", { requestId, companyId, jobId, documentType: type });
    return NextResponse.json({ ok: true as const });
  } catch (error: unknown) {
    console.error(ROUTE_LOG, "unhandled failed", {
      requestId,
      message: errorMessageFromUnknown(error),
      serialized: serializeUnknownForLog(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error: errorMessageFromUnknown(error) || "Unknown server error",
        detail: (errorStackFromUnknown(error) ?? serializeUnknownForLog(error)).slice(0, 12_000),
      },
      { status: 500 }
    );
  }
}
