import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  hashTerminalPin,
  verifyTerminalPinHash,
} from "@/lib/terminal-pin-crypto";
import {
  normalizeTerminalPin,
  validateTerminalPinFormat,
} from "@/lib/terminal-pin-validation";

type Body = {
  oldPin?: string;
  newPin?: string;
  newPinConfirm?: string;
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

/**
 * Zaměstnanec mění vlastní PIN docházkového terminálu.
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

  const newPin = normalizeTerminalPin(String(body.newPin ?? ""));
  const newPinConfirm = normalizeTerminalPin(String(body.newPinConfirm ?? ""));
  const oldPin = normalizeTerminalPin(String(body.oldPin ?? ""));

  const errNew = validateTerminalPinFormat(newPin);
  if (errNew) {
    return NextResponse.json({ error: errNew }, { status: 400 });
  }
  if (newPin !== newPinConfirm) {
    return NextResponse.json({ error: "Nový PIN a potvrzení se neshodují." }, { status: 400 });
  }

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
  const privateRef = privateTerminalRef(db, companyId, profileEmployeeId);
  const privateSnap = await privateRef.get();
  const hash = privateSnap.exists
    ? ((privateSnap.data() as { terminalPinHash?: string })?.terminalPinHash ?? "")
    : "";
  const legacyPlain =
    emp.attendancePin != null && emp.attendancePin !== ""
      ? normalizeTerminalPin(String(emp.attendancePin))
      : "";

  const hasSecurePin = typeof hash === "string" && hash.length > 0;
  const hasLegacyOnly = !hasSecurePin && legacyPlain.length > 0;

  if (hasSecurePin) {
    const oldErr = validateTerminalPinFormat(oldPin);
    if (oldErr) {
      return NextResponse.json(
        { error: "Zadejte platný současný PIN." },
        { status: 400 }
      );
    }
    const ok = await verifyTerminalPinHash(oldPin, hash);
    if (!ok) {
      return NextResponse.json({ error: "Současný PIN není správný." }, { status: 403 });
    }
  } else if (hasLegacyOnly) {
    if (oldPin !== legacyPlain) {
      return NextResponse.json({ error: "Současný PIN není správný." }, { status: 403 });
    }
  } else {
    return NextResponse.json(
      {
        error:
          "PIN ještě nebyl nastaven administrátorem. Požádejte administrátora o výchozí PIN.",
      },
      { status: 400 }
    );
  }

  try {
    const newHash = await hashTerminalPin(newPin);
    const now = FieldValue.serverTimestamp();

    await privateRef.set(
      {
        terminalPinHash: newHash,
        terminalPinUpdatedAt: now,
        terminalPinUpdatedBy: callerUid,
      },
      { merge: true }
    );

    await empRef.set(
      {
        terminalPinNeedsChange: false,
        terminalPinActive: true,
        attendancePin: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      message: "PIN docházkového terminálu byl změněn.",
    });
  } catch (e) {
    console.error("[employee terminal-pin]", e);
    return NextResponse.json({ error: "Uložení se nezdařilo." }, { status: 500 });
  }
}
