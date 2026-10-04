import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { SecretaryContext } from "@/lib/ai/secretary/context";
import {
  consumePendingSecretaryAction,
  loadPendingSecretaryAction,
  proposeSecretaryAction,
  updatePendingSecretaryAction,
  userUtteranceConfirmsAction,
} from "@/lib/ai/secretary/confirmation";
import {
  assertEmailAccountAccess,
  assertMessageAccess,
  loadAccessibleAccountIdSet,
  listEmailAccountsAccessibleToUser,
  messageBelongsToUser,
} from "@/lib/email-mailbox/account-access";
import { suggestEmailReplyDraft } from "@/lib/email-mailbox/ai-analyze-message";
import { attachmentCountForList, userVisibleAttachments } from "@/lib/email-mailbox/attachment-meta";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { buildMessageViewFilter } from "@/lib/email-mailbox/message-store";
import { sendEmailFromAccount } from "@/lib/email-mailbox/send-service";
import type { EmailMessageDoc, EmailMessageWorkflowView } from "@/lib/email-mailbox/types";
import { isEmailAccountSyncable } from "@/lib/email-mailbox/account-default";
import { getOpenAiApiKey, getOpenAiModel, isAiFeatureEnabled } from "@/lib/ai/config";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { logSecretaryAudit } from "@/lib/ai/secretary/audit";

export type EmailListItem = {
  emailId: string;
  mailboxId: string;
  from: string;
  senderName: string;
  subject: string;
  receivedAt: string | null;
  preview: string;
  requiresReply: boolean;
  priority: string | null;
  category: string | null;
  hasAttachments: boolean;
  unread: boolean;
};

const EMAIL_SEND_PENDING_TYPES = new Set(["reply_email", "forward_email", "compose_email"]);

function parseSenderName(from: string): string {
  const t = String(from ?? "").trim();
  const m = t.match(/^([^<]+)</);
  if (m?.[1]) return m[1].trim().replace(/^"|"$/g, "");
  if (t.includes("@")) return t.split("@")[0] ?? t;
  return t || "Neznámý odesílatel";
}

function extractReplyAddress(from: string): string {
  const t = String(from ?? "").trim();
  const m = t.match(/<([^>]+@[^>]+)>/);
  if (m?.[1]) return m[1].trim();
  if (t.includes("@")) return t.split(/\s+/).find((p) => p.includes("@")) ?? t;
  return t;
}

function messagePreview(m: EmailMessageDoc): string {
  const summary = String(m.aiSummary ?? "").trim();
  if (summary) return summary.slice(0, 220);
  const body =
    (m.textBody ?? "").trim() ||
    String(m.htmlBody ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return body.slice(0, 180);
}

function plainBody(m: EmailMessageDoc, max = 12000): string {
  const body =
    (m.textBody ?? "").trim() ||
    String(m.htmlBody ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return body.slice(0, max);
}

function toListItem(m: EmailMessageDoc & { id: string }): EmailListItem {
  return {
    emailId: m.id,
    mailboxId: m.emailAccountId,
    from: m.from ?? "",
    senderName: parseSenderName(m.from ?? ""),
    subject: m.subject ?? "(bez předmětu)",
    receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() ?? null,
    preview: messagePreview(m),
    requiresReply: Boolean(m.needsReply || m.requiresAction),
    priority: m.aiPriority ?? null,
    category: m.aiCategory ?? null,
    hasAttachments: attachmentCountForList(m.attachments) > 0,
    unread: !m.isRead,
  };
}

async function loadFilteredMessages(
  db: Firestore,
  companyId: string,
  userId: string,
  opts: {
    mailboxId?: string;
    folder?: string;
    unreadOnly?: boolean;
    maxScan?: number;
  }
): Promise<(EmailMessageDoc & { id: string })[]> {
  const accessibleIds = await loadAccessibleAccountIdSet(db, companyId, userId);
  if (accessibleIds.size === 0) return [];

  const view = (opts.folder ?? "inbox") as EmailMessageWorkflowView;
  const filterFn = buildMessageViewFilter(view, userId);
  const mailboxId = opts.mailboxId?.trim();

  let snap;
  try {
    snap = await emailMessagesCol(db, companyId).orderBy("receivedAt", "desc").limit(160).get();
  } catch {
    snap = await emailMessagesCol(db, companyId).limit(200).get();
  }

  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }))
    .filter((m) => messageBelongsToUser(m, userId, accessibleIds))
    .filter((m) => !mailboxId || m.emailAccountId === mailboxId)
    .filter(filterFn)
    .filter((m) => !opts.unreadOnly || !m.isRead)
    .sort((a, b) => (b.receivedAt?.toMillis?.() ?? 0) - (a.receivedAt?.toMillis?.() ?? 0))
    .slice(0, opts.maxScan ?? 120);
}

