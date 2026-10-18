import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { verifyMarketingUnsubscribeToken } from "@/lib/platform-org-campaigns/marketing-unsubscribe";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const org = String(url.searchParams.get("org") ?? "").trim();
  const token = String(url.searchParams.get("token") ?? "").trim();
  if (!org || !verifyMarketingUnsubscribeToken(org, token)) {
    return new NextResponse("Neplatný odkaz pro odhlášení.", { status: 400 });
  }
  const db = getAdminFirestore();
  if (!db) return new NextResponse("Server error", { status: 503 });
  await db.collection(COMPANIES_COLLECTION).doc(org).set(
    {
      platformMarketingUnsubscribedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const html = `<!DOCTYPE html><html lang="cs"><body style="font-family:sans-serif;padding:40px;max-width:520px;margin:auto;">
<h1>Odhlášení proběhlo</h1>
<p>Organizace byla odhlášena z marketingových e-mailů RAJMONDATA. Servisní a systémová oznámení tím nejsou dotčena.</p>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
