export const SECRETARY_SHOW_EMAIL_EVENT = "rajmondata-secretary-show-email";
export const SECRETARY_SHOW_EMAIL_ATTACHMENT_EVENT = "rajmondata-secretary-show-email-attachment";
export const SECRETARY_VOICE_EMAIL_CONTEXT_EVENT = "rajmondata-secretary-voice-email-context";

export type SecretaryShowEmailDetail = {
  emailId: string;
  mailboxId?: string;
  subject?: string;
  senderName?: string;
};

export type SecretaryShowEmailAttachmentDetail = {
  emailId: string;
  attachmentId: string;
  filename?: string;
  mailboxId?: string;
};

export function dispatchSecretaryShowEmail(detail: SecretaryShowEmailDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SECRETARY_SHOW_EMAIL_EVENT, { detail }));
}

export function dispatchSecretaryShowEmailAttachment(
  detail: SecretaryShowEmailAttachmentDetail
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SECRETARY_SHOW_EMAIL_ATTACHMENT_EVENT, { detail }));
}

export function dispatchSecretaryVoiceEmailContext(
  detail: SecretaryShowEmailDetail | null
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SECRETARY_VOICE_EMAIL_CONTEXT_EVENT, { detail }));
}