export async function getRecentEmailsTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: {
    mailboxId?: string;
    limit?: number;
    folder?: string;
    unreadOnly?: boolean;
  }
): Promise<{ emails: EmailListItem[] }> {
  const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 8);
  const rows = await loadFilteredMessages(db, ctx.companyId, ctx.userId, {
    mailboxId: args.mailboxId,
    folder: args.folder,
    unreadOnly: Boolean(args.unreadOnly),
  });
  return { emails: rows.slice(0, limit).map(toListItem) };
}

export async function searchEmailsTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: {
    query?: string;
    mailboxId?: string;
    unreadOnly?: boolean;
    requiresReplyOnly?: boolean;
    receivedAfterIso?: string;
    limit?: number;
  }
): Promise<{ emails: EmailListItem[] }> {
  const q = String(args.query ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit ?? 8) || 8, 1), 12);
  const afterMs = args.receivedAfterIso ? new Date(args.receivedAfterIso).getTime() : null;

  let rows = await loadFilteredMessages(db, ctx.companyId, ctx.userId, {
    mailboxId: args.mailboxId,
    folder: "inbox",
    unreadOnly: Boolean(args.unreadOnly),
  });

  if (afterMs != null && !Number.isNaN(afterMs)) {
    rows = rows.filter((m) => (m.receivedAt?.toMillis?.() ?? 0) >= afterMs);
  }
  if (args.requiresReplyOnly) {
    rows = rows.filter((m) => Boolean(m.needsReply || m.requiresAction));
  }

  if (q) {
    rows = rows.filter((m) => {
      const hay = [
        m.from,
        m.subject,
        m.aiSummary,
        m.customerName,
        plainBody(m, 2000),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return { emails: rows.slice(0, limit).map(toListItem) };
}

export async function getEmailDetailTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { emailId?: string; messageId?: string; mailboxId?: string }
): Promise<{ email: Record<string, unknown> | null; message?: string }> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  if (!emailId) return { email: null, message: "Chybí ID e-mailu." };

  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "read");
  if (!access.ok) return { email: null, message: access.error };

  const m = access.message;
  if (args.mailboxId?.trim() && m.emailAccountId !== args.mailboxId.trim()) {
    return { email: null, message: "E-mail nepatří do uvedené schránky." };
  }

  const attachments = userVisibleAttachments(m.attachments ?? []).map((a) => ({
    attachmentId: a.id,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.size ?? null,
  }));

  const body = plainBody(m, 10000);
  return {
    email: {
      emailId: m.id,
      mailboxId: m.emailAccountId,
      from: m.from,
      senderName: parseSenderName(m.from ?? ""),
      subject: m.subject,
      receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() ?? null,
      preview: messagePreview(m),
      bodyForVoice: body,
      bodyLength: body.length,
      aiSummary: m.aiSummary ?? null,
      requiresReply: Boolean(m.needsReply || m.requiresAction),
      priority: m.aiPriority ?? null,
      category: m.aiCategory ?? null,
      hasAttachments: attachments.length > 0,
      attachments,
      resolved: Boolean(m.resolved),
    },
  };
}

async function rewriteEmailBodyWithInstruction(
  currentBody: string,
  instruction: string,
  context: { subject: string; to: string }
): Promise<string> {
  if (!isAiFeatureEnabled()) return currentBody;
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return currentBody;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAiModel(),
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "Uprav návrh e-mailu v češtině podle pokynu uživatele. Vrať jen finální text zprávy, bez vysvětlení.",
        },
        {
          role: "user",
          content: `Předmět: ${context.subject}\nKomu: ${context.to}\nPokyn: ${instruction}\n\nSoučasný návrh:\n${currentBody.slice(0, 6000)}`,
        },
      ],
    }),
  });
  if (!res.ok) return currentBody;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() || currentBody;
}

