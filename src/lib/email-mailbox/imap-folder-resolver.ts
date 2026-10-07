import type { ImapFlow } from "imapflow";

const SENT_FALLBACK_PATTERNS = [
  "sent",
  "odeslan",
  "odeslané",
  "odeslane",
  "sent items",
  "sent messages",
  "inbox.sent",
  "[send]",
];

const DRAFTS_FALLBACK_PATTERNS = [
  "draft",
  "koncept",
  "rozeps",
  "inbox.drafts",
];

function pathMatchesPatterns(path: string, patterns: string[]): boolean {
  const p = path.toLowerCase();
  return patterns.some((needle) => p.includes(needle));
}

function specialUseIncludes(special: string | undefined | null, flag: string): boolean {
  if (!special) return false;
  return special
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(flag);
}

export async function resolveImapFolderBySpecialUse(
  client: ImapFlow,
  specialFlag: "\\Sent" | "\\Drafts" | "\\Trash" | "\\Junk",
  fallbackPatterns: string[]
): Promise<string | null> {
  const list = await client.list();
  for (const box of list) {
    if (specialUseIncludes(box.specialUse, specialFlag)) return box.path;
  }
  for (const box of list) {
    if (pathMatchesPatterns(box.path, fallbackPatterns)) return box.path;
  }
  return null;
}

export async function findSentFolderPath(client: ImapFlow): Promise<string | null> {
  return resolveImapFolderBySpecialUse(client, "\\Sent", SENT_FALLBACK_PATTERNS);
}

export async function findDraftsFolderPath(client: ImapFlow): Promise<string | null> {
  return resolveImapFolderBySpecialUse(client, "\\Drafts", DRAFTS_FALLBACK_PATTERNS);
}
