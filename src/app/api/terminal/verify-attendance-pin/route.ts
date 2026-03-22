import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyTerminalPinHash } from "@/lib/terminal-pin-crypto";
import { validateTerminalPinFormat } from "@/lib/terminal-pin-validation";

type Body = {
  companyId?: string;
  pin?: string;
};

function privateTerminalRef(db: Firestore, companyId: string, employeeId: string) {
  return db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .collection("private")
    .doc("terminal");
}

async function findEmployeeByPin(
  db: Firestore,
  companyId: string,
  pin: string
): Promise<{ employeeId: string; firstName: string; lastName: string } | null> {
  const snap = await db.collection("companies").doc(companyId).collection("employees").get();

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const privateSnap = await privateTerminalRef(db, companyId, doc.id).get();
    const hash = privateSnap.exists
      ? ((privateSnap.data() as { terminalPinHash?: string })?.terminalPinHash ?? "")
      : "";

    if (hash && typeof hash === "string" && hash.length > 0) {
      const ok = await verifyTerminalPinHash(pin, hash);
      if (ok) {
        return {
          employeeId: doc.id,
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
        };
      }
    } else {
      const legacy = data.attendancePin != null ? String(data.attendancePin) : "";
      if (legacy && legacy === pin) {
        return {
          employeeId: doc.id,
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
        };
      }
    }
  }

  return null;
}

/**
 * Ověří PIN docházkového terminálu v rámci firmy (server-side).
 * Vyžaduje přihlášení: kiosk token (terminalAccess) nebo běžný uživatel stejné firmy.
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
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId || "").trim();
  const pin = String(body.pin || "").trim();

  const pinErr = validateTerminalPinFormat(pin);
  if (pinErr) {
    return NextResponse.json({ error: pinErr }, { status: 400 });
  }

  if (!companyId) {
    return NextResponse.json({ error: "Chybí companyId." }, { status: 400 });
  }

  const claims = decoded as DecodedIdToken & {
    companyId?: string;
    terminalAccess?: boolean;
  };
  const tokenCompany = claims.companyId;
  const terminalAccess = claims.terminalAccess === true;

  if (terminalAccess && tokenCompany === companyId) {
    // kiosk / tablet — custom token s terminalAccess
  } else {
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const u = userSnap.data() as { companyId?: string } | undefined;
    if (!u || u.companyId !== companyId) {
      return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
    }
  }

  try {
    const found = await findEmployeeByPin(db, companyId, pin);
    if (!found) {
      return NextResponse.json({ error: "Neplatný PIN." }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      employeeId: found.employeeId,
      firstName: found.firstName,
      lastName: found.lastName,
    });
  } catch (e) {
    console.error("[verify-attendance-pin]", e);
    return NextResponse.json({ error: "Ověření se nezdařilo." }, { status: 500 });
  }
}