async function generateReplyBody(
  m: EmailMessageDoc,
  instruction?: string
): Promise<string | null> {
  if (instruction?.trim()) {
    const base =
      (await suggestEmailReplyDraft(m, { tone: "default" })) ??
      "Dobrý den,\n\nděkuji za zprávu.\n\nS pozdravem";
    return rewriteEmailBodyWithInstruction(base, instruction, {
      subject: m.subject ?? "",
      to: extractReplyAddress(m.from ?? ""),
    });
  }
  return suggestEmailReplyDraft(m, { tone: "default" });
}

export type EmailSendPendingPayload = {
  emailId?: string;
  mailboxId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  forwardFromMessageId?: string;
  forwardAttachmentIds?: string[];
};

function formatSendSummary(payload: EmailSendPendingPayload): string {
  const to = payload.to.join(", ");
  return `Odešlu zprávu na ${to}, předmět „${payload.subject}“. Chcete ji odeslat?`;
}

async function findLatestEmailPending(
  db: Firestore,
  companyId: string,
  userId: string
): Promise<{ id: string; payload: EmailSendPendingPayload; type: string } | null> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("aiSecretaryPending")
    .where("userId", "==", userId)
    .where("status", "==", "pending")
    .limit(10)
    .get();
  for (const doc of snap.docs) {
    const data = doc.data() as { type?: string; expiresAt?: { toMillis?: () => number } };
    if (!EMAIL_SEND_PENDING_TYPES.has(String(data.type))) continue;
    if (data.expiresAt?.toMillis?.() != null && data.expiresAt.toMillis() < Date.now()) continue;
    return {
      id: doc.id,
      type: String(data.type),
      payload: doc.data().payload as EmailSendPendingPayload,
    };
  }
  return null;
}

export async function createEmailReplyDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: {
    emailId?: string;
    messageId?: string;
    mailboxId?: string;
    instruction?: string;
  }
): Promise<{ ok: boolean; pendingActionId?: string; summary?: string; draft?: Record<string, unknown> }> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  if (!emailId) return { ok: false, summary: "Chybí e-mail." };

  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "write");
  if (!access.ok) return { ok: false, summary: access.error };

  const m = access.message;
  const accountAccess = await assertEmailAccountAccess(
    db,
    ctx.companyId,
    m.emailAccountId,
    ctx.userId,
    "write"
  );
  if (!accountAccess.ok) return { ok: false, summary: accountAccess.error };
  if (!isEmailAccountSyncable(accountAccess.account)) {
    return { ok: false, summary: "Ze schránky nelze odesílat — účet je odpojený." };
  }

  const body = await generateReplyBody(m, args.instruction);
  if (!body?.trim()) return { ok: false, summary: "Nepodařilo se vytvořit návrh odpovědi." };

  const to = [extractReplyAddress(m.from ?? "")].filter(Boolean);
  const subject = String(m.subject ?? "").trim() || "(bez předmětu)";
  const payload: EmailSendPendingPayload = {
    emailId,
    mailboxId: m.emailAccountId,
    to,
    subject,
    body: body.trim(),
    replyToMessageId: emailId,
  };

  const { pendingId, summary } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "reply_email",
    payload: payload as unknown as Record<string, unknown>,
    summary: formatSendSummary(payload),
  });

  return {
    ok: true,
    pendingActionId: pendingId,
    summary,
    draft: { to, subject, body: body.trim(), emailId, mailboxId: m.emailAccountId },
  };
}

