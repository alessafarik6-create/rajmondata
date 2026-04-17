/**
 * Sestavení stejného tiskového HTML pro smlouvu jako v detailu zakázky (tlačítko „Generovat PDF“).
 * Použití: klient (modal) i server (e-mailová příloha) — jedna logika, žádné načítání chráněné URL.
 */

import type { JobTemplate, JobTemplateValues } from "@/lib/job-templates";
import {
  buildClientTextFromJobSnapshot,
  deriveCustomerDisplayNameFromJob,
  parseCustomerNameForParty,
  pickEntityDic,
} from "@/lib/job-customer-client";
import {
  buildJobTemplateDataSectionInnerHtml,
  formatJobTemplateDataPlainText,
} from "@/lib/work-contract-job-template-data";
import { formatWorkContractAmountKcFromNumber } from "@/lib/contract-template-placeholders";
import {
  computeDepositAmountKc,
  computeDoplatekKc,
  formatPercentForTemplate,
} from "@/lib/work-contract-deposit";
import { buildWorkContractPrintHtml, withLineBreaks } from "@/lib/work-contract-print-html";

/** Záznam účtu z `companies/{id}/bankAccounts` (stejné pole jako v UI). */
export type WorkContractBankAccountLike = {
  id: string;
  name?: string;
  accountNumber?: string;
  bankCode?: string;
  iban?: string;
  swift?: string;
  currency?: string;
};

export type WorkContractForm = {
  documentTitle: string;
  documentRole: "contract" | "addendum" | "attachment";
  documentSubtype: string;
  parentContractId: string;
  parentContractNumber: string;
  parentContractTitle: string;
  attachmentOrdinal: number;
  numberSeriesPrefix: string;
  templateName: string;
  contractHeader: string;
  mainContractContent: string;
  client: string;
  contractor: string;
  additionalInfo: string;
  depositPercentage: string;
  depositAmount: string;
  bankAccountNumber: string;
  bankAccountId?: string | null;
  contractNumber: string;
  contractDateLabel: string;
};

