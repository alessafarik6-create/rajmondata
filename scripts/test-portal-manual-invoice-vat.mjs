import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function computeExpenseAmountsFromInput({ amountInput, amountType, vatRate }) {
  const inp = roundMoney2(amountInput);
  if (amountType === "net") {
    const amountNet = inp;
    const vatAmount = roundMoney2((amountNet * vatRate) / 100);
    return { amountNet, vatAmount, amountGross: roundMoney2(amountNet + vatAmount) };
  }
  const amountGross = inp;
  if (vatRate === 0) return { amountNet: amountGross, vatAmount: 0, amountGross };
  const amountNet = roundMoney2(amountGross / (1 + vatRate / 100));
  return { amountNet, vatAmount: roundMoney2(amountGross - amountNet), amountGross };
}

function computeTotals(items) {
  let amountNet = 0;
  let amountGross = 0;
  const vatMap = { 0: { vat: 0 }, 12: { vat: 0 }, 21: { vat: 0 } };
  for (const it of items) {
    const qty = Math.max(0, Number(it.quantity) || 0);
    const unit = computeExpenseAmountsFromInput({
      amountInput: Number(it.unitPrice) || 0,
      amountType: it.priceType,
      vatRate: it.vatRate,
    });
    const lineNet = roundMoney2(unit.amountNet * qty);
    const lineVat = roundMoney2(unit.vatAmount * qty);
    const lineGross = roundMoney2(unit.amountGross * qty);
    amountNet = roundMoney2(amountNet + lineNet);
    amountGross = roundMoney2(amountGross + lineGross);
    vatMap[it.vatRate].vat = roundMoney2(vatMap[it.vatRate].vat + lineVat);
  }
  return { amountNet, amountGross, vatAmount: roundMoney2(amountGross - amountNet), vatMap };
}

function approx(a, b, eps = 0.02) {
  return Math.abs(a - b) <= eps;
}

const net21 = computeTotals([
  { quantity: 2, unitPrice: 100, priceType: "net", vatRate: 21 },
]);
if (!approx(net21.amountNet, 200) || !approx(net21.amountGross, 242)) {
  failures.push("net 21% line totals");
}

const gross21 = computeTotals([
  { quantity: 1, unitPrice: 121, priceType: "gross", vatRate: 21 },
]);
if (!approx(gross21.amountGross, 121) || !approx(gross21.amountNet, 100)) {
  failures.push("gross 21% line totals");
}

const vat12 = computeTotals([
  { quantity: 1, unitPrice: 112, priceType: "gross", vatRate: 12 },
]);
if (!approx(vat12.vatMap[12].vat, 12)) failures.push("vat 12% breakdown");

const vat0 = computeTotals([
  { quantity: 3, unitPrice: 50, priceType: "gross", vatRate: 0 },
]);
if (!approx(vat0.amountGross, 150) || !approx(vat0.vatAmount, 0)) failures.push("vat 0%");

const lib = readFileSync(join(root, "src/lib/portal-manual-invoice.ts"), "utf8");
if (!lib.includes("computePortalManualInvoiceTotals")) failures.push("portal-manual-invoice missing totals");
if (!lib.includes("inventoryItemId")) failures.push("portal-manual-invoice missing inventory link");

const html = readFileSync(join(root, "src/lib/invoice-a4-html.ts"), "utf8");
if (!html.includes("vatBreakdownByRate")) failures.push("invoice-a4-html missing vatBreakdownByRate");

const form = readFileSync(join(root, "src/components/invoices/portal-manual-invoice-form.tsx"), "utf8");
if (!form.includes("PortalManualInvoiceLineCard")) failures.push("form missing line card");
if (!form.includes("syncPortalInvoiceToDocuments")) failures.push("form missing document sync");
if (!form.includes("Náhled faktury")) failures.push("form missing preview button");

if (failures.length) {
  console.error("FAIL portal manual invoice:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}
console.log("OK portal manual invoice tests passed");
