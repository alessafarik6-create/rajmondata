import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  bankConnectionsCol,
  bankAccountsCol,
} from "@/lib/bank/collections";
import {
  BANK_PROVIDER_RAIFFEISEN,
  type BankConnectionDoc,
  type BankConnectionStatus,
} from "@/lib/bank/types";
import {
  decryptBankCertificateP12,
  decryptBankSecret,
  encryptBankCertificateP12,
  encryptBankSecret,
  isBankSecretsEncryptionConfigured,
  maskClientId,
} from "@/lib/bank/secrets-crypto";
import {
  buildRaiffeisenClientConfig,
  rbTestConnection,
} from "@/lib/bank/raiffeisen-client";

const DEFAULT_CONNECTION_ID = "raiffeisen";

export async function loadBankConnection(
  db: Firestore,
  organizationId: string
): Promise<(BankConnectionDoc & { id: string }) | null> {
  const snap = await bankConnectionsCol(db, organizationId).doc(DEFAULT_CONNECTION_ID).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as BankConnectionDoc) };
}

export async function getRaiffeisenClientForOrg(
  db: Firestore,
  organizationId: string
): Promise<
  | {
      cfg: ReturnType<typeof buildRaiffeisenClientConfig>;
      connectionId: string;
    }
  | { error: string }
> {
  const conn = await loadBankConnection(db, organizationId);
  if (!conn?.encryptedCertificate || !conn.encryptedCertificatePassword || !conn.clientId) {
    return { error: "Bankovní připojení není nakonfigurováno." };
  }
  if (!isBankSecretsEncryptionConfigured()) {
    return { error: "Chybí šifrovací klíč integrací (EMAIL_CREDENTIALS_ENCRYPTION_KEY)." };
  }
  try {
    const p12 = decryptBankCertificateP12(conn.encryptedCertificate);
    const p12Password = decryptBankSecret(conn.encryptedCertificatePassword);
    const cfg = buildRaiffeisenClientConfig({
      clientId: conn.clientId,
      p12,
      p12Password,
    });
    return { cfg, connectionId: conn.id };
  } catch {
    return { error: "Nepodařilo se načíst certifikát banky." };
  }
}

export function bankConnectionPublicView(conn: BankConnectionDoc | null) {
  if (!conn) {
    return {
      configured: false,
      provider: BANK_PROVIDER_RAIFFEISEN,
      clientIdMasked: null as string | null,
      status: "disconnected" as BankConnectionStatus,
      lastSyncAt: null as string | null,
      lastSyncError: null as string | null,
      hasCertificate: false,
    };
  }
  return {
    configured: Boolean(conn.encryptedCertificate && conn.clientId),
    provider: conn.provider ?? BANK_PROVIDER_RAIFFEISEN,
    clientIdMasked: conn.clientId ? maskClientId(conn.clientId) : null,
    status: conn.status ?? "disconnected",
    lastSyncAt: conn.lastSyncAt ?? null,
    lastSyncError: conn.lastSyncError ?? null,
    hasCertificate: Boolean(conn.encryptedCertificate),
  };
}

export async function upsertBankConnectionSettings(
  db: Firestore,
  organizationId: string,
  input: {
    clientId: string;
    certificateP12?: Buffer | null;
    certificatePassword?: string | null;
    userId: string;
  }
): Promise<void> {
  if (!isBankSecretsEncryptionConfigured()) {
    throw new Error("Šifrování integrací není nakonfigurováno.");
  }
  const ref = bankConnectionsCol(db, organizationId).doc(DEFAULT_CONNECTION_ID);
  const existing = await ref.get();
  const patch: Record<string, unknown> = {
    organizationId,
    provider: BANK_PROVIDER_RAIFFEISEN,
    clientId: String(input.clientId ?? "").trim(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing.exists) {
    patch.createdAt = FieldValue.serverTimestamp();
    patch.status = "disconnected";
  }
  if (input.certificateP12 && input.certificatePassword) {
    patch.encryptedCertificate = encryptBankCertificateP12(input.certificateP12);
    patch.encryptedCertificatePassword = encryptBankSecret(input.certificatePassword);
  }
  await ref.set(patch, { merge: true });
}

export async function testBankConnectionForOrg(db: Firestore, organizationId: string): Promise<void> {
  const loaded = await getRaiffeisenClientForOrg(db, organizationId);
  if ("error" in loaded) throw new Error(loaded.error);
  await rbTestConnection(loaded.cfg);
  await bankConnectionsCol(db, organizationId).doc(DEFAULT_CONNECTION_ID).set(
    {
      status: "connected",
      lastSyncError: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function setBankConnectionStatus(
  db: Firestore,
  organizationId: string,
  status: BankConnectionStatus,
  lastSyncError?: string | null
): Promise<void> {
  await bankConnectionsCol(db, organizationId).doc(DEFAULT_CONNECTION_ID).set(
    {
      status,
      lastSyncError: lastSyncError ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function listActiveBankAccounts(db: Firestore, organizationId: string) {
  const snap = await bankAccountsCol(db, organizationId).where("isActive", "==", true).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as import("@/lib/bank/types").BankAccountDoc) }));
}