export type WorkContractDoc = {
  id: string;
  jobId?: string;
  contractType?: string;
  documentTitle?: string | null;
  title?: string | null;
  documentRole?: "contract" | "addendum" | "attachment" | string | null;
  documentSubtype?: string | null;
  parentContractId?: string | null;
  parentContractNumber?: string | null;
  parentContractTitle?: string | null;
  attachmentOrdinal?: number | null;
  numberSeriesPrefix?: string | null;
  isTemplate?: boolean;
  templateDocId?: string | null;
  templateName?: string | null;
  contractHeader?: string;
  mainContractContent?: string;
  client?: string;
  contractor?: string;
  additionalInfo?: string;
  depositPercentage?: string | number | null;
  depositAmount?: string | number | null;
  zalohovaCastka?: string | number | null;
  zalohovaProcenta?: string | number | null;
  bankAccountNumber?: string | null;
  bankAccountId?: string | null;
  contractNumber?: string | null;
  contractIssuedAt?: unknown;
  pdfHtml?: string;
  pdfSavedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type WorkContractPrintHtmlBuildContext = {
  companyDoc: Record<string, unknown> | null;
  companyNameFromDoc: string;
  /** Z kořene firmy (stejné jako `companyBankAccountNumber` v job detailu). */
  companyBankAccountNumber: string;
  bankAccounts: WorkContractBankAccountLike[];
  customer: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  jobId: string;
  jobBudgetKc: number | null;
  template: JobTemplate | null | undefined;
  workContractsForJob: WorkContractDoc[];
};

export function formatCsDateFromFirestore(value: unknown): string {
  if (value == null) return "";
  try {
    const d =
      typeof (value as { toDate?: () => Date })?.toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : value instanceof Date
          ? value
          : new Date(value as string | number);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("cs-CZ").format(d);
  } catch {
    return "";
  }
}

export function workContractDocToForm(
  data: WorkContractDoc,
  companyBankAccountNumber: string
): WorkContractForm {
  const rawRole = String(data.documentRole ?? "").trim();
  const docRole: WorkContractForm["documentRole"] =
    rawRole === "addendum"
      ? "addendum"
      : rawRole === "attachment"
        ? "attachment"
        : "contract";
  const ct = String(data.contractType ?? "").trim();
  const legacySubtype = ct === "smlouva_o_dilo" || !ct ? "work_contract" : "custom";

  return {
    documentTitle: String(data.documentTitle ?? "").trim(),
    documentRole: docRole,
    documentSubtype: String(data.documentSubtype ?? "").trim() || legacySubtype,
    parentContractId: String(data.parentContractId ?? "").trim(),
    parentContractNumber: String(data.parentContractNumber ?? "").trim(),
    parentContractTitle: String(data.parentContractTitle ?? "").trim(),
    attachmentOrdinal:
      typeof data.attachmentOrdinal === "number" && Number.isFinite(data.attachmentOrdinal)
        ? data.attachmentOrdinal
        : 0,
    numberSeriesPrefix: String(data.numberSeriesPrefix ?? "").trim().toUpperCase() || "SOD",
    templateName: (data.templateName as string) || "",
    contractHeader: (data.contractHeader as string) || "",
    mainContractContent: (data.mainContractContent as string) || "",
    client: (data.client as string) || "",
    contractor: (data.contractor as string) || "",
    additionalInfo: (data.additionalInfo as string) || "",
    depositPercentage:
      data.zalohovaProcenta != null && String(data.zalohovaProcenta) !== ""
        ? String(data.zalohovaProcenta)
        : data.depositPercentage != null
          ? String(data.depositPercentage)
          : "",
    depositAmount:
      data.zalohovaCastka != null && String(data.zalohovaCastka) !== ""
        ? String(data.zalohovaCastka)
        : data.depositAmount != null
          ? String(data.depositAmount)
          : "",
    bankAccountNumber:
      (data.bankAccountNumber as string) || companyBankAccountNumber || "",
    bankAccountId: (data.bankAccountId as string | null) ?? null,
    contractNumber: (data.contractNumber as string) || "",
    contractDateLabel:
      formatCsDateFromFirestore(data.contractIssuedAt) ||
      formatCsDateFromFirestore(data.createdAt) ||
      "",
  };
}

export function parentContractKindLabelFromDoc(c: WorkContractDoc): string {
  const role = String(c.documentRole ?? "").trim();
  if (role === "addendum") return "Dodatek";
  const st = String(c.documentSubtype ?? "").trim();
  const prefix = String(c.numberSeriesPrefix ?? "").trim().toUpperCase();
  if (prefix === "RS" || st === "reservation_contract") {
    return "Rezervační smlouva";
  }
  if (st === "work_contract" || st === "" || st === "custom" || st === "smlouva_o_dilo") {
    return "Smlouva o dílo";
  }
  return "Smlouva";
}

function buildFullCompanyAddress(co: Record<string, unknown> | null): string {
  if (!co) return "";
  const streetAndNumber = co.companyAddressStreetAndNumber;
  const city = co.companyAddressCity;
  const postalCode = co.companyAddressPostalCode;
  const country = co.companyAddressCountry;

  const structured =
    streetAndNumber || city || postalCode || country
      ? [
          streetAndNumber ? String(streetAndNumber).trim() : "",
          [postalCode ? String(postalCode).trim() : "", city ? String(city).trim() : ""]
            .filter(Boolean)
            .join(" "),
          country ? String(country).trim() : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  if (structured) return structured;

  return (
    String(co.registeredOfficeAddress ?? co.registeredOffice ?? co.address ?? co.sidlo ?? "") || ""
  );
}

function deriveCustomerDisplayName(c: Record<string, unknown> | null): string {
  if (!c) return "";
  return (
    String(c.companyName ?? "") ||
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    ""
  );
}

function deriveClientText(c: Record<string, unknown> | null): string {
  if (!c) return "";
  const name = deriveCustomerDisplayName(c);
  const address = String(c.address ?? "");
  const ico = c.ico ? `IČO: ${c.ico}` : "";
  const dicRaw = pickEntityDic(c);
  const dic = dicRaw ? `DIČ: ${dicRaw}` : "";
  const email = c.email ? `Email: ${c.email}` : "";
  const phone = c.phone ? `Telefon: ${c.phone}` : "";
  return [name, address, ico, dic, email, phone].filter(Boolean).join("\n");
}

function formatCompanyBankAccountNumber(
  companyBankAccountNumber: string,
  ba?: WorkContractBankAccountLike | null
): string {
  if (!ba) return companyBankAccountNumber || "";
  const iban = (ba.iban || "").trim();
  if (iban) return iban;
  const acc = (ba.accountNumber || "").trim();
  const code = (ba.bankCode || "").trim();
  if (acc && code) return `${acc}/${code}`;
  return acc || "";
}

function deriveContractorText(
  co: Record<string, unknown> | null,
  coName: string,
  bankAccount?: WorkContractBankAccountLike | null
): string {
  const name = coName || String(co?.companyName ?? co?.name ?? "");
  const address = buildFullCompanyAddress(co);
  const ico = co?.ico ? `IČO: ${co.ico}` : "";
  const dicRaw = pickEntityDic(co);
  const dic = dicRaw ? `DIČ: ${dicRaw}` : "";
  const email = co?.email ? `Email: ${String(co.email)}` : "";
  const phone = co?.phone ? `Telefon: ${String(co.phone)}` : "";

  const iban = (bankAccount?.iban || "").trim();
  const swift = (bankAccount?.swift || "").trim();
  const acc = (bankAccount?.accountNumber || "").trim();
  const bankCode = (bankAccount?.bankCode || "").trim();
  const czechAcc = acc && bankCode ? `${acc}/${bankCode}` : acc || "";

  const czechLine =
    czechAcc && bankCode
      ? `Číslo účtu / kód banky: ${czechAcc}`
      : czechAcc
        ? `Číslo účtu: ${czechAcc}`
        : "";

  const ibanLine = iban ? `IBAN: ${iban}` : "";
  const swiftLine = swift ? `SWIFT: ${swift}` : "";

  return [name, address, ico, dic, email, phone, czechLine, ibanLine, swiftLine]
    .filter(Boolean)
    .join("\n");
}

function resolveCompanyProfileBankAccountDisplay(ctx: WorkContractPrintHtmlBuildContext): string {
  const fromDoc = (ctx.companyBankAccountNumber || "").trim();
  if (fromDoc) return fromDoc;
  if (ctx.bankAccounts?.length) {
    return formatCompanyBankAccountNumber(ctx.companyBankAccountNumber, ctx.bankAccounts[0]).trim();
  }
  return "";
}

function resolveSelectedBankAccount(
  ctx: WorkContractPrintHtmlBuildContext,
  form: WorkContractForm
): WorkContractBankAccountLike | null {
  if (!form.bankAccountId) return null;
  return (ctx.bankAccounts || []).find((a) => a.id === form.bankAccountId) || null;
}

export function applyWorkContractTemplateVariables(
  input: string,
  form: WorkContractForm,
  ctx: WorkContractPrintHtmlBuildContext,
  templateOpts?: { freezePlaceholders?: ReadonlySet<string> }
): string {
  const today = new Intl.DateTimeFormat("cs-CZ").format(new Date());
  const companyDoc = ctx.companyDoc;
  const job = ctx.job;

  const supplierName =
    ctx.companyNameFromDoc ||
    String(companyDoc?.companyName ?? "") ||
    String(companyDoc?.name ?? "");
  const supplierAddress = buildFullCompanyAddress(companyDoc);
  const supplierIco = String(companyDoc?.ico ?? "");
  const supplierDicRaw = pickEntityDic(companyDoc);

  const bankAccountForTokens = resolveSelectedBankAccount(ctx, form);

  const supplierAutoText = deriveContractorText(companyDoc, supplierName, bankAccountForTokens);

  const customer = ctx.customer;
  const customerName = customer
    ? deriveCustomerDisplayName(customer)
    : deriveCustomerDisplayNameFromJob(
        job as { customerName?: string | null }
      );
  const customerAddress =
    (customer?.address as string | undefined) ||
    (typeof job?.customerAddress === "string" ? job.customerAddress : "") ||
    "";
  const customerIco = String(customer?.ico ?? "");
  const customerDicRaw = pickEntityDic(customer);

  const customerAutoText = customer
    ? deriveClientText(customer)
    : buildClientTextFromJobSnapshot(
        job as {
          customerName?: string | null;
          customerPhone?: string | null;
          customerEmail?: string | null;
          customerAddress?: string | null;
        }
      );

  const partySplit = parseCustomerNameForParty(customerName);
  const objednatelJmeno = customer
    ? String(customer.firstName || "").trim()
    : partySplit.type === "person"
      ? partySplit.firstName
      : "";
  const objednatelPrijmeni = customer
    ? String(customer.lastName || "").trim()
    : partySplit.type === "person"
      ? partySplit.lastName
      : "";

  const depositPercentage = form.depositPercentage;
  const depositAmount = form.depositAmount;

  const depKc = computeDepositAmountKc({
    depositAmountStr: depositAmount ?? "",
    depositPercentStr: depositPercentage ?? "",
    budgetKc: ctx.jobBudgetKc,
  });
  const doplatekKc = computeDoplatekKc(ctx.jobBudgetKc, depKc);
  const doplatekFormatted =
    doplatekKc != null ? formatWorkContractAmountKcFromNumber(doplatekKc) : "";

  const pctFieldOnly = String(depositPercentage ?? "").trim();
  const zalohovaProcentaTemplate = pctFieldOnly ? formatPercentForTemplate(pctFieldOnly) : "";

  const bankAccountNumber = form.bankAccountNumber;
  const contractNo = form.contractNumber?.trim() || "";
  const parentContractNoTok = form.parentContractNumber?.trim() || "";
  const parentContractTitleTok = form.parentContractTitle?.trim() || "";
  const attachmentOrdTok =
    form.attachmentOrdinal != null && form.attachmentOrdinal > 0
      ? String(form.attachmentOrdinal)
      : "";
  const contractDateForTokens = form.contractDateLabel?.trim() || today;

  const cenaZakazky =
    ctx.jobBudgetKc != null && Number.isFinite(ctx.jobBudgetKc)
      ? `${Math.round(ctx.jobBudgetKc).toLocaleString("cs-CZ")} Kč`
      : "";

  const companyProfileBankAccountDisplay = resolveCompanyProfileBankAccountDisplay(ctx);

  const tokenMap: Record<string, string> = {
    "smlouva.cislo": contractNo,
    "smlouva.vs": contractNo,
    "smlouva.datum": contractDateForTokens,
    "rodic_smlouva.cislo": parentContractNoTok,
    "rodic_smlouva.nazev": parentContractTitleTok,
    "priloha.poradi": attachmentOrdTok,
    "smlouva.nadrazena_cislo": parentContractNoTok,
    "smlouva.nadrazena_nazev": parentContractTitleTok,
    nazev_firmy: supplierName,
    ico: supplierIco ? String(supplierIco) : "",
    dic: supplierDicRaw ? String(supplierDicRaw) : "—",
    adresa: supplierAddress,
    cislo_uctu_firmy: companyProfileBankAccountDisplay,
    variabilni_symbol: contractNo,
    jmeno_zakaznika: customerName,
    nazev_zakazky: String(job?.name ?? ""),
    cena: cenaZakazky,
    "dodavatel.nazev": supplierName,
    "dodavatel.sidlo": supplierAddress,
    "dodavatel.ico": supplierIco ? String(supplierIco) : "",
    "dodavatel.dic": supplierDicRaw ? String(supplierDicRaw) : "—",
    dodavatel: supplierAutoText,
    "dodavatel.email": companyDoc?.email ? String(companyDoc.email) : "",
    "dodavatel.telefon": companyDoc?.phone ? String(companyDoc.phone) : "",
    "dodavatel.ucet":
      (bankAccountNumber && String(bankAccountNumber).trim()) ||
      companyProfileBankAccountDisplay ||
      "",
    "dodavatel.iban": bankAccountForTokens?.iban ? String(bankAccountForTokens.iban) : "",
    "dodavatel.swift": bankAccountForTokens?.swift ? String(bankAccountForTokens.swift) : "",

    "objednatel.nazev": customerName,
    "objednatel.jmeno": objednatelJmeno,
    "objednatel.prijmeni": objednatelPrijmeni,
    "objednatel.sidlo": customerAddress,
    "objednatel.ico": customerIco ? String(customerIco) : "",
    "objednatel.dic": customerDicRaw || "—",
    objednatel: customerAutoText,

    "zakazka.nazev": String(job?.name ?? ""),
    "zakazka.id": ctx.jobId?.toString() || "",
    datum: today,

    "zaloha.procenta": zalohovaProcentaTemplate,
    "zaloha.castka": formatWorkContractAmountKcFromNumber(depKc),
    "zaloha.ucet":
      (bankAccountNumber && String(bankAccountNumber).trim()) ||
      companyProfileBankAccountDisplay ||
      "",
    zaloha: formatWorkContractAmountKcFromNumber(depKc),
    zalohova_castka: formatWorkContractAmountKcFromNumber(depKc),
    zalohova_procenta: zalohovaProcentaTemplate,
    doplatek: doplatekFormatted,

    data_sablony: formatJobTemplateDataPlainText(
      ctx.template as JobTemplate | undefined,
      (job?.templateValues as JobTemplateValues | undefined) ?? undefined
    ),
  };

  if (!input) return "";
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, token: string) => {
    if (templateOpts?.freezePlaceholders?.has(token)) return match;
    const v = tokenMap[token];
    return v !== undefined ? v : match;
  });
}

