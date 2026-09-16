import type { Firestore } from "firebase-admin/firestore";
import { CONTRACT_ADDENDUM_SYSTEM_PROMPT } from "@/lib/ai/contract-addendum-system-prompt";
import { generatePlainTextWithOpenAi, OpenAiClientError } from "@/lib/ai/openai-client";
import { buildJobCustomerAddressBlock } from "@/lib/customer-address-display";
import { resolveJobBudgetFromFirestore } from "@/lib/vat-calculations";
import {
  formatCsDateFromFirestore,
  type WorkContractDoc,
} from "@/lib/work-contract-print-html-build";

export type ContractAddendumAiMode = "generate" | "regenerate" | "improve";

function stripHtmlToPlain(input: string, maxLen: number): string {
  const plain = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen)}…`;
}

function isBaseContract(doc: WorkContractDoc): boolean {
  const role = String(doc.documentRole ?? "").trim();
  return role !== "addendum" && role !== "attachment";
}

export async function resolveParentContractForAddendumAi(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  parentContractId: string | null;
}): Promise<
  | { ok: true; parent: WorkContractDoc & { id: string } }
  | { ok: false; error: string; status: number }
> {
  const snap = await params.db
    .collection("companies")
    .doc(params.companyId)
    .collection("jobs")
    .doc(params.jobId)
    .collection("workContracts")
    .get();

  const contracts: (WorkContractDoc & { id: string })[] = snap.docs.map((d) => ({
    ...(d.data() as WorkContractDoc),
    id: d.id,
  }));

  const bases = contracts.filter(isBaseContract);

  const requested = String(params.parentContractId ?? "").trim();
  if (requested) {
    const found = contracts.find((c) => c.id === requested);
    if (!found) {
      return { ok: false, error: "Vybraná smlouva neexistuje u této zakázky.", status: 404 };
    }
    if (!isBaseContract(found)) {
      return {
        ok: false,
        error: "Dodatek lze vázat pouze na smlouvu (ne na jiný dodatek nebo přílohu).",
        status: 400,
      };
    }
    return { ok: true, parent: found };
  }

  if (bases.length === 1) {
    return { ok: true, parent: bases[0]! };
  }
  if (bases.length === 0) {
    return {
      ok: false,
      error: "U zakázky není žádná smlouva, ke které by šel dodatek navázat.",
      status: 400,
    };
  }
  return {
    ok: false,
    error: "Vyberte smlouvu, ke které má být dodatek vytvořen.",
    status: 400,
  };
}

export async function generateContractAddendumText(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  parentContractId: string | null;
  userBrief: string;
  existingDraft?: string;
  mode: ContractAddendumAiMode;
}): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  const brief = String(params.userBrief ?? "").trim();
  if (brief.length < 8) {
    return {
      ok: false,
      error: "Popište, co má dodatek změnit nebo doplnit (alespoň několik slov).",
      status: 400,
    };
  }

  const jobSnap = await params.db
    .collection("companies")
    .doc(params.companyId)
    .collection("jobs")
    .doc(params.jobId)
    .get();
  if (!jobSnap.exists) {
    return { ok: false, error: "Zakázka neexistuje.", status: 404 };
  }
  const job = jobSnap.data() as Record<string, unknown>;
  const jobCompanyId = String(job.companyId ?? params.companyId).trim();
  if (jobCompanyId !== params.companyId) {
    return { ok: false, error: "Zakázka nepatří do této organizace.", status: 403 };
  }

  const parentResolved = await resolveParentContractForAddendumAi({
    db: params.db,
    companyId: params.companyId,
    jobId: params.jobId,
    parentContractId: params.parentContractId,
  });
  if (!parentResolved.ok) return parentResolved;
  const parent = parentResolved.parent;

  const companySnap = await params.db.collection("companies").doc(params.companyId).get();
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;

  let customer: Record<string, unknown> | null = null;
  const customerId = String(job.customerId ?? "").trim();
  if (customerId) {
    const custSnap = await params.db
      .collection("companies")
      .doc(params.companyId)
      .collection("customers")
      .doc(customerId)
      .get();
    if (custSnap.exists) customer = custSnap.data() as Record<string, unknown>;
  }

  const budget = resolveJobBudgetFromFirestore(job);
  const addr = buildJobCustomerAddressBlock(job, customer);

  const parentBodyPlain = stripHtmlToPlain(
    String(parent.mainContractContent ?? ""),
    12000
  );
  const parentHeaderPlain = stripHtmlToPlain(String(parent.contractHeader ?? ""), 4000);

  const context = {
    job: {
      id: params.jobId,
      name: String(job.name ?? "").trim(),
      status: String(job.status ?? "").trim(),
      startDate: String(job.startDate ?? "").trim(),
      endDate: String(job.endDate ?? "").trim(),
      customerAddress: String(job.customerAddress ?? "").trim(),
      description: String(job.description ?? "").trim(),
    },
    customer: {
      displayName: addr.displayName,
      addressLines: addr.addressLines,
      email: customer ? String(customer.email ?? "").trim() : "",
    },
    contractor: {
      companyName: String(company.companyName ?? company.name ?? "").trim(),
      address: String(company.address ?? company.registeredAddress ?? "").trim(),
      ico: String(company.ico ?? company.dic ?? "").trim(),
    },
    jobBudget: budget
      ? {
          net: budget.budgetNet,
          vat: budget.budgetVat,
          gross: budget.budgetGross,
          vatRate: budget.vatRate,
        }
      : null,
    parentContract: {
      id: parent.id,
      number: String(parent.contractNumber ?? "").trim(),
      title: String(parent.documentTitle ?? parent.title ?? "").trim(),
      date: formatCsDateFromFirestore(parent.contractIssuedAt ?? parent.createdAt),
      headerExcerpt: parentHeaderPlain,
      bodyExcerpt: parentBodyPlain,
      clientBlock: stripHtmlToPlain(String(parent.client ?? ""), 2000),
      contractorBlock: stripHtmlToPlain(String(parent.contractor ?? ""), 2000),
    },
    addendumDraft: {
      documentTitle: "",
      number: "",
    },
  };

  const modeHint =
    params.mode === "improve"
      ? "Uživatel již má návrh textu dodatku — vylepši ho (zachovej smysl, zpřesni formulace, oprav stylistiku), stále bez vymýšlení faktů."
      : params.mode === "regenerate"
        ? "Připrav nový návrh textu dodatku podle zadání (nahraď předchozí návrh)."
        : "Připrav první návrh textu dodatku podle zadání.";

  const userPrompt = [
    modeHint,
    "",
    "POŽADAVEK UŽIVATELE (co má dodatek změnit nebo doplnit):",
    brief,
    "",
    "KONTEXT (JSON — používej pouze tyto údaje):",
    JSON.stringify(context, null, 2),
    "",
    params.existingDraft?.trim()
      ? ["SOUČASNÝ NÁVRH TEXTU DODATKU (pro vylepšení / přepracování):", params.existingDraft.trim()].join(
          "\n"
        )
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generatePlainTextWithOpenAi(userPrompt, {
      instructions: CONTRACT_ADDENDUM_SYSTEM_PROMPT,
    });
    const text = result.outputText.trim();
    if (!text) {
      return { ok: false, error: "Text se nepodařilo vygenerovat. Zkuste to znovu.", status: 502 };
    }
    return { ok: true, text };
  } catch (err) {
    if (err instanceof OpenAiClientError) {
      return {
        ok: false,
        error: err.userMessage || "Text se nepodařilo vygenerovat. Zkuste to znovu.",
        status: err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502,
      };
    }
    return { ok: false, error: "Text se nepodařilo vygenerovat. Zkuste to znovu.", status: 502 };
  }
}
