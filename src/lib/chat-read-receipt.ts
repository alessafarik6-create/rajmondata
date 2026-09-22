import type { ChatMessageDoc } from "@/lib/company-chat-types";

function readAtMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof (v as { seconds?: number }).seconds === "number") {
    return Number((v as { seconds: number }).seconds) * 1000;
  }
  return null;
}

export function formatReadReceiptTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

/** 1:1 chat — přečteno druhým účastníkem. */
export function dmPeerReadAtMs(message: ChatMessageDoc, peerUserId: string | null | undefined): number | null {
  if (!peerUserId) return null;
  const raw = message.readAtBy?.[peerUserId];
  return readAtMs(raw);
}

/** Skupina — kolik ostatních účastníků zprávu přečetlo. */
export function groupReadCount(
  message: ChatMessageDoc,
  participantIds: string[] | undefined,
  myUserId: string | undefined
): { read: number; total: number } {
  const others = (participantIds ?? []).filter((id) => id && id !== myUserId);
  let read = 0;
  for (const uid of others) {
    if (readAtMs(message.readAtBy?.[uid]) != null) read += 1;
  }
  return { read, total: others.length };
}

export function companyEmployeeMessageReadByAdmin(message: ChatMessageDoc): boolean {
  return message.read === true;
}
