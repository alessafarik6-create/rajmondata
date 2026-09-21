import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminStorageBucket, getAdminFirestore } from "@/lib/firebase-admin";
import { savePlatformAiBranding, PLATFORM_AI_BRANDING_CACHE_TAG } from "@/lib/platform-ai-branding";
import { PLATFORM_SECURITY_AUDIT_COLLECTION } from "@/lib/firestore-collections";

const MAX = 2 * 1024 * 1024;
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bucket = getAdminStorageBucket();
  const db = getAdminFirestore();
  if (!bucket || !db) {
    return NextResponse.json({ error: "Storage není k dispozici." }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Chybí soubor." }, { status: 400 });
  }
  const mime = (file as { type?: string }).type || "";
  if (!MIME.has(mime)) {
    return NextResponse.json({ error: "Povolené: PNG, JPG, WebP." }, { status: 400 });
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: "Max 2 MB." }, { status: 400 });
  }

  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const objectPath = `platform/branding/ai-assistant/${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const f = bucket.file(objectPath);
  await f.save(buf, { metadata: { contentType: mime, cacheControl: "public, max-age=3600" } });
  await f.makePublic().catch(() => undefined);
  const avatarUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

  await savePlatformAiBranding(db, {
    avatarUrl,
    avatarStoragePath: objectPath,
    updatedBy: session.username,
  });
  revalidateTag(PLATFORM_AI_BRANDING_CACHE_TAG);

  await db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
    actionType: "PLATFORM_AI_AVATAR_CHANGED",
    updatedBy: session.username,
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true, avatarUrl });
}
