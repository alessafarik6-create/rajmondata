import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { emitPortalNotification } from "@/lib/portal-notifications-server";
import {
  buildNotificationHtml,
  sendTransactionalEmail,
} from "@/lib/email-notifications/resend-send";

type Body = {
  companyId?: string;
  jobId?: string;
  targetType?: "job" | "file";
  fileId?: string | null;
  folderId?: string | null;
  fileName?: string | null;
  /** Krátký text poslední zprávy pro e-mail (volitelné). */
  messagePreview?: string | null;
};

const PRIVILEGED_ROLES = ["owner", "admin", "manager", "accountant", "super_admin"] as const;

const CHAT_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function isPrivilegedRole(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role as (typeof PRIVILEGED_ROLES)[number]);
}

function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
      .trim()
      .replace(/\/$/, "") || ""
  );
}

function chatEmailRateKey(
  jobId: string,
  targetType: "job" | "file",
  fileId: string | null,
  folderId: string | null
): string {
  if (targetType === "job") return `job:${jobId}`;
  return `file:${jobId}:${fileId ?? ""}:${folderId ?? ""}`;
}

function normalizeEmail(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s || !s.includes("@")) return null;
  return s;
}

type CommentRow = Record<string, unknown>;

function commentMatchesThread(
  c: CommentRow,
  targetType: "job" | "file",
  fileId: string | null,
  folderId: string | null
): boolean {
  if (String(c.targetType ?? "") !== targetType) return false;
  if (targetType === "job") return true;
  if (String(c.fileId ?? "") !== String(fileId ?? "")) return false;
  const cf = c.folderId ?? null;
  const want = folderId ?? null;
  return cf === want;
}

function recipientHasReadComment(c: CommentRow, uid: string): boolean {
  const readAtBy = c.readAtBy as Record<string, unknown> | undefined;
  if (readAtBy && readAtBy[uid] != null) return true;
  const readBy = c.readBy as string[] | undefined;
  return Array.isArray(readBy) && readBy.includes(uid);
}

function hasUnreadIncomingForUser(
  rows: CommentRow[],
  uid: string,
  targetType: "job" | "file",
  fileId: string | null,
  folderId: string | null
): boolean {
  for (const c of rows) {
    if (!commentMatchesThread(c, targetType, fileId, folderId)) continue;
    if (String(c.authorId ?? "") === uid) continue;
    if (recipientHasReadComment(c, uid)) continue;
    return true;
  }
  return false;
}

function emailNotificationsEnabled(user: Record<string, unknown> | undefined): boolean {
  if (!user) return true;
  if (user.emailMessageNotificationsEnabled === false) return false;
  return true;
}

function lastChatEmailMs(user: Record<string, unknown> | undefined, rateKey: string): number {
  const m = user?.jobFileChatEmailLastSent as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return 0;
  const v = m[rateKey];
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as Timestamp).toMillis === "function") {
    return (v as Timestamp).toMillis();
  }
  return 0;
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
    targetType === "file"
      ? "Poznámka k souboru"
      : "Poznámka k zakázce";
  const whereLabel =
    targetType === "file"
      ? fileName || "soubor"
      : "zakázka";

  const bodyText = `${callerName}: nová zpráva (${whereLabel}).`;

  const rateKey = chatEmailRateKey(jobId, targetType, fileId, folderId);

  let jobTitle = "";
  try {
    const jobSnap = await db.collection("companies").doc(companyId).collection("jobs").doc(jobId).get();
    const jd = jobSnap.data() as Record<string, unknown> | undefined;
    jobTitle =
      String(jd?.title ?? jd?.name ?? jd?.jobTitle ?? "").trim() || "Zakázka";
  } catch {
    jobTitle = "Zakázka";
  }

  let commentRows: CommentRow[] = [];
  try {
    const cs = await db
      .collection("companies")
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("comments")
      .limit(400)
      .get();
    commentRows = cs.docs.map((d) => ({ id: d.id, ...d.data() })) as CommentRow[];
  } catch {
    commentRows = [];
  }

  const tryEmailForTarget = async (targetUserId: string) => {
    if (!targetUserId || targetUserId === callerUid) return;
    if (!hasUnreadIncomingForUser(commentRows, targetUserId, targetType, fileId, folderId)) {
      return;
    }
    const uSnap = await db.collection("users").doc(targetUserId).get();
    const u = uSnap.data() as Record<string, unknown> | undefined;
    if (!emailNotificationsEnabled(u)) return;
    const to = normalizeEmail(u?.email);
    if (!to) return;
    const lastMs = lastChatEmailMs(u, rateKey);
    if (lastMs && Date.now() - lastMs < CHAT_EMAIL_COOLDOWN_MS) return;

    const base = appBaseUrl();
    const actionHref = base ? `${base}${linkPath.startsWith("/") ? linkPath : `/${linkPath}`}` : linkPath;

    const snippet =
      messagePreview ||
      "V chatu máte nepřečtenou zprávu — otevřete zakázku v portálu.";

    const lines = [
      `Zakázka: ${jobTitle}`,
      targetType === "file" ? `Soubor: ${fileName || "—"}` : null,
      `Zpráva: ${snippet}`,
    ].filter(Boolean) as string[];

    const html = buildNotificationHtml({
      moduleLabel: "Chat u zakázky",
      title,
      lines,
      actionUrl: actionHref,
      companyName: null,
    });

    const sendResult = await sendTransactionalEmail({
      to: [to],
      subject: `${title} — ${jobTitle}`,
      html,
    });

    if (sendResult.ok) {
      try {
        await db
          .collection("users")
          .doc(targetUserId)
          .update({
            [`jobFileChatEmailLastSent.${rateKey}`]: FieldValue.serverTimestamp(),
          });
      } catch (e) {
        console.warn("[jobs/comments/notify] rate-limit stamp failed", targetUserId, e);
      }
    }
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
