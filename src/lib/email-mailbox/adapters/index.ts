import { imapSmtpEmailAdapter } from "@/lib/email-mailbox/adapters/imap-smtp-adapter";
import type { EmailProviderAdapter } from "@/lib/email-mailbox/adapters/types";
import type { EmailProviderKind } from "@/lib/email-mailbox/types";

/** V budoucnu: GoogleGmailAdapter, MicrosoftGraphAdapter */
export function getEmailProviderAdapter(provider: EmailProviderKind): EmailProviderAdapter | null {
  switch (provider) {
    case "SEZNAM":
    case "IMAP_SMTP":
      return imapSmtpEmailAdapter;
    case "GOOGLE":
    case "MICROSOFT":
      return null;
    default:
      return null;
  }
}
