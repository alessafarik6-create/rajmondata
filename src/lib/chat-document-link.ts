/** URL dokladu z chatu — vždy podle documentId + návrat do konverzace. */
export function buildChatDocumentOpenHref(params: {
  documentId: string;
  conversationId?: string | null;
  messageId?: string | null;
  chatBasePath?: "/portal/chat" | "/portal/employee/messages";
}): string {
  const id = String(params.documentId ?? "").trim();
  if (!id) return "/portal/documents";
  const q = new URLSearchParams();
  q.set("documentId", id);
  const conv = String(params.conversationId ?? "").trim();
  const msg = String(params.messageId ?? "").trim();
  if (conv) {
    q.set("fromChat", "1");
    q.set("conversationId", conv);
    const base = params.chatBasePath ?? "/portal/chat";
    q.set("returnChatPath", `${base}?c=${encodeURIComponent(conv)}`);
  }
  if (msg) q.set("messageId", msg);
  return `/portal/documents?${q.toString()}`;
}

export function resolveChatDocumentIdFromAttachment(att: {
  linkedDocumentId?: string | null;
  createdDocumentId?: string | null;
}): string | null {
  const id =
    String(att.createdDocumentId ?? "").trim() ||
    String(att.linkedDocumentId ?? "").trim();
  return id || null;
}
