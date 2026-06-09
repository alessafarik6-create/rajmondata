import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  WORK_BUDGET_TEMPLATES_COLLECTION,
  type WorkBudgetTemplateContent,
  type WorkBudgetTemplateDoc,
} from "@/lib/work-budget-types";

export async function fetchWorkBudgetTemplates(
  db: Firestore,
  companyId: string
): Promise<WorkBudgetTemplateDoc[]> {
  const q = query(
    collection(db, WORK_BUDGET_TEMPLATES_COLLECTION),
    where("companyId", "==", companyId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<WorkBudgetTemplateDoc, "id">;
      return { id: d.id, ...data };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export async function createWorkBudgetTemplate(
  db: Firestore,
  input: {
    companyId: string;
    name: string;
    content: WorkBudgetTemplateContent;
    createdBy?: string | null;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, WORK_BUDGET_TEMPLATES_COLLECTION),
    {
      companyId: input.companyId,
      name: input.name.trim(),
      content: input.content,
      createdBy: input.createdBy ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );
  return ref.id;
}

export async function deleteWorkBudgetTemplate(
  db: Firestore,
  companyId: string,
  templateId: string
): Promise<void> {
  await deleteDoc(doc(db, WORK_BUDGET_TEMPLATES_COLLECTION, templateId));
}

export async function updateWorkBudgetTemplate(
  db: Firestore,
  _companyId: string,
  templateId: string,
  patch: { name?: string; content?: WorkBudgetTemplateContent }
): Promise<void> {
  const payload: {
    updatedAt: ReturnType<typeof serverTimestamp>;
    name?: string;
    content?: WorkBudgetTemplateContent;
  } = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.content !== undefined) payload.content = patch.content;
  await updateDoc(doc(db, WORK_BUDGET_TEMPLATES_COLLECTION, templateId), payload);
}