export async function updateEmailSendDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: {
    pendingActionId?: string;
    instruction?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
  }
): Promise<{ ok: boolean; pendingActionId?: string; summary?: string; draft?: Record<string, unknown> }> {
  let pendingId = String(args.pendingActionId ?? "").trim();
  let pendingPayload: EmailSendPendingPayload | null = null;
  let pendingType = "reply_email";

  if (pendingId) {
    const pending = await loadPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
    if (!pending || !EMAIL_SEND_PENDING_TYPES.has(pending.type)) {
      return { ok: false, summary: "Návrh vypršel nebo neexistuje." };
    }
    pendingPayload = pending.payload as unknown as EmailSendPendingPayload;
    pendingType = pending.type;
  } else {
    const latest = await findLatestEmailPending(db, ctx.companyId, ctx.userId);
    if (!latest) return { ok: false, summary: "Není aktivní návrh e-mailu k úpravě." };
    pendingId = latest.id;
    pendingPayload = latest.payload;
    pendingType = latest.type;
  }

  if (!pendingPayload) return { ok: false, summary: "Neplatný návrh." };

  let nextBody = pendingPayload.body;
  if (args.body?.trim()) {
    nextBody = args.body.trim();
  } else if (args.instruction?.trim()) {
    nextBody = await rewriteEmailBodyWithInstruction(nextBody, args.instruction, {
      subject: pendingPayload.subject,
      to: pendingPayload.to.join(", "),
    });
  }

  const patch: EmailSendPendingPayload = {
    ...pendingPayload,
    body: nextBody,
    cc: args.cc ?? pendingPayload.cc,
    bcc: args.bcc ?? pendingPayload.bcc,
  };

  const summary = formatSendSummary(patch);
  await updatePendingSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    pendingId,
    payloadPatch: patch as unknown as Record<string, unknown>,
    summary,
  });

  return {
    ok: true,
    pendingActionId: pendingId,
    summary,
    draft: {
      type: pendingType,
      to: patch.to,
      cc: patch.cc ?? [],
      bcc: patch.bcc ?? [],
      subject: patch.subject,
      body: patch.body,
    },
  };
}

export async function createEmailForwardDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: {
    emailId?: string;
    messageId?: string;
    to?: string[];
    toEmail?: string;
    instruction?: string;
  }
): Promise<{ ok: boolean; pendingActionId?: string; summary?: string }> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  const to = Array.isArray(args.to)
    ? args.to.map(String)
    : args.toEmail?.trim()
      ? [String(args.toEmail).trim()]
      : [];
  if (!emailId || !to.length) return { ok: false, summary: "Chybí e-mail nebo příjemce přeposlání." };

  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "write");
  if (!access.ok) return { ok: false, summary: access.error };

  const m = access.message;
  const accountAccess = await assertEmailAccountAccess(
    db,
    ctx.companyId,
    m.emailAccountId,
    ctx.userId,
    "write"
  );
  if (!accountAccess.ok) return { ok: false, summary: accountAccess.error };

  const intro = args.instruction?.trim() || "Dobrý den,\n\npřeposílám zprávu.\n\n";
  const body = `${intro}\n\n---------- Přeposlaná zpráva ----------\nOd: ${m.from}\nPředmět: ${m.subject}\n\n${plainBody(m, 8000)}`;

  const payload: EmailSendPendingPayload = {
    emailId,
    mailboxId: m.emailAccountId,
    to,
    subject: m.subject?.toLowerCase().startsWith("fwd:")
      ? String(m.subject)
      : `Fwd: ${m.subject ?? ""}`,
    body,
    forwardFromMessageId: emailId,
  };

  const { pendingId, summary } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "forward_email",
    payload: payload as unknown as Record<string, unknown>,
    summary: formatSendSummary(payload),
  });

  return { ok: true, pendingActionId: pendingId, summary };
}

