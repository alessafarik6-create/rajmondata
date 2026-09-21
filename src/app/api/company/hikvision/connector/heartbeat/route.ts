import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { hikvisionConnectorsCol, hikvisionIntegrationRef } from "@/lib/hikvision/stores";

export const dynamic = "force-dynamic";

/**
 * Heartbeat z Local Connectoru.
 * Header: Authorization: Connector <connectorId>:<sha256(secret)>
 */
export async function POST(request: NextRequest) {
  const db = (await import("@/lib/firebase-admin")).getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const m = authHeader.match(/^Connector\s+([^:]+):([a-f0-9]{64})$/i);
  if (!m) {
    return NextResponse.json({ ok: false, error: "Neplatná autorizace connectoru." }, { status: 401 });
  }
  const connectorId = m[1].trim();
  const secretHash = m[2].toLowerCase();

  let body: { companyId?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId || !connectorId) {
    return NextResponse.json({ ok: false, error: "Chybí companyId nebo connectorId." }, { status: 400 });
  }

  const ref = hikvisionConnectorsCol(db, companyId).doc(connectorId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Connector nenalezen." }, { status: 404 });
  }
  const storedHash = String((snap.data() as { secretHash?: string })?.secretHash ?? "");
  if (!storedHash || storedHash !== secretHash) {
    return NextResponse.json({ ok: false, error: "Neplatný connector secret." }, { status: 403 });
  }

  await ref.set(
    {
      status: "online",
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      label: body.label ? String(body.label).slice(0, 120) : undefined,
      lastError: null,
    },
    { merge: true }
  );
  await hikvisionIntegrationRef(db, companyId).set(
    {
      connectorOnline: true,
      lastConnectorHeartbeatAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}

/** Registrace connectoru tokenem (volá Local Connector jednou). */
export async function PUT(request: NextRequest) {
  const db = (await import("@/lib/firebase-admin")).getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }
  let body: { companyId?: string; registrationToken?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  const token = String(body.registrationToken ?? "").trim();
  if (!companyId || !token) {
    return NextResponse.json({ ok: false, error: "Chybí companyId nebo token." }, { status: 400 });
  }

  const integ = await hikvisionIntegrationRef(db, companyId).get();
  if (!integ.exists) {
    return NextResponse.json({ ok: false, error: "Integrace neexistuje." }, { status: 404 });
  }
  const data = integ.data() as {
    pendingRegistrationTokenHash?: string;
    pendingRegistrationExpiresAt?: { toDate?: () => Date };
  };
  const hash = createHash("sha256").update(token).digest("hex");
  if (!data.pendingRegistrationTokenHash || data.pendingRegistrationTokenHash !== hash) {
    return NextResponse.json({ ok: false, error: "Neplatný registrační token." }, { status: 403 });
  }
  const exp = data.pendingRegistrationExpiresAt?.toDate?.();
  if (exp && exp.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "Registrační token vypršel." }, { status: 403 });
  }

  const connectorId = `conn_${Date.now().toString(36)}`;
  const secret = createHash("sha256")
    .update(`${companyId}:${connectorId}:${token}:${Date.now()}`)
    .digest("hex");
  const secretHash = createHash("sha256").update(secret).digest("hex");

  await hikvisionConnectorsCol(db, companyId).doc(connectorId).set({
    organizationId: companyId,
    connectorId,
    label: String(body.label ?? "Local Connector").slice(0, 120),
    status: "online",
    secretHash,
    createdAt: FieldValue.serverTimestamp(),
    lastHeartbeatAt: FieldValue.serverTimestamp(),
  });
  await hikvisionIntegrationRef(db, companyId).set(
    {
      pendingRegistrationTokenHash: null,
      pendingRegistrationExpiresAt: null,
      connectorOnline: true,
      lastConnectorHeartbeatAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({
    ok: true,
    connectorId,
    connectorSecret: secret,
    message: "Connector zaregistrován. Secret uložte lokálně — nezobrazí se znovu.",
  });
}
