import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

type Body = {
  photoURL?: string | null;
};

/**
 * Zaměstnanec aktualizuje fotku v záznamu employees/{id} (klient nemá přímý write).
 * Fotka v users/{uid} se aktualizuje na klientovi přes updateDoc.
 */
export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const raw = body.photoURL;
  const url =
    raw === null || raw === undefined
      ? null
      : typeof raw === "string" && raw.trim()
        ? raw.trim()
        : null;

  const userSnap = await db.collection("users").doc(callerUid).get();
  const userData = userSnap.data() as Record<string, unknown> | undefined;
  if (!userData) {
    return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
  }

  const companyId = userData.companyId as string | undefined;
  const profileEmployeeId = userData.employeeId as string | undefined;

  if (!companyId || !profileEmployeeId) {
    return NextResponse.json(
      { error: "Účet nemá přiřazenou firmu nebo zaměstnance." },
      { status: 400 }
    );
  }

  const empRef = db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(profileEmployeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    return NextResponse.json({ error: "Záznam zaměstnance neexistuje." }, { status: 404 });
  }

  const emp = empSnap.data() as Record<string, unknown>;
  const authUserId =
    typeof emp.authUserId === "string" && emp.authUserId.trim()
      ? emp.authUserId.trim()
      : null;
  if (authUserId && authUserId !== callerUid) {
    return NextResponse.json({ error: "Nesoulad účtu a zaměstnance." }, { status: 403 });
  }
  if (!authUserId) {
    const ee = typeof emp.email === "string" ? emp.email.trim().toLowerCase() : "";
    const ue =
      typeof userData.email === "string" ? String(userData.email).trim().toLowerCase() : "";
    if (!ee || !ue || ee !== ue) {
      return NextResponse.json(
        { error: "Zaměstnanec nemá propojený účet nebo nesoulad e-mailu." },
        { status: 403 }
      );
    }
  }

  try {
    const now = FieldValue.serverTimestamp();
    if (url) {
      await empRef.set(
        {
          photoURL: url,
          profileImage: url,
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      await empRef.set(
        {
          photoURL: FieldValue.delete(),
          profileImage: FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[employee/profile-photo]", e);
    return NextResponse.json({ error: "Uložení se nezdařilo." }, { status: 500 });
  }
}