export async function createEmailComposeDraftTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: {
    to?: string[];
    toEmail?: string;
    subject?: string;
    body?: string;
    instruction?: string;
    mailboxId?: string;
  }
): Promise<{ ok: boolean; pendingActionId?: string; summary?: string }> {
  const to = Array.isArray(args.to)
    ? args.to.map(String)
    : args.toEmail?.trim()
      ? [String(args.toEmail).trim()]
      : [];
  if (!to.length) return { ok: false, summary: "Chybí příjemce." };

  let mailboxId = String(args.mailboxId ?? "").trim();
  if (!mailboxId) {
    const accounts = await listEmailAccountsAccessibleToUser(
      db,
      ctx.companyId,
      ctx.userId,
      "write"
    );
    const syncable = accounts.filter((a) => isEmailAccountSyncable(a));
    if (!syncable.length) return { ok: false, summary: "Nemáte schránku pro odesílání." };
    mailboxId = (syncable.find((a) => a.isDefault) ?? syncable[0])!.id;
  }

  const accountAccess = await assertEmailAccountAccess(
    db,
    ctx.companyId,
    mailboxId,
    ctx.userId,
    "write"
  );
  if (!accountAccess.ok) return { ok: false, summary: accountAccess.error };

  let body = String(args.body ?? "").trim();
  if (!body && args.instruction?.trim()) {
    const drafted = await rewriteEmailBodyWithInstruction(
      "Dobrý den,\n\n",
      args.instruction,
      {
        subject: String(args.subject ?? ""),
        to: to.join(", "),
      }
    );
    body = drafted.trim();
  }
  if (!body) body = "Dobrý den,\n\n";

  const subject = String(args.subject ?? "").trim() || "(bez předmětu)";
  const payload: EmailSendPendingPayload = {
    mailboxId,
    to,
    subject,
    body,
  };

  const { pendingId, summary } = await proposeSecretaryAction(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "compose_email",
    payload: payload as unknown as Record<string, unknown>,
    summary: formatSendSummary(payload),
  });

  return { ok: true, pendingActionId: pendingId, summary };
}

export async function confirmEmailSendTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { pendingActionId?: string; userConfirmationText?: string }
): Promise<{ ok: boolean; message: string; messageDocId?: string }> {
  const pendingId = String(args.pendingActionId ?? "").trim();
  if (!pendingId) return { ok: false, message: "Chybí pendingActionId." };

  const pending = await loadPendingSecretaryAction(db, ctx.companyId, pendingId, ctx.userId);
  if (!pending || !EMAIL_SEND_PENDING_TYPES.has(pending.type)) {
    return { ok: false, message: "Návrh odeslání vypršel nebo neexistuje." };
  }
  if (!userUtteranceConfirmsAction(args.userConfirmationText)) {
    return { ok: false, message: "Potvrzení nebylo rozpoznáno. Řekněte například „ano, odešli“." };
  }

  const payload = pending.payload as unknown as EmailSendPendingPayload;
  if (
    !payload.mailboxId ||
    !Array.isArray(payload.to) ||
    !payload.to.length ||
    !payload.subject?.trim() ||
    !payload.body?.trim()
  ) {
    return { ok: false, message: "Neplatný návrh e-mailu." };
  }

  const accountAccess = await assertEmailAccountAccess(
    db,
    ctx.companyId,
    payload.mailboxId,
    ctx.userId,
    "write"
  );
  if (!accountAccess.ok) return { ok: false, message: accountAccess.error };
  if (!isEmailAccountSyncable(accountAccess.account)) {
    return { ok: false, message: "Ze schránky nelze odesílat." };
  }

  if (payload.replyToMessageId) {
    const msgAccess = await assertMessageAccess(
      db,
      ctx.companyId,
      payload.replyToMessageId,
      ctx.userId,
      "read"
    );
    if (!msgAccess.ok) return { ok: false, message: msgAccess.error };
  }
  if (payload.forwardFromMessageId) {
    const msgAccess = await assertMessageAccess(
      db,
      ctx.companyId,
      payload.forwardFromMessageId,
      ctx.userId,
      "read"
    );
    if (!msgAccess.ok) return { ok: false, message: msgAccess.error };
  }

  let replyToMessage = null;
  const replyId = payload.replyToMessageId || payload.forwardFromMessageId;
  if (replyId) {
    const msgAccess = await assertMessageAccess(db, ctx.companyId, replyId, ctx.userId, "read");
    if (msgAccess.ok) {
      const d = msgAccess.message;
      replyToMessage = {
        messageId: d.messageId ?? null,
        references: d.references ?? [],
        subject: d.subject ?? "",
      };
    }
  }

  try {
    const sent = await sendEmailFromAccount(db, ctx.companyId, payload.mailboxId, {
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      textBody: payload.body,
      replyToMessage,
    });

    await db
      .collection(COMPANIES_COLLECTION)
      .doc(ctx.companyId)
      .collection("aiSecretaryPending")
      .doc(pendingId)
      .set({ status: "confirmed", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await consumePendingSecretaryAction(db, ctx.companyId, pendingId);

    await logSecretaryAudit(db, {
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "email_sent_via_ai_voice",
      detail: JSON.stringify({
        emailId: payload.emailId ?? null,
        mailboxId: payload.mailboxId,
        recipient: payload.to[0],
        messageDocId: sent.messageDocId,
        messageId: sent.messageId,
      }),
    });

    return {
      ok: true,
      message: "Hotovo, e-mail jsem odeslala.",
      messageDocId: sent.messageDocId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odeslání selhalo.";
    return { ok: false, message: msg };
  }
}

export async function showEmailTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { emailId?: string; messageId?: string; mailboxId?: string }
): Promise<{ ok: boolean; showEmail?: boolean; emailId?: string; mailboxId?: string }> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  if (!emailId) return { ok: false };

  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "read");
  if (!access.ok) return { ok: false };

  if (args.mailboxId?.trim() && access.message.emailAccountId !== args.mailboxId.trim()) {
    return { ok: false };
  }

  await logSecretaryAudit(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "email_shown_via_ai_voice",
    detail: emailId,
  });

  return {
    ok: true,
    showEmail: true,
    emailId,
    mailboxId: access.message.emailAccountId,
  };
}

