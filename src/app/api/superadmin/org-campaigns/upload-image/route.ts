import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminStorageBucket } from "@/lib/firebase-admin";

const MAX = 4 * 1024 * 1024;
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bucket = getAdminStorageBucket();
  if (!bucket) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Chybí soubor." }, { status: 400 });
  }
  const mime = (file as { type?: string }).type || "";
  if (!MIME.has(mime)) return NextResponse.json({ error: "Povolené: JPG, PNG, WebP." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "Max 4 MB." }, { status: 400 });
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const objectPath = `platform/org-campaigns/${Date.now()}_${randomBytes(6).toString("hex")}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const f = bucket.file(objectPath);
  await f.save(buf, { metadata: { contentType: mime, cacheControl: "public, max-age=31536000" } });
  try {
    await f.makePublic();
  } catch {
    /* ignore */
  }
  const encoded = encodeURIComponent(objectPath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
  return NextResponse.json({ ok: true, url, storagePath: objectPath });
}
