import {
  type Firestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import type { HandoverProtocolTemplateContent } from "@/lib/handover-protocol-template-fields";

export const HANDOVER_PROTOCOL_TEMPLATES_COLLECTION = "handoverProtocolTemplates";

export type HandoverProtocolTemplateDoc = {
  id: string;
  companyId: string;
  name: string;
  content: HandoverProtocolTemplateContent;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  createdBy?: string | null;
};

export async function fetchHandoverProtocolTemplates(
  db: Firestore,
  companyId: string
): Promise<HandoverProtocolTemplateDoc[]> {
  const q = query(
    collection(db, HANDOVER_PROTOCOL_TEMPLATES_COLLECTION),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<HandoverProtocolTemplateDoc, "id">;
      return { id: d.id, ...data };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export async function createHandoverProtocolTemplate(
  db: Firestore,
  input: {
    companyId: string;
    name: string;
    content: HandoverProtocolTemplateContent;
    createdBy?: string | null;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, HANDOVER_PROTOCOL_TEMPLATES_COLLECTION), {
    companyId: input.companyId,
    name: input.name.trim(),
    content: input.content,
    createdBy: input.createdBy ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateHandoverProtocolTemplate(
  db: Firestore,
  templateId: string,
  patch: { name?: string; content?: HandoverProtocolTemplateContent }
): Promise<void> {
  const payload: {
    updatedAt: ReturnType<typeof serverTimestamp>;
    name?: string;
    content?: HandoverProtocolTemplateContent;
  } = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.content !== undefined) payload.content = patch.content;
  await updateDoc(doc(db, HANDOVER_PROTOCOL_TEMPLATES_COLLECTION, templateId), payload);
}

export async function deleteHandoverProtocolTemplate(
  db: Firestore,
  templateId: string
): Promise<void> {
  await deleteDoc(doc(db, HANDOVER_PROTOCOL_TEMPLATES_COLLECTION, templateId));
}
