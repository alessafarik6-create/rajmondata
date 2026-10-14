import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { BankAutomationLogDoc } from "@/lib/bank/types";

export function bankAutomationLogsCol(db: Firestore, organizationId: string) {
  return db.collection("companies").doc(organizationId).collection("bankAutomationLogs");
}

export async function appendBankAutomationLog(
  db: Firestore,
  input: Omit<BankAutomationLogDoc, "createdAt"> & { organizationId: string }
): Promise<void> {
  await bankAutomationLogsCol(db, input.organizationId).add({
    organizationId: input.organizationId,
    kind: input.kind,
    success: input.success,
    message: input.message ?? null,
    metadata: input.metadata ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}