/**
 * Stejný výstup jako `buildContractHtmlForForm` v `page.tsx` (tisk / PDF).
 */
export function buildWorkContractPrintHtmlString(
  form: WorkContractForm,
  ctx: WorkContractPrintHtmlBuildContext
): string {
  const orgSigUrl = String(
    (ctx.companyDoc as { organizationSignature?: { url?: string } } | null)?.organizationSignature
      ?.url ?? ""
  ).trim();
  if (!orgSigUrl) {
    throw new Error(
      "Organizace nemá nastavený elektronický podpis. Nastavte ho v Nastavení organizace (Elektronický podpis organizace)."
    );
  }

  const companyProfileBankAccountDisplay = resolveCompanyProfileBankAccountDisplay(ctx);

  if (form.documentRole === "attachment") {
    const headerRaw = applyWorkContractTemplateVariables(form.contractHeader || "", form, ctx);
    const bodyRaw = applyWorkContractTemplateVariables(form.mainContractContent || "", form, ctx);
    const additionalRaw = applyWorkContractTemplateVariables(form.additionalInfo || "", form, ctx);
    const clientRaw = applyWorkContractTemplateVariables(form.client || "", form, ctx);
    const contractorRaw = applyWorkContractTemplateVariables(form.contractor || "", form, ctx);
    const parentDoc = ctx.workContractsForJob.find((c) => c.id === form.parentContractId);
    const parentKind = parentDoc ? parentContractKindLabelFromDoc(parentDoc) : "";

    const jobTitleAtt = String(ctx.job?.name ?? "");
    const jobDescAtt = String(ctx.job?.description ?? "");
    const priceFormattedAtt =
      ctx.jobBudgetKc != null && Number.isFinite(ctx.jobBudgetKc)
        ? `${Math.round(ctx.jobBudgetKc).toLocaleString("cs-CZ")} Kč`
        : "";
    const deadlineFormattedAtt = String(ctx.job?.endDate ?? "").trim();

    const templateDataSectionInnerHtmlAtt = buildJobTemplateDataSectionInnerHtml(
      ctx.template as JobTemplate | undefined,
      (ctx.job?.templateValues as JobTemplateValues | undefined) ?? undefined
    );

    return buildWorkContractPrintHtml({
      printVariant: "attachment",
      pageTitle:
        form.documentTitle?.trim() ||
        (form.attachmentOrdinal > 0 ? `Příloha č. ${form.attachmentOrdinal}` : "Příloha ke smlouvě"),
      contractNumber: form.contractNumber?.trim() || "",
      variableSymbol: form.contractNumber?.trim() || "",
      documentDate:
        form.contractDateLabel?.trim() || new Intl.DateTimeFormat("cs-CZ").format(new Date()),
      contractHeaderHtml: withLineBreaks(headerRaw),
      mainBodyHtml: withLineBreaks(bodyRaw),
      additionalInfoHtml: withLineBreaks(additionalRaw),
      zhotovitelHtml: withLineBreaks(contractorRaw),
      objednatelHtml: withLineBreaks(clientRaw),
      organizationSignatureUrl: orgSigUrl,
      jobTitle: jobTitleAtt,
      jobDescription: jobDescAtt,
      priceFormatted: priceFormattedAtt,
      deadlineFormatted: deadlineFormattedAtt,
      paymentTermsHtml: "",
      templateDataSectionInnerHtml: templateDataSectionInnerHtmlAtt,
      parentContractNumber: form.parentContractNumber?.trim() || "",
      parentContractTitle: form.parentContractTitle?.trim() || "",
      parentContractKindLabel: parentKind,
    });
  }

  const headerRaw = applyWorkContractTemplateVariables(form.contractHeader || "", form, ctx);
  const bodyRaw = applyWorkContractTemplateVariables(form.mainContractContent || "", form, ctx);
  const additionalRaw = applyWorkContractTemplateVariables(form.additionalInfo || "", form, ctx);
  const clientRaw = applyWorkContractTemplateVariables(form.client || "", form, ctx);
  const contractorRaw = applyWorkContractTemplateVariables(form.contractor || "", form, ctx);

  const payCompanyAcct = companyProfileBankAccountDisplay.trim();
  const payFormAcct = (form.bankAccountNumber || "").trim();
  const depPctForm = (form.depositPercentage || "").trim();
  const depKcForm = computeDepositAmountKc({
    depositAmountStr: form.depositAmount ?? "",
    depositPercentStr: form.depositPercentage ?? "",
    budgetKc: ctx.jobBudgetKc,
  });
  const depPctDisplay = depPctForm ? formatPercentForTemplate(depPctForm) : "";
  const paymentLines = [
    payCompanyAcct ? `Číslo účtu: ${payCompanyAcct}` : "",
    form.contractNumber?.trim() ? `Variabilní symbol: ${form.contractNumber.trim()}` : "",
    depPctForm ? `Záloha ve výši ${depPctDisplay} z ceny díla.` : "",
    depKcForm > 0 ? `Částka zálohy: ${formatWorkContractAmountKcFromNumber(depKcForm)}.` : "",
    payFormAcct && payFormAcct !== payCompanyAcct ? `Úhrada zálohy na účet: ${payFormAcct}.` : "",
  ].filter(Boolean);
  const paymentTermsHtml = withLineBreaks(paymentLines.join("\n"));

  const jobTitle = String(ctx.job?.name ?? "");
  const jobDesc = String(ctx.job?.description ?? "");
  const priceFormatted =
    ctx.jobBudgetKc != null && Number.isFinite(ctx.jobBudgetKc)
      ? `${Math.round(ctx.jobBudgetKc).toLocaleString("cs-CZ")} Kč`
      : "";
  const deadlineFormatted = String(ctx.job?.endDate ?? "").trim();

  const templateDataSectionInnerHtml = buildJobTemplateDataSectionInnerHtml(
    ctx.template as JobTemplate | undefined,
    (ctx.job?.templateValues as JobTemplateValues | undefined) ?? undefined
  );

  return buildWorkContractPrintHtml({
    pageTitle:
      form.documentTitle?.trim() || form.templateName?.trim() || "Smlouva o dílo",
    contractNumber: form.contractNumber?.trim() || "",
    variableSymbol: form.contractNumber?.trim() || "",
    documentDate:
      form.contractDateLabel?.trim() || new Intl.DateTimeFormat("cs-CZ").format(new Date()),
    contractHeaderHtml: withLineBreaks(headerRaw),
    mainBodyHtml: withLineBreaks(bodyRaw),
    additionalInfoHtml: withLineBreaks(additionalRaw),
    zhotovitelHtml: withLineBreaks(contractorRaw),
    objednatelHtml: withLineBreaks(clientRaw),
    organizationSignatureUrl: orgSigUrl,
    jobTitle,
    jobDescription: jobDesc,
    priceFormatted,
    deadlineFormatted,
    paymentTermsHtml,
    templateDataSectionInnerHtml,
  });
}
