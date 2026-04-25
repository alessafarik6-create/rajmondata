import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminStorageBucket } from "@/lib/firebase-admin";

const MAX = 4 * 1024 * 1024;
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Nahrání loga / razítka provozovatele platformy (superadmin cookie). */
export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bucket = getAdminStorageBucket();
  if (!bucket) return NextResponse.json({ error: "Firebase Storage není k dispozici." }, { status: 503 });
  try {
    const form = await request.formData();
    const kind = String(form.get("kind") || "").trim();
    if (kind !== "logo" && kind !== "stamp") {
      return NextResponse.json({ error: "Neplatný typ (logo | stamp)." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "Chybí soubor." }, { status: 400 });
    }
    const mime = (file as { type?: string }).type || "application/octet-stream";
    if (!MIME.has(mime)) {
      return NextResponse.json({ error: "Povolené obrázky: JPG, PNG, WebP." }, { status: 400 });
    }
    if (file.size > MAX) return NextResponse.json({ error: "Soubor je příliš velký (max 4 MB)." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = extFromMime(mime);
    const objectPath = `platform/billing-provider/${kind}/${Date.now()}_${randomBytes(6).toString("hex")}.${ext}`;
    const f = bucket.file(objectPath);
    await f.save(buf, {
      metadata: { contentType: mime, cacheControl: "public, max-age=31536000" },
    });
    try {
      await f.makePublic();
    } catch (e) {
      console.warn("[billing-provider-upload] makePublic:", e);
    }
    const encoded = encodeURIComponent(objectPath);
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
    return NextResponse.json({ ok: true, url: publicUrl, storagePath: objectPath });
  } catch (e) {
    console.error("[superadmin billing-provider-upload]", e);
    const msg = e instanceof Error ? e.message : "Nahrání se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