export async function showEmailAttachmentTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { emailId?: string; messageId?: string; attachmentId?: string; filenameHint?: string }
): Promise<Record<string, unknown>> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  if (!emailId) return { ok: false, error: "Chybí e-mail." };

  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "read");
  if (!access.ok) return { ok: false, error: access.error };

  const attachments = userVisibleAttachments(access.message.attachments ?? []);
  let att = attachments.find((a) => a.id === args.attachmentId);
  if (!att && args.filenameHint) {
    const hint = args.filenameHint.toLowerCase();
    att = attachments.find((a) => a.filename.toLowerCase().includes(hint));
  }
  if (!att) return { ok: false, error: "Příloha nenalezena." };

  return {
    ok: true,
    showEmailAttachment: true,
    emailId,
    mailboxId: access.message.emailAccountId,
    attachmentId: att.id,
    filename: att.filename,
  };
}

export async function markEmailResolvedTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { emailId?: string; messageId?: string; resolved?: boolean }
): Promise<{ ok: boolean; message?: string }> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "write");
  if (!access.ok) return { ok: false, message: access.error };

  await emailMessagesCol(db, ctx.companyId).doc(emailId).update({
    resolved: args.resolved !== false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, message: "E-mail jsem označila jako vyřízený." };
}

export async function assignEmailEmployeeTool(
  db: Firestore,
  ctx: SecretaryContext,
  args: { emailId?: string; messageId?: string; assigneeUserId?: string; employeeId?: string }
): Promise<{ ok: boolean; message?: string }> {
  const emailId = String(args.emailId ?? args.messageId ?? "").trim();
  let assigneeUserId = String(args.assigneeUserId ?? "").trim();

  if (!assigneeUserId && args.employeeId) {
    const emp = await db
      .collection(COMPANIES_COLLECTION)
      .doc(ctx.companyId)
      .collection("employees")
      .doc(String(args.employeeId))
      .get();
    assigneeUserId = String((emp.data() as { userId?: string })?.userId ?? "").trim();
  }

  if (!emailId || !assigneeUserId) {
    return { ok: false, message: "Chybí e-mail nebo zaměstnanec." };
  }

  const access = await assertMessageAccess(db, ctx.companyId, emailId, ctx.userId, "write");
  if (!access.ok) return { ok: false, message: access.error };

  await emailMessagesCol(db, ctx.companyId).doc(emailId).update({
    assignedToUserId: assigneeUserId,
    assignedByUserId: ctx.userId,
    assignmentStatus: "pending",
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, message: "E-mail jsem přiřadila zaměstnanci." };
}

export async function logEmailReadAudit(
  db: Firestore,
  ctx: SecretaryContext,
  emailId: string
): Promise<void> {
  await logSecretaryAudit(db, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "email_read_via_ai_voice",
    detail: emailId,
  });
}
