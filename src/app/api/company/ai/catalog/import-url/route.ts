import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { AI_PRODUCT_CATALOG_ITEMS_COLLECTION } from "@/lib/ai/ai-center-types";
import { parseCatalogItemsFromHtml } from "@/lib/ai/catalog-import-from-url";
import { FieldValue } from "firebase-admin/firestore";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    const canManage =
      auth.caller.globalRoles.includes("super_admin") ||
      ["owner", "admin"].includes(auth.caller.role);
    if (!canManage) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    const companyId = auth.caller.companyId;
    const body = (await request.json()) as {
      url?: string;
      category?: string;
      replaceExistingFromUrl?: boolean;
    };

    const url = String(body.url ?? "").trim();
    const category = String(body.category ?? "").trim();
    if (!url || !category) {
      return NextResponse.json(
        { ok: false, error: "Chybí URL nebo kategorie." },
        { status: 400 }
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatná URL." }, { status: 400 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ ok: false, error: "Povoleny jsou jen http/https URL." }, { status: 400 });
    }

    const res = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "Rajmondata-catalog-import/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Stažení stránky selhalo (HTTP ${res.status}).` },
        { status: 502 }
      );
    }
    const html = await res.text();
    const items = parseCatalogItemsFromHtml(companyId, html, { category, sourceUrl: url });
    if (!items.length) {
      return NextResponse.json({
        ok: false,
        error: "Na stránce nebyly rozpoznány žádné ceníkové položky.",
      }, { status: 422 });
    }

    const col = auth.db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(AI_PRODUCT_CATALOG_ITEMS_COLLECTION);

    if (body.replaceExistingFromUrl) {
      const old = await col.where("sourceUrl", "==", url).limit(100).get();
      const batch = auth.db.batch();
      for (const d of old.docs) batch.delete(d.ref);
      await batch.commit();
    }

    let written = 0;
    for (const item of items) {
      await col.add({
        ...item,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: auth.caller.uid,
      });
      written++;
    }

    return NextResponse.json({ ok: true, imported: written, items: items.length });
  } catch (err) {
    console.error("[ai/catalog/import-url]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Import ceníku selhal." },
      { status: 500 }
    );
  }
}
