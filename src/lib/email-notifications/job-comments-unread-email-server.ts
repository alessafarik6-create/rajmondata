import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  buildNotificationHtml,
  sendTransactionalEmail,
} from "@/lib/email-notifications/resend-send";
import {
  jobChatEmailEnabled,
  photoDocUnreadEmailEnabled,
  unreadPhotoNoteIntervalMode,
  shouldThrottleFileThreadEmail,
  buildPhotoCommentDeepLinkQuery,
} from "@/lib/job-photo-comment-email-settings";

const PRIVILEGED_ROLES = ["owner", "admin", "manager", "accountant", "super_admin"] as const;
const JOB_CHAT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type JobCommentRow = Record<string, unknown>;

export function isPrivilegedRole(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role as (typeof PRIVILEGED_ROLES)[number]);
}

export function chatEmailRateKey(
  jobId: string,
  targetType: "job" | "file",
  fileId: string | null,
  folderId: string | null
): string {
  if (targetType === "job") return `job:${jobId}`;
  return `file:${jobId}:${fileId ?? ""}:${folderId ?? ""}`;
}

export function normalizeEmail(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s || !s.includes("@")) return null;
  return s;
}

export function commentMatchesThread(
  c: JobCommentRow,
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

export function recipientHasReadComment(c: JobCommentRow, uid: string): boolean {
  const readAtBy = c.readAtBy as Record<string, unknown> | undefined;
  if (readAtBy && readAtBy[uid] != null) return true;
  const readBy = c.readBy as string[] | undefined;
  return Array.isArray(readBy) && readBy.includes(uid);
}

export function hasUnreadIncomingForUser(
  rows: JobCommentRow[],
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

export function lastChatEmailMs(
  user: Record<string, unknown> | undefined,
  rateKey: string
): number {
  const m = user?.jobFileChatEmailLastSent as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return 0;
  const v = m[rateKey];
  if (v instanceof Timestamp) return v.toMillis();
  if (
    v &&
    typeof v === "object" &&
    "toMillis" in v &&
    typeof (v as Timestamp).toMillis === "function"
  ) {
    return (v as Timestamp).toMillis();
  }
  return 0;
}

export function portalLinkPathForRecipient(
  recipient: Record<string, unknown> | undefined,
  jobId: string,
  targetType: "job" | "file",
  fileId: string | null,
  folderId: string | null,
  fileName: string | null
): string {
  const role = String(recipient?.role ?? "").trim();
  const base =
    role === "employee"
      ? `/portal/employee/jobs/${encodeURIComponent(jobId)}`
      : `/portal/jobs/${encodeURIComponent(jobId)}`;
  if (targetType === "file" && fileId) {
    return `${base}${buildPhotoCommentDeepLinkQuery(folderId, fileId, fileName)}`;
  }
  return base;
}

function recipientWantsEmail(params: {
  recipient: Record<string, unknown> | undefined;
  targetType: "job" | "file";
}): boolean {
  const { recipient, targetType } = params;
  const role = String(recipient?.role ?? "").trim();
  if (targetType === "file" && role === "employee") {
    return photoDocUnreadEmailEnabled(recipient);
  }
  return jobChatEmailEnabled(recipient);
}

function shouldThrottleRecipient(params: {
  recipient: Record<string, unknown> | undefined;
  targetType: "job" | "file";
  lastMs: number;
}): boolean {
  const { recipient, targetType, lastMs } = params;
  const role = String(recipient?.role ?? "").trim();
  if (targetType === "job") {
    return Boolean(lastMs && Date.now() - lastMs < JOB_CHAT_COOLDOWN_MS);
  }
  if (role === "employee") {
    const mode = unreadPhotoNoteIntervalMode(recipient);
    return shouldThrottleFileThreadEmail({ lastSentMs: lastMs, mode });
  }
  return Boolean(lastMs && Date.now() - lastMs < JOB_CHAT_COOLDOWN_MS);
}

export async function trySendUnreadJobCommentEmail(params: {
  db: Firestore;
  callerUid: string;
  /** Pokud true, neřeší se shoda s příjemcem (cron). */
  skipCallerMatch?: boolean;
  targetUserId: string;
  jobId: string;
  jobTitle: string;
  targetType: "job" | "file";
  fileId: string | null;
  folderId: string | null;
  fileName: string | null;
  messagePreview: string;
  commentRows: JobCommentRow[];
  appBaseUrl: string;
}): Promise<boolean> {
  const {
    db,
    callerUid,
    skipCallerMatch = false,
    targetUserId,
    jobId,
    jobTitle,
    targetType,
    fileId,
    folderId,
    fileName,
    messagePreview,
    commentRows,
    appBaseUrl,
  } = params;

  if (!targetUserId) return false;
  if (!skipCallerMatch && targetUserId === callerUid) return false;
  if (!hasUnreadIncomingForUser(commentRows, targetUserId, targetType, fileId, folderId)) {
    return false;
  }

  const uSnap = await db.collection("users").doc(targetUserId).get();
  const u = uSnap.data() as Record<string, unknown> | undefined;
  if (!recipientWantsEmail({ recipient: u, targetType })) return false;
  const to = normalizeEmail(u?.email);
  if (!to) return false;

  const rateKey = chatEmailRateKey(jobId, targetType, fileId, folderId);
  const lastMs = lastChatEmailMs(u, rateKey);
  if (shouldThrottleRecipient({ recipient: u, targetType, lastMs })) {
    return false;
  }

  const linkPath = portalLinkPathForRecipient(u, jobId, targetType, fileId, folderId, fileName);
  const actionHref = appBaseUrl
    ? `${appBaseUrl}${linkPath.startsWith("/") ? linkPath : `/${linkPath}`}`
    : linkPath;

  const snippet =
    messagePreview.trim() ||
    (targetType === "file"
      ? "Máte nepřečtenou poznámku u souboru ve fotodokumentaci — otevřete zakázku v portálu."
      : "V chatu máte nepřečtenou zprávu — otevřete zakázku v portálu.");

  const lines = [
    `Zakázka: ${jobTitle}`,
    targetType === "file" ? `Soubor / fotodokumentace: ${fileName || "—"}` : null,
    `Náhled: ${snippet}`,
  ].filter(Boolean) as string[];

  const subject =
    targetType === "file"
      ? `Nová nepřečtená poznámka ve fotodokumentaci — ${jobTitle}`
      : `Poznámka k zakázce — ${jobTitle}`;

  const html = buildNotificationHtml({
    moduleLabel: targetType === "file" ? "Fotodokumentace" : "Chat u zakázky",
    title:
      targetType === "file"
        ? "Nová nepřečtená poznámka ve fotodokumentaci"
        : "Poznámka k zakázce",
    lines,
    actionUrl: actionHref,
    companyName: null,
  });

  const sendResult = await sendTransactionalEmail({
    to: [to],
    subject,
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
      console.warn("[job-comments-unread-email] stamp failed", targetUserId, e);
    }
    return true;
  }
  return false;
}
