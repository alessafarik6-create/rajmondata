import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyTerminalPinHash } from "@/lib/terminal-pin-crypto";
import {
  normalizeTerminalPin,
  validateTerminalPinFormat,
} from "@/lib/terminal-pin-validation";
import { resolveTerminalCompanyId } from "@/lib/terminal-company-resolve";
import { signTerminalPinSessionToken } from "@/lib/terminal-session-jwt";

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

function readStoredPinHash(privateData: Record<string, unknown> | undefined): string {
  if (!privateData) return "";
  const h =
    (privateData.terminalPinHash as string | undefined) ??
    (privateData.pinHash as string | undefined);
  return typeof h === "string" && h.length > 0 ? h : "";
}

/**
 * Kanonické uložení PINu: `companies/{cid}/employees/{eid}/private/terminal`
 * pole `terminalPinHash` (bcrypt). Legacy: `employees/{eid}.attendancePin` (plain číslice).
 */
async function findEmployeeByPin(
  db: Firestore,
  companyId: string,
  pinNormalized: string
): Promise<{ employeeId: string; firstName: string; lastName: string } | null> {
  console.log("[verify-attendance-pin] Looking up employee by terminal PIN", { companyId });

  const snap = await db.collection("companies").doc(companyId).collection("employees").get();

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.isActive === false) {
      continue;
    }
    const privateSnap = await privateTerminalRef(db, companyId, doc.id).get();
    const privateData = privateSnap.exists
      ? (privateSnap.data() as Record<string, unknown>)
      : undefined;
    const hash = readStoredPinHash(privateData);

    if (hash.length > 0) {
      const ok = await verifyTerminalPinHash(pinNormalized, hash);
      if (ok) {
        console.log("[verify-attendance-pin] Employee found for terminal PIN", {
          employeeId: doc.id,
          source: "terminalPinHash",
        });
        return {
          employeeId: doc.id,
          firstName: String(data.firstName ?? ""),
          lastName: String(data.lastName ?? ""),
        };
      }
      continue;
    }

    const legacyRaw = data.attendancePin;
    const legacy =
      legacyRaw != null && legacyRaw !== ""
        ? normalizeTerminalPin(String(legacyRaw))
        : "";
    if (legacy.length > 0 && legacy === pinNormalized) {
      console.log("[verify-attendance-pin] Employee found for terminal PIN", {
        employeeId: doc.id,
        source: "attendancePin_legacy",
      });
      return {
        employeeId: doc.id,
        firstName: String(data.firstName ?? ""),
        lastName: String(data.lastName ?? ""),
      };
    }
  }

  console.log("[verify-attendance-pin] No employee found for terminal PIN", { companyId });
  return null;
}

/**
 * Ověří PIN docházkového terminálu (server-side).
 *
 * - S Firebase ID tokenem: portál / dřívější kiosk — firma z těla, žádný nový auth účet.
 * - Bez tokenu: veřejný `/terminal` — firma jen ze serveru (`resolveTerminalCompanyId`), vrací JWT relaci PIN (ne Firebase Auth).
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const pinRaw = String(body.pin ?? "");
  const pinErr = validateTerminalPinFormat(pinRaw);
  if (pinErr) {
    return NextResponse.json({ error: pinErr }, { status: 400 });
  }
  const pin = normalizeTerminalPin(pinRaw);

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  /** Veřejný terminál — bez Firebase Auth; firma jen ze stabilního serverového zdroje. */
  if (!idToken) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[verify-attendance-pin] Public PIN verify (no Firebase Auth user) — Terminal uses PIN session only"
      );
    }
    try {
      const companyId = await resolveTerminalCompanyId();
      if (!companyId) {
        return NextResponse.json(
          {
            error:
              "Firma pro terminál není nakonfigurována (TERMINAL_COMPANY_ID nebo config/terminal).",
          },
          { status: 503 }
        );
      }
      const found = await findEmployeeByPin(db, companyId, pin);
      if (!found) {
        return NextResponse.json({ error: "Neplatný PIN." }, { status: 401 });
      }
      const terminalSessionToken = await signTerminalPinSessionToken(companyId, found.employeeId);
      if (!terminalSessionToken) {
        return NextResponse.json(
          {
            error:
              "Relace terminálu není nakonfigurována (chybí TERMINAL_SESSION_SECRET, min. 32 znaků).",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        ok: true,
        companyId,
        employeeId: found.employeeId,
        firstName: found.firstName,
        lastName: found.lastName,
        terminalSessionToken,
      });
    } catch (e) {
      console.error("[verify-attendance-pin] public", e);
      return NextResponse.json({ error: "Ověření se nezdařilo." }, { status: 500 });
    }
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  const companyId = String(body.companyId || "").trim();
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
    // legacy kiosk token s terminalAccess — ověření PINu bez nového auth účtu
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
