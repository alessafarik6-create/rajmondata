import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
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
import { recordEmailOutboundOnPrimaryDocs, sendDocumentEmail } from "@/lib/document-email-outbound-admin";
import { getDocumentPdfBuffer } from "@/lib/document-email-pdf-server";
import {
  JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR,
  parseJobDocumentEmailAttachmentRefs,
  resolveJobDocumentEmailExtraAttachments,
  type JobDocumentEmailAttachmentSourceLabel,
} from "@/lib/job-document-email-attachments";
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
  /** companies/.../jobs/{jobId}/materialOrders/{materialOrderId} */
  materialOrderId?: string | null;
  /** Zahrnout hlavní PDF doklad (smlouva / faktura). Výchozí true. */
  includeMainDocument?: boolean;
  /** Další přílohy zakázky. */
  extraAttachments?: unknown;
};

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${token}`;
}

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
    let resolvedJobId = String(body.jobId ?? "").trim();
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
    const materialOrderIdRaw =
      body.materialOrderId != null ? String(body.materialOrderId).trim() || null : null;

    if (!companyId || !type || !to) {
      return jsonFail(400, "Chybí povinná pole.", null, {
        step: "validate",
        requestId,
        companyId: !!companyId,
        jobId: !!resolvedJobId,
        type: !!type,
        to: !!to,
      });
    }

    if ((type === "invoice" || type === "advance_invoice") && !resolvedJobId && invoiceId) {
      try {
        const iref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("invoices").doc(invoiceId);
        const isnap = await iref.get();
        if (isnap.exists) {
          const idata = (isnap.data() ?? {}) as Record<string, unknown>;
          resolvedJobId = String(idata.jobId ?? "").trim();
        }
      } catch (e) {
        console.warn(ROUTE_LOG, "invoice lookup for jobId failed", serializeUnknownForLog(e));
      }
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

    const includeMainDocument =
      type === "job_attachments"
        ? false
        : body.includeMainDocument !== false;
    const extraRefsRaw = parseJobDocumentEmailAttachmentRefs(body.extraAttachments);
    const extraRefs = extraRefsRaw.filter((ref) => {
      if (!includeMainDocument) return true;
      if (
        type === "contract" &&
        ref.kind === "work_contract_pdf" &&
        contractId &&
        ref.sourceId === contractId
      ) {
        return false;
      }
      return true;
    });

    if (type === "job_attachments") {
      if (!resolvedJobId) {
        return jsonFail(400, "Chybí zakázka.", null, { step: "jobRequiredAttachments", requestId });
      }
      if (extraRefs.length === 0) {
        return jsonFail(400, "Vyberte alespoň jednu přílohu.", null, {
          step: "extraAttachments",
          requestId,
        });
      }
    }

    if (!includeMainDocument && extraRefs.length === 0) {
      return jsonFail(
        400,
        "Vyberte hlavní dokument nebo alespoň jednu přílohu.",
        null,
        { step: "noAttachments", requestId }
      );
    }

    if (includeMainDocument && type === "contract" && !contractId) {
      return jsonFail(400, "Chybí identifikátor smlouvy.", null, { step: "contractId", requestId });
    }
    if (
      includeMainDocument &&
      (type === "invoice" || type === "advance_invoice") &&
      !invoiceId
    ) {
      return jsonFail(400, "Chybí identifikátor dokladu.", null, { step: "invoiceId", requestId });
    }
    if (type === "received_document" && !docId) {
      return jsonFail(400, "Chybí identifikátor dokladu.", null, { step: "documentId", requestId });
    }
    if (type === "material_order") {
      if (!resolvedJobId) {
        return jsonFail(400, "Chybí zakázka k objednávce materiálu.", null, {
          step: "jobRequiredMaterialOrder",
          requestId,
        });
      }
      if (!materialOrderIdRaw) {
        return jsonFail(400, "Chybí identifikátor objednávky materiálu.", null, {
          step: "materialOrderId",
          requestId,
        });
      }
    }

    if (type === "contract") {
      if (!resolvedJobId) {
        return jsonFail(400, "Chybí zakázka ke smlouvě.", null, {
          step: "jobRequiredContract",
          requestId,
        });
      }
      const jobRef = db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("jobs")
        .doc(resolvedJobId);
      const jobSnap = await jobRef.get();
      if (!jobSnap.exists) {
        return jsonFail(404, "Zakázka nenalezena.", `Firestore path=${jobRef.path} exists=false`, {
          step: "jobLookup",
          requestId,
          companyId,
          jobId: resolvedJobId,
        });
      }
    }

    const ccExtra = parseCommaSeparatedEmails(String(body.cc ?? ""));
    for (const addr of ccExtra) {
      if (!isValidEmailAddress(addr)) {
        return jsonFail(400, `Neplatná adresa v kopii (CC): ${addr}`, null, { step: "cc", requestId });
      }
    }

    let sentByEmail: string | null = null;
    let sentByDisplayName: string | null = null;
    try {
      const u = await auth.getUser(caller.uid);
      sentByEmail = String(u.email ?? "").trim() || null;
      const dn = String(u.displayName ?? "").trim();
      sentByDisplayName = dn || sentByEmail;
    } catch (authUserErr) {
      console.warn(ROUTE_LOG, "auth.getUser failed", serializeUnknownForLog(authUserErr));
      sentByEmail = null;
      sentByDisplayName = null;
    }

    const pdfJobId = resolvedJobId || "";

    console.info(ROUTE_LOG, "pdf generation start", {
      requestId,
      companyId,
      jobId: resolvedJobId || null,
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
    let mainDocumentFilename: string | null = null;
    const attachmentDetails: { filename: string; source: string }[] = [];

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
            jobId: resolvedJobId || null,
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
    } else if (includeMainDocument) {
      let pdf: Awaited<ReturnType<typeof getDocumentPdfBuffer>>;
      try {
        pdf = await getDocumentPdfBuffer({
          db,
          companyId,
          jobId: pdfJobId,
          type,
          contractId,
          invoiceId,
          materialOrderId: type === "material_order" ? materialOrderIdRaw : null,
        });
      } catch (error) {
        const msg = errorMessageFromUnknown(error);
        const detail = errorStackFromUnknown(error) ?? serializeUnknownForLog(error);
        console.error(ROUTE_LOG, "pdf generation threw", {
          requestId,
          companyId,
          jobId: resolvedJobId || null,
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
          jobId: resolvedJobId || null,
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
        jobId: resolvedJobId || null,
        documentType: type,
        filename: pdf.filename,
        bufferBytes: pdf.buffer.length,
      });

      mainDocumentFilename = pdf.filename;
      attachments = [
        {
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: "application/pdf",
        },
      ];
    }

    if (extraRefs.length > 0) {
      if (!resolvedJobId) {
        return jsonFail(400, "Chybí zakázka pro přílohy.", null, {
          step: "jobRequiredExtraAttachments",
          requestId,
        });
      }
      try {
        const extras = await resolveJobDocumentEmailExtraAttachments(db, {
          companyId,
          jobId: resolvedJobId,
          refs: extraRefs,
        });
        for (const ref of extraRefs) {
          attachmentDetails.push({ filename: ref.filename, source: ref.sourceLabel });
        }
        attachments = [...attachments, ...extras];
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR;
        const detail = errorStackFromUnknown(err) ?? serializeUnknownForLog(err);
        console.error(ROUTE_LOG, "extra attachments failed", {
          requestId,
          message: msg,
          serialized: serializeUnknownForLog(err),
        });
        return jsonFail(400, msg, detail.slice(0, 12_000), {
          step: "resolveExtraAttachments",
          requestId,
        });
      }
    }

    if (attachments.length === 0) {
      return jsonFail(400, "Žádná příloha k odeslání.", null, {
        step: "attachmentsEmpty",
        requestId,
      });
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
        jobId: resolvedJobId || null,
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
        mainDocumentFilename,
        attachmentDetails: attachmentDetails.length
          ? (attachmentDetails as {
              filename: string;
              source: JobDocumentEmailAttachmentSourceLabel;
            }[])
          : null,
      });
    } catch (sendErr) {
      const msg = errorMessageFromUnknown(sendErr);
      const detail = errorStackFromUnknown(sendErr) ?? serializeUnknownForLog(sendErr);
      console.error(ROUTE_LOG, "sendDocumentEmail threw", {
        requestId,
        companyId,
        jobId: resolvedJobId || null,
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
        jobId: resolvedJobId || null,
        documentType: type,
        error: result.error,
        detail: result.detail,
      });
      return jsonFail(502, result.error, result.detail, { step: "sendDocumentEmail.result" });
    }
    console.info(ROUTE_LOG, "email sent ok", {
      requestId,
      companyId,
      jobId: resolvedJobId || null,
      documentType: type,
    });

    if (type === "material_order" && materialOrderIdRaw && resolvedJobId) {
      try {
        const moRef = db
          .collection(COMPANIES_COLLECTION)
          .doc(companyId)
          .collection("jobs")
          .doc(resolvedJobId)
          .collection("materialOrders")
          .doc(materialOrderIdRaw);
        const moSnap = await moRef.get();
        const odata = (moSnap.data() ?? {}) as Record<string, unknown>;
        const isQuick = String(odata.orderKind ?? "") === "quick_text";

        let fileUrl: string | null = null;
        let storagePathOut: string | null = null;
        let fileNameOut: string | null = null;
        if (isQuick && attachments.length > 0) {
          const first = attachments[0];
          const buf = first?.content;
          if (buf && Buffer.isBuffer(buf)) {
            const bucket = getAdminStorageBucket();
            if (bucket) {
              const token = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now());
              const storagePath = `companies/${companyId}/jobs/${resolvedJobId}/materialOrderPdfExports/${materialOrderIdRaw}.pdf`;
              const file = bucket.file(storagePath);
              await file.save(buf, {
                contentType: "application/pdf",
                metadata: {
                  metadata: { firebaseStorageDownloadTokens: token },
                  cacheControl: "public, max-age=31536000",
                },
                resumable: false,
              });
              storagePathOut = storagePath;
              fileNameOut = String(first.filename || `objednavka-materialu.pdf`).trim() || "objednavka-materialu.pdf";
              fileUrl = storageDownloadUrl(bucket.name, storagePath, token);
            } else {
              console.warn(ROUTE_LOG, "quick material order: storage bucket missing, skip file upload");
            }
          }
        }

        const merge: Record<string, unknown> = {
          lastEmailSentAt: FieldValue.serverTimestamp(),
          lastEmailSentTo: to.trim().toLowerCase(),
          lastEmailSentCc: ccExtra,
          lastEmailSentByUid: caller.uid,
          lastEmailSubject: subject.trim(),
          emailStatus: "sent",
        };
        if (isQuick) {
          merge.quickOrderStatus = "sent";
          merge.sentAt = FieldValue.serverTimestamp();
          merge.sentBy = caller.uid;
          merge.sentByName = sentByDisplayName;
          merge.recipientEmail = to.trim().toLowerCase();
          merge.cc = ccExtra.length ? ccExtra.join(", ") : null;
          if (fileUrl) merge.fileUrl = fileUrl;
          if (storagePathOut) merge.storagePath = storagePathOut;
          if (fileNameOut) merge.fileName = fileNameOut;
        }
        await moRef.set(merge, { merge: true });
      } catch (moErr) {
        console.error(ROUTE_LOG, "materialOrders merge failed", serializeUnknownForLog(moErr));
      }
    }

    try {
      const attNames = attachments.map((a) => a.filename).filter(Boolean);
      await recordEmailOutboundOnPrimaryDocs(db, {
        companyId,
        jobId: resolvedJobId || null,
        type,
        documentId: type === "received_document" ? docId : null,
        invoiceId: type === "invoice" || type === "advance_invoice" ? invoiceId : null,
        to,
        cc: ccExtra,
        subject,
        userId: caller.uid,
        sentByEmail,
        attachmentFilenames: attNames,
      });
    } catch (recErr) {
      console.error(ROUTE_LOG, "recordEmailOutboundOnPrimaryDocs failed", {
        requestId,
        message: errorMessageFromUnknown(recErr),
        serialized: serializeUnknownForLog(recErr),
      });
    }

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
