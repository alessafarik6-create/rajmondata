import type { EmailProviderKind } from "@/lib/email-mailbox/types";

/** Oficiální parametry Seznam / Email.cz — IMAP 993 SSL, SMTP 465 SSL/TLS. */
export const SEZNAM_IMAP_SMTP = {
  imapHost: "imap.seznam.cz",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.seznam.cz",
  smtpPort: 465,
  smtpSecure: true,
} as const;

export type ProviderPreset = {
  provider: EmailProviderKind;
  label: string;
  implemented: boolean;
  comingSoonLabel?: string;
  domains?: string[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

export const EMAIL_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: "SEZNAM",
    label: "Seznam.cz",
    implemented: true,
    domains: ["seznam.cz", "email.cz", "post.cz"],
    ...SEZNAM_IMAP_SMTP,
  },
  {
    provider: "IMAP_SMTP",
    label: "Jiný IMAP / SMTP",
    implemented: true,
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    provider: "GOOGLE",
    label: "Gmail / Google Workspace",
    implemented: false,
    comingSoonLabel: "Připravujeme",
    ...SEZNAM_IMAP_SMTP,
  },
  {
    provider: "MICROSOFT",
    label: "Microsoft 365 / Outlook",
    implemented: false,
    comingSoonLabel: "Připravujeme",
    ...SEZNAM_IMAP_SMTP,
  },
];

export function presetForProvider(provider: EmailProviderKind): ProviderPreset | undefined {
  return EMAIL_PROVIDER_PRESETS.find((p) => p.provider === provider);
}
