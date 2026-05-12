import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { emitPortalNotification } from "@/lib/portal-notifications-server";
import {
  isPrivilegedRole,
  trySendUnreadJobCommentEmail,
  type JobCommentRow,
} from "@/lib/email-notifications/job-comments-unread-email-server";

type Body = {
  companyId?: string;
  jobId?: string;
  targetType?: "job" | "file";
  fileId?: string | null;
  folderId?: string | null;
  fileName?: string | null;
  messagePreview?: string | null;
};

function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
      .trim()
      .replace(/\/$/, "") || ""
  );
}

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  const targetType = body.targetType === "file" ? "file" : "job";
  const fileId = body.fileId != null ? String(body.fileId).trim() : null;
  const folderId = body.folderId != null ? String(body.folderId).trim() : null;
  const fileName = body.fileName != null ? String(body.fileName).trim() : null;
  const messagePreview =
    body.messagePreview != null ? String(body.messagePreview).trim().slice(0, 400) : "";

  if (!companyId || !jobId) {
    return NextResponse.json({ error: "Chybí companyId nebo jobId." }, { status: 400 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  if (String(caller.companyId ?? "") !== companyId) {
    return NextResponse.json({ error: "Neplatná organizace." }, { status: 403 });
  }

  const callerRole = String(caller.role ?? "").trim();
  const callerName =
    String(caller.displayName ?? caller.name ?? caller.email ?? "").trim() ||
    "Uživatel";

  const linkPath =
    callerRole === "employee"
      ? `/portal/employee/jobs/${encodeURIComponent(jobId)}`
      : `/portal/jobs/${encodeURIComponent(jobId)}`;

  const title =
    targetType === "file" ? "Poznámka k souboru" : "Poznámka k zakázce";
  const whereLabel =
    targetType === "file" ? fileName || "soubor" : "zakázka";

  const bodyText = `${callerName}: nová zpráva (${whereLabel}).`;

  let jobTitle = "";
  try {
    const jobSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .get();
    const jd = jobSnap.data() as Record<string, unknown> | undefined;
    jobTitle =
      String(jd?.title ?? jd?.name ?? jd?.jobTitle ?? "").trim() || "Zakázka";
  } catch {
    jobTitle = "Zakázka";
  }

  let commentRows: JobCommentRow[] = [];
  try {
    const cs = await db
      .collection("companies")
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("comments")
      .limit(400)
      .get();
    commentRows = cs.docs.map((d) => ({ id: d.id, ...d.data() })) as JobCommentRow[];
  } catch {
    commentRows = [];
  }

  const baseUrl = appBaseUrl();

  const tryEmailForTarget = async (targetUserId: string) => {
    await trySendUnreadJobCommentEmail({
      db,
      callerUid,
      targetUserId,
      jobId,
      jobTitle,
      targetType,
      fileId,
      folderId,
      fileName,
      messagePreview,
      commentRows,
      appBaseUrl: baseUrl,
    });
  };

  try {
    if (callerRole === "employee") {
      const usersSnap = await db
        .collection("users")
        .where("companyId", "==", companyId)
        .where("role", "in", ["owner", "admin", "manager", "accountant"])
        .get();
      const targets = usersSnap.docs
        .map((d) => d.id)
        .filter((uid) => uid && uid !== callerUid);

      await Promise.allSettled(
        targets.map((uid) =>
          emitPortalNotification({
            targetUserId: uid,
            companyId,
            category: "system",
            title,
            body: bodyText,
            linkUrl: linkPath,
            source: "api/jobs/comments/notify",
          })
        )
      );

      await Promise.allSettled(targets.map((uid) => tryEmailForTarget(uid)));
    } else if (isPrivilegedRole(callerRole)) {
      const membersSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("jobs")
        .doc(jobId)
        .collection("jobMembers")
        .get();
      const targets = membersSnap.docs
        .map((d) => {
          const x = d.data() as { authUserId?: string | null };
          const uid = typeof x.authUserId === "string" ? x.authUserId.trim() : "";
          return uid || null;
        })
        .filter((uid): uid is string => Boolean(uid && uid !== callerUid));

      await Promise.allSettled(
        targets.map((uid) =>
          emitPortalNotification({
            targetUserId: uid,
            companyId,
            category: "system",
            title,
            body: bodyText,
            linkUrl: linkPath,
            source: "api/jobs/comments/notify",
          })
        )
      );

      await Promise.allSettled(targets.map((uid) => tryEmailForTarget(uid)));
    }
  } catch (e) {
    console.warn("[jobs/comments/notify] emit failed", e);
  }

  return NextResponse.json({ ok: true });
}
