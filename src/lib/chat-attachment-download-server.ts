import "server-only";

import { getAdminStorageBucket } from "@/lib/firebase-admin";

export async function downloadChatAttachmentBuffer(storagePath: string): Promise<Buffer | null> {
  const bucket = getAdminStorageBucket();
  if (!bucket) return null;
  const path = String(storagePath).trim().replace(/^\//, "");
  if (!path) return null;
  try {
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return buf;
  } catch {
    return null;
  }
}

export async function fetchUrlBuffer(url: string): Promise<Buffer | null> {
  const u = String(url).trim();
  if (!u.startsWith("http")) return null;
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}
