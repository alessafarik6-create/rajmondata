import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import {
  dispatchJobActivityNotifications,
  type JobActivityNotifyEvent,
} from "@/lib/email-notifications/job-activity-notify-server";

const EVENTS = new Set<JobActivityNotifyEvent>([
  "file_upload",
  "folder_create",
  "file_note",
  "drawing_annotation",
  "job_chat",
  "customer_job_chat",
  "file_chat",
  "customer_drawing_reminder",
  "drawing_approved",
  "drawing_rejected",
]);

type Body = {
  companyId?: string;
  jobId?: string;
  eventType?: string;
  folderId?: string | null;
  folderName?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  messagePreview?: string | null;
  batchFileNames?: string[] | null;
  visibleToCustomer?: boolean | null;
  entityId?: string | null;
};

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  const eventType = String(body.eventType ?? "").trim() as JobActivityNotifyEvent;

  if (!companyId || !jobId) {
    return NextResponse.json({ error: "Chybí companyId nebo jobId." }, { status: 400 });
  }
  if (!EVENTS.has(eventType)) {
    return NextResponse.json({ error: "Neplatný typ události." }, { status: 400 });
  }
  if (!callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ error: "Přístup odepřen." }, { status: 403 });
  }

  const callerSnap = await db.collection("users").doc(caller.uid).get();
  const callerData = callerSnap.data() as Record<string, unknown> | undefined;
  const actorName =
    String(callerData?.displayName ?? callerData?.name ?? callerData?.email ?? "").trim() ||
    "Uživatel";

  const batchFileNames = Array.isArray(body.batchFileNames)
    ? body.batchFileNames.map((x) => String(x).trim()).filter(Boolean)
    : undefined;

  const result = await dispatchJobActivityNotifications(db, {
    companyId,
    jobId,
    eventType,
    actorUid: caller.uid,
    actorName,
    actorRole: caller.role,
    folderId: body.folderId != null ? String(body.folderId).trim() : null,
    folderName: body.folderName != null ? String(body.folderName).trim() : null,
    fileId: body.fileId != null ? String(body.fileId).trim() : null,
    fileName: body.fileName != null ? String(body.fileName).trim() : null,
    messagePreview:
      body.messagePreview != null ? String(body.messagePreview).trim().slice(0, 400) : null,
    batchFileNames,
    visibleToCustomer:
      typeof body.visibleToCustomer === "boolean" ? body.visibleToCustomer : null,
    entityId: body.entityId != null ? String(body.entityId).trim() : null,
  });

  return NextResponse.json({ ...result, ok: result.ok });
}
