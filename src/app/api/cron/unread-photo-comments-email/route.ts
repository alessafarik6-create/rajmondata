import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  trySendUnreadJobCommentEmail,
  type JobCommentRow,
} from "@/lib/email-notifications/job-comments-unread-email-server";

export const dynamic = "force-dynamic";

const CRON_SENDER = "__unread_photo_comment_cron__";

function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
      .trim()
      .replace(/\/$/, "") || ""
  );
}

function parseCommentDocPath(path: string): { companyId: string; jobId: string } | null {
  const parts = path.split("/");
  const ci = parts.indexOf("companies");
  const ji = parts.indexOf("jobs");
  if (ci < 0 || ji < 0 || ji + 2 >= parts.length) return null;
  return { companyId: parts[ci + 1], jobId: parts[ji + 1] };
}

/**
 * Opakované e-maily na nepřečtené poznámky u souborů ve fotodokumentaci (interval dle profilu uživatele).
 * Volat např. každou hodinu: GET /api/cron/unread-photo-comments-email?secret=CRON_SECRET
 */
export async function GET(request: NextRequest) {
  try {
    const secret = String(process.env.CRON_SECRET ?? "").trim();
    const q = request.nextUrl.searchParams.get("secret") ?? "";
    if (!secret || q !== secret) {
      return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Firestore není k dispozici." }, { status: 503 });
    }

    const baseUrl = appBaseUrl();
    const since = Timestamp.fromMillis(Date.now() - 21 * 24 * 60 * 60 * 1000);

    const snap = await db
      .collectionGroup("comments")
      .where("targetType", "==", "file")
      .where("createdAt", ">", since)
      .orderBy("createdAt", "desc")
      .limit(400)
      .get();

    const jobKey = (companyId: string, jobId: string) => `${companyId}/${jobId}`;
    const commentsCache = new Map<string, JobCommentRow[]>();
    const jobTitleCache = new Map<string, string>();
    const membersCache = new Map<string, string[]>();

    let emailsAttempted = 0;
    let emailsSent = 0;

    for (const doc of snap.docs) {
      const parsed = parseCommentDocPath(doc.ref.path);
      if (!parsed) continue;
      const { companyId, jobId } = parsed;
      const jk = jobKey(companyId, jobId);

      if (!commentsCache.has(jk)) {
        try {
          const cs = await db
            .collection("companies")
            .doc(companyId)
            .collection("jobs")
            .doc(jobId)
            .collection("comments")
            .limit(400)
            .get();
          commentsCache.set(
            jk,
            cs.docs.map((d) => ({ id: d.id, ...d.data() })) as JobCommentRow[]
          );
        } catch {
          commentsCache.set(jk, []);
        }
      }

      if (!jobTitleCache.has(jk)) {
        try {
          const jobSnap = await db
            .collection("companies")
            .doc(companyId)
            .collection("jobs")
            .doc(jobId)
            .get();
          const jd = jobSnap.data() as Record<string, unknown> | undefined;
          jobTitleCache.set(
            jk,
            String(jd?.title ?? jd?.name ?? jd?.jobTitle ?? "").trim() || "Zakázka"
          );
        } catch {
          jobTitleCache.set(jk, "Zakázka");
        }
      }

      if (!membersCache.has(jk)) {
        try {
          const ms = await db
            .collection("companies")
            .doc(companyId)
            .collection("jobs")
            .doc(jobId)
            .collection("jobMembers")
            .get();
          const ids = ms.docs
            .map((d) => {
              const x = d.data() as { authUserId?: string | null };
              return typeof x.authUserId === "string" ? x.authUserId.trim() : "";
            })
            .filter(Boolean);
          membersCache.set(jk, ids);
        } catch {
          membersCache.set(jk, []);
        }
      }

      const row = doc.data() as JobCommentRow;
      const fileId = row.fileId != null ? String(row.fileId).trim() : null;
      const folderId = row.folderId != null ? String(row.folderId).trim() : null;
      const fileName = row.fileName != null ? String(row.fileName).trim() : null;
      const preview = String(row.message ?? "").trim().slice(0, 400);
      const commentRows = commentsCache.get(jk) ?? [];
      const jobTitle = jobTitleCache.get(jk) ?? "Zakázka";
      const members = membersCache.get(jk) ?? [];

      for (const uid of members) {
        if (!uid) continue;
        emailsAttempted += 1;
        const ok = await trySendUnreadJobCommentEmail({
          db,
          callerUid: CRON_SENDER,
          skipCallerMatch: true,
          targetUserId: uid,
          jobId,
          jobTitle,
          targetType: "file",
          fileId,
          folderId,
          fileName,
          messagePreview: preview,
          commentRows,
          appBaseUrl: baseUrl,
        });
        if (ok) emailsSent += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: snap.size,
      emailsAttempted,
      emailsSent,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/unread-photo-comments-email]", err);
    return NextResponse.json(
      { ok: false, error: msg || "Cron selhal." },
      { status: 500 }
    );
  }
}
