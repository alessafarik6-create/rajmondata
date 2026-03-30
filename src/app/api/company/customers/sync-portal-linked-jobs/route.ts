import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

type Body = { customerId?: string };

/**
 * Znovu spočítá linkedJobIds pro users/{customerPortalUid} podle zakázek s customerId.
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      {
        error:
          "Firebase Admin není nakonfigurován (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).",
      },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  const companyId = caller.companyId as string | undefined;
  const callerRole = caller.role as string | undefined;
  if (!companyId || !["owner", "admin"].includes(callerRole || "")) {
    return NextResponse.json({ error: "Nemáte oprávnění." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const customerId = String(body.customerId || "").trim();
  if (!customerId) {
    return NextResponse.json({ error: "Chybí customerId." }, { status: 400 });
  }

  const customerRef = db
    .collection("companies")
    .doc(companyId)
    .collection("customers")
    .doc(customerId);
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists) {
    return NextResponse.json({ error: "Zákazník neexistuje." }, { status: 404 });
  }

  const c = customerSnap.data() as Record<string, unknown>;
  const portalUid =
    typeof c.customerPortalUid === "string" && c.customerPortalUid.trim()
      ? c.customerPortalUid.trim()
      : "";
  if (!portalUid) {
    return NextResponse.json({ error: "Klientský účet neexistuje." }, { status: 400 });
  }

  const jobsSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .where("customerId", "==", customerId)
    .get();
  const linkedJobIds = jobsSnap.docs.map((d) => d.id);

  await db.collection("users").doc(portalUid).update({
    linkedJobIds,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, linkedJobIds, count: linkedJobIds.length });
}
