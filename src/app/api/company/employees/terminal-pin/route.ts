import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  hashTerminalPin,
  verifyTerminalPinHash,
} from "@/lib/terminal-pin-crypto";
import {
  generateRandomTerminalPin,
  normalizeTerminalPin,
  validateTerminalPinFormat,
} from "@/lib/terminal-pin-validation";

type Body = {
  companyId?: string;
  employeeId?: string;
  /** set | generate | clear */
  action?: string;
  /** Pro action === "set" — nový PIN v čistém tvaru (jen přes HTTPS). */
  pin?: string;
};

function privateTerminalRef(
  db: Firestore,
  companyId: string,
  employeeId: string
) {
  return db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId)
    .collection("private")
    .doc("terminal");
}

/**
 * Správa docházkového PINu administrátorem (hash + metadata).
 * Pouze owner / admin (stejná firma).
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

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  const callerCompanyId = caller.companyId as string | undefined;
  const callerRole = (caller.role as string | undefined) || "";
  const globalRoles = caller.globalRoles as string[] | undefined;
  const isSuperAdmin =
    Array.isArray(globalRoles) && globalRoles.includes("super_admin");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId || "").trim();
  const action = String(body.action || "").trim() as "set" | "generate" | "clear";

  if (!employeeId) {
    return NextResponse.json({ error: "Chybí ID zaměstnance." }, { status: 400 });
  }

  let targetCompanyId = callerCompanyId;
  if (isSuperAdmin) {
    const fromBody = String(body.companyId || "").trim();
    if (fromBody) targetCompanyId = fromBody;
  }

  if (!targetCompanyId) {
    return NextResponse.json(
      { error: "Chybí identifikace organizace." },
      { status: 400 }
    );
  }

  if (!isSuperAdmin) {
    if (!["owner", "admin"].includes(callerRole)) {
      return NextResponse.json(
        { error: "Pouze vlastník nebo administrátor může spravovat PIN terminálu." },
        { status: 403 }
      );
    }
    if (callerCompanyId !== targetCompanyId) {
      return NextResponse.json({ error: "Nedostatečná oprávnění." }, { status: 403 });
    }
  }

  if (!["set", "generate", "clear"].includes(action)) {
    return NextResponse.json({ error: "Neplatná akce (set | generate | clear)." }, { status: 400 });
  }

  const empRef = db
    .collection("companies")
    .doc(targetCompanyId)
    .collection("employees")
    .doc(employeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    return NextResponse.json(
      { error: "Zaměstnanec v této organizaci neexistuje." },
      { status: 404 }
    );
  }

  const privateRef = privateTerminalRef(db, targetCompanyId, employeeId);
  const now = FieldValue.serverTimestamp();

  try {
    if (action === "clear") {
      await privateRef.delete().catch(() => {});
      await empRef.set(
        {
          terminalPinNeedsChange: false,
          terminalPinActive: false,
          attendancePin: FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true }
      );
      return NextResponse.json({
        ok: true,
        message: "PIN docházkového terminálu byl zrušen.",
      });
    }

    let pinPlain = "";
    if (action === "generate") {
      pinPlain = normalizeTerminalPin(generateRandomTerminalPin(4));
    } else {
      pinPlain = normalizeTerminalPin(String(body.pin ?? ""));
      const err = validateTerminalPinFormat(pinPlain);
      if (err) {
        return NextResponse.json({ error: err }, { status: 400 });
      }
    }

    console.log("Saving terminal PIN for user", employeeId);
    console.log(
      "Generated terminal PIN",
      process.env.NODE_ENV === "development" ? pinPlain : { length: pinPlain.length }
    );

    const hash = await hashTerminalPin(pinPlain);

    await privateRef.set(
      {
        terminalPinHash: hash,
        terminalPinUpdatedAt: now,
        terminalPinUpdatedBy: callerUid,
        terminalPinResetAt: now,
        terminalPinResetBy: callerUid,
      },
      { merge: true }
    );

    await empRef.set(
      {
        terminalPinNeedsChange: true,
        terminalPinActive: true,
        attendancePin: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true }
    );

    console.log("Terminal PIN saved successfully");

    return NextResponse.json({
      ok: true,
      message:
        action === "generate"
          ? "Byl vygenerován nový PIN. Předáte ho zaměstnanci bezpečným kanálem."
          : "PIN byl uložen. Zaměstnanec si musí při prvním použití nastavit vlastní PIN v profilu.",
      /** PIN v odpovědi jen při generování — jednorázové zobrazení. */
      generatedPin: action === "generate" ? pinPlain : undefined,
      manualPinSet: action === "set" ? true : undefined,
    });
  } catch (e) {
    console.error("[terminal-pin admin]", e);
    return NextResponse.json(
      { error: "Uložení PINu se nezdařilo." },
      { status: 500 }
    );
  }
}
