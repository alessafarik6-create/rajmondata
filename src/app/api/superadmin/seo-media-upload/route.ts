import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminStorageBucket } from "@/lib/firebase-admin";

const MAX_HERO = 6 * 1024 * 1024;
const MAX_PROMO = 80 * 1024 * 1024;

const HERO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROMO_MIME = new Set(["video/mp4", "video/webm"]);

const KIND_CONFIG: Record<string, { folder: string; isVideo: boolean }> = {
  hero: { folder: "platform/landing/hero", isVideo: false },
  promo: { folder: "platform/landing/promo", isVideo: true },
  register_hero: { folder: "platform/landing/register/hero", isVideo: false },
  register_promo: { folder: "platform/landing/register/promo", isVideo: true },
  login_hero: { folder: "platform/landing/login/hero", isVideo: false },
  login_promo: { folder: "platform/landing/login/promo", isVideo: true },
};

function extFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "png";
  if (n.endsWith(".webp")) return "webp";
  if (n.endsWith(".webm")) return "webm";
  if (n.endsWith(".mp4")) return "mp4";
  return "jpg";
}

/**
 * Nahrání obrázku / videa pro veřejnou landing stránku (pouze superadmin cookie session).
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bucket = getAdminStorageBucket();
  if (!bucket) {
    return NextResponse.json({ error: "Firebase Storage není k dispozici." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const kind = String(form.get("kind") || "").trim();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "Chybí soubor." }, { status: 400 });
    }
    const conf = KIND_CONFIG[kind];
    if (!conf) {
      return NextResponse.json({ error: "Neplatný typ (kind)." }, { status: 400 });
    }

    const mime = (file as { type?: string }).type || "application/octet-stream";
    const name = (file as File).name || "upload";
    if (!conf.isVideo) {
      if (!HERO_MIME.has(mime)) {
        return NextResponse.json({ error: "Povolené obrázky: JPG, PNG, WebP." }, { status: 400 });
      }
      if (file.size > MAX_HERO) {
        return NextResponse.json({ error: "Obrázek je příliš velký (max 6 MB)." }, { status: 400 });
      }
    } else {
      if (!PROMO_MIME.has(mime)) {
        return NextResponse.json({ error: "Povolené video: MP4, WebM." }, { status: 400 });
      }
      if (file.size > MAX_PROMO) {
        return NextResponse.json({ error: "Video je příliš velké (max 80 MB)." }, { status: 400 });
      }
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = extFromName(name);
    const objectPath = `${conf.folder}/${Date.now()}_${randomBytes(6).toString("hex")}.${ext}`;
    const f = bucket.file(objectPath);

    await f.save(buf, {
      metadata: {
        contentType: mime,
        cacheControl: "public, max-age=31536000",
      },
    });

    try {
      await f.makePublic();
    } catch (e) {
      console.warn("[seo-media-upload] makePublic (může být OK u uniform bucket):", e);
    }

    const encoded = encodeURIComponent(objectPath);
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;

    console.info("[Platform]", "SEO media uploaded", { kind, path: objectPath, by: session.username });
    return NextResponse.json({ ok: true, url: publicUrl, storagePath: objectPath });
  } catch (e) {
    console.error("[superadmin seo-media-upload]", e);
    const msg = e instanceof Error ? e.message : "Nahrání se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
