/**
 * Deterministický cenový engine — autoritativní ceny z CRM pravidel a katalogu.
 * AI nikdy nepočítá finální cenu.
 */

import type { AiCrmProductRef } from "@/lib/ai/crm-context-builder";
import type {
  AiPriceCalculationType,
  AiPriceExplainability,
  AiPriceExplainabilityLine,
  AiPriceRuleDoc,
} from "@/lib/ai/ai-center-types";
import { parseInquiryDimensions, type ParsedInquiryDimensions } from "@/lib/ai/dimension-parser";

export type PriceEngineItemInput = {
  catalogId: string;
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  discountPercent: number;
  reason?: string;
};

export type PriceEngineResolvedItem = PriceEngineItemInput & {
  unitPrice: number;
  lineNet: number;
  priceSource: "catalog" | "price_rule";
  ruleId?: string;
};

export type PriceEngineResult = {
  items: PriceEngineResolvedItem[];
  explainability: AiPriceExplainability;
  warnings: string[];
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function ruleIsActiveNow(rule: AiPriceRuleDoc, now = new Date()): boolean {
  if (!rule.active) return false;
  if (rule.validFrom) {
    const from = Date.parse(rule.validFrom);
    if (!Number.isNaN(from) && now.getTime() < from) return false;
  }
  if (rule.validTo) {
    const to = Date.parse(rule.validTo);
    if (!Number.isNaN(to) && now.getTime() > to) return false;
  }
  return true;
}

function inquiryTypeMatches(rule: AiPriceRuleDoc, inquiryType: string, typeRuleName: string): boolean {
  const pattern = String(rule.inquiryType ?? "").trim();
  if (!pattern) return true;
  const hay = normalize(`${inquiryType} ${typeRuleName}`);
  return hay.includes(normalize(pattern));
}

function sortRules(rules: AiPriceRuleDoc[]): AiPriceRuleDoc[] {
  return [...rules]
    .filter((r) => ruleIsActiveNow(r))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function resolveQuantityForRule(
  rule: AiPriceRuleDoc,
  item: PriceEngineItemInput,
  dims: ParsedInquiryDimensions
): { quantity: number; unit: string } | null {
  switch (rule.calculationType) {
    case "per_m2": {
      if (item.unit === "m2" || item.unit === "m²") {
        return { quantity: item.quantity, unit: "m²" };
      }
      if (dims.areaM2 != null && dims.areaM2 > 0) {
        return { quantity: dims.areaM2, unit: "m²" };
      }
      return null;
    }
    case "per_bm":
      return { quantity: item.quantity, unit: "bm" };
    case "per_piece":
      return { quantity: item.quantity, unit: "ks" };
    case "fixed":
      return { quantity: 1, unit: "ks" };
    case "percentage_markup":
    case "percentage_discount":
    case "min_price":
    case "max_discount":
      return { quantity: item.quantity, unit: item.unit || "ks" };
    default:
      return null;
  }
}

function computeLineNet(
  calculationType: AiPriceCalculationType,
  value: number,
  quantity: number,
  baseLineNet: number
): number {
  switch (calculationType) {
    case "per_m2":
    case "per_bm":
    case "per_piece":
      return roundMoney(value * quantity);
    case "fixed":
      return roundMoney(value);
    case "percentage_markup":
      return roundMoney(baseLineNet * (value / 100));
    case "percentage_discount":
      return roundMoney(-baseLineNet * (value / 100));
    case "min_price":
      return roundMoney(Math.max(0, value - baseLineNet));
    case "max_discount":
      return 0;
    default:
      return roundMoney(value * quantity);
  }
}

function formatExpression(
  rule: AiPriceRuleDoc,
  quantity: number,
  unit: string,
  unitPrice: number,
  lineNet: number
): string {
  if (rule.calculationType === "fixed") {
    return `${rule.name}: ${lineNet} ${rule.currency}`;
  }
  if (rule.calculationType === "percentage_markup" || rule.calculationType === "percentage_discount") {
    return `${rule.name}: ${rule.value} % → ${lineNet} ${rule.currency}`;
  }
  return `${quantity} ${unit} × ${unitPrice} ${rule.currency} = ${lineNet} ${rule.currency}`;
}

function findMatchingRule(
  rules: AiPriceRuleDoc[],
  item: PriceEngineItemInput,
  inquiryType: string,
  typeRuleName: string,
  inquiryText: string
): AiPriceRuleDoc | null {
  const itemName = normalize(item.name);
  const haystack = normalize(`${inquiryText} ${item.name}`);

  for (const rule of rules) {
    if (!inquiryTypeMatches(rule, inquiryType, typeRuleName)) continue;

    if (rule.catalogId && rule.productId) {
      if (rule.catalogId === item.catalogId && rule.productId === item.productId) {
        return rule;
      }
      continue;
    }

    const pattern = String(rule.productNamePattern ?? "").trim();
    if (pattern) {
      const p = normalize(pattern);
      if (itemName.includes(p) || haystack.includes(p)) return rule;
    }
  }
  return null;
}

function findStandaloneAddonRules(
  rules: AiPriceRuleDoc[],
  inquiryType: string,
  typeRuleName: string,
  inquiryText: string,
  usedRuleIds: Set<string>
): AiPriceRuleDoc[] {
  const hay = normalize(inquiryText);
  const out: AiPriceRuleDoc[] = [];
  for (const rule of rules) {
    if (usedRuleIds.has(rule.id ?? rule.name)) continue;
    if (rule.catalogId || rule.productId) continue;
    if (!inquiryTypeMatches(rule, inquiryType, typeRuleName)) continue;
    const pattern = String(rule.productNamePattern ?? rule.name ?? "").trim();
    if (!pattern) continue;
    if (hay.includes(normalize(pattern))) out.push(rule);
  }
  return out;
}

function findBaseInquiryPriceRules(
  rules: AiPriceRuleDoc[],
  inquiryType: string,
  typeRuleName: string,
  usedRuleIds: Set<string>
): AiPriceRuleDoc[] {
  const out: AiPriceRuleDoc[] = [];
  for (const rule of rules) {
    if (usedRuleIds.has(rule.id ?? rule.name)) continue;
    if (rule.catalogId || rule.productId) continue;
    if (String(rule.productNamePattern ?? "").trim()) continue;
    if (!inquiryTypeMatches(rule, inquiryType, typeRuleName)) continue;
    if (rule.calculationType === "per_m2" || rule.calculationType === "fixed") {
      out.push(rule);
    }
  }
  return out;
}

export function runPriceEngine(params: {
  items: PriceEngineItemInput[];
  products: AiCrmProductRef[];
  priceRules: AiPriceRuleDoc[];
  inquiryType: string;
  typeRuleName: string;
  inquiryText: string;
  knowledgeSources?: string[];
  exampleSources?: string[];
}): PriceEngineResult {
  const warnings: string[] = [];
  const productMap = new Map<string, AiCrmProductRef>();
  for (const p of params.products) {
    productMap.set(`${p.catalogId}::${p.productId}`, p);
  }

  const dims = parseInquiryDimensions(params.inquiryText);
  const activeRules = sortRules(params.priceRules);
  const appliedLines: AiPriceExplainabilityLine[] = [];
  const resolved: PriceEngineResolvedItem[] = [];
  const usedRuleIds = new Set<string>();
  let runningBaseNet = 0;

  for (const item of params.items) {
    const product = productMap.get(`${item.catalogId}::${item.productId}`);
    const discount = Math.max(0, item.discountPercent ?? 0);

    if (product?.price != null && Number.isFinite(product.price)) {
      const unitPrice = roundMoney(product.price);
      const lineNet = roundMoney(unitPrice * item.quantity * (1 - discount / 100));
      runningBaseNet += lineNet;
      resolved.push({
        ...item,
        unitPrice,
        lineNet,
        priceSource: "catalog",
      });
      appliedLines.push({
        ruleId: `${item.catalogId}::${item.productId}`,
        ruleName: product.name,
        calculationType: "per_piece",
        expression: `${item.quantity} ${item.unit} × ${unitPrice} Kč (katalog)`,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice,
        lineNet,
        source: "catalog",
      });
      continue;
    }

    const rule = findMatchingRule(
      activeRules,
      item,
      params.inquiryType,
      params.typeRuleName,
      params.inquiryText
    );

    if (!rule) {
      warnings.push(
        `Produkt „${item.name}“ nemá cenu v CRM ani aktivní cenové pravidlo — položka byla vynechána.`
      );
      continue;
    }

    usedRuleIds.add(rule.id ?? rule.name);
    const qtyInfo = resolveQuantityForRule(rule, item, dims);
    if (!qtyInfo) {
      warnings.push(
        `Pravidlo „${rule.name}“ vyžaduje rozměry (m²), které nebyly rozpoznány — položka byla vynechána.`
      );
      continue;
    }

    const unitPrice = roundMoney(rule.value);
    let lineNet = computeLineNet(rule.calculationType, rule.value, qtyInfo.quantity, runningBaseNet);
    if (rule.calculationType !== "percentage_markup" && rule.calculationType !== "percentage_discount") {
      lineNet = roundMoney(lineNet * (1 - discount / 100));
    }
    runningBaseNet += lineNet;

    resolved.push({
      ...item,
      quantity: qtyInfo.quantity,
      unit: qtyInfo.unit,
      unitPrice,
      lineNet,
      priceSource: "price_rule",
      ruleId: rule.id,
    });

    appliedLines.push({
      ruleId: rule.id ?? rule.name,
      ruleName: rule.name,
      calculationType: rule.calculationType,
      expression: formatExpression(rule, qtyInfo.quantity, qtyInfo.unit, unitPrice, lineNet),
      quantity: qtyInfo.quantity,
      unit: qtyInfo.unit,
      unitPrice,
      lineNet,
      source: "price_rule",
    });
  }

  const addonRules = findStandaloneAddonRules(
    activeRules,
    params.inquiryType,
    params.typeRuleName,
    params.inquiryText,
    usedRuleIds
  );

  for (const rule of addonRules) {
    const syntheticItem: PriceEngineItemInput = {
      catalogId: "",
      productId: `rule:${rule.id ?? rule.name}`,
      name: rule.name,
      quantity: 1,
      unit: "ks",
      discountPercent: 0,
    };
    const qtyInfo = resolveQuantityForRule(rule, syntheticItem, dims);
    if (!qtyInfo) continue;
    const unitPrice = roundMoney(rule.value);
    const lineNet = computeLineNet(rule.calculationType, rule.value, qtyInfo.quantity, runningBaseNet);
    runningBaseNet += lineNet;
    usedRuleIds.add(rule.id ?? rule.name);
    resolved.push({
      ...syntheticItem,
      quantity: qtyInfo.quantity,
      unit: qtyInfo.unit,
      unitPrice,
      lineNet,
      priceSource: "price_rule",
      ruleId: rule.id,
    });
    appliedLines.push({
      ruleId: rule.id ?? rule.name,
      ruleName: rule.name,
      calculationType: rule.calculationType,
      expression: formatExpression(rule, qtyInfo.quantity, qtyInfo.unit, unitPrice, lineNet),
      quantity: qtyInfo.quantity,
      unit: qtyInfo.unit,
      unitPrice,
      lineNet,
      source: "price_rule",
    });
  }

  const hasBasePerM2 = appliedLines.some(
    (l) => l.source === "price_rule" && l.calculationType === "per_m2"
  );
  if (!hasBasePerM2 && dims.areaM2 != null && dims.areaM2 > 0) {
    const baseRules = findBaseInquiryPriceRules(
      activeRules,
      params.inquiryType,
      params.typeRuleName,
      usedRuleIds
    );
    for (const rule of baseRules) {
      if (rule.calculationType !== "per_m2") continue;
      const syntheticItem: PriceEngineItemInput = {
        catalogId: "",
        productId: `base-rule:${rule.id ?? rule.name}`,
        name: rule.name,
        quantity: dims.areaM2,
        unit: "m²",
        discountPercent: 0,
      };
      const qtyInfo = resolveQuantityForRule(rule, syntheticItem, dims);
      if (!qtyInfo) continue;
      const unitPrice = roundMoney(rule.value);
      const lineNet = computeLineNet(rule.calculationType, rule.value, qtyInfo.quantity, runningBaseNet);
      runningBaseNet += lineNet;
      usedRuleIds.add(rule.id ?? rule.name);
      resolved.push({
        ...syntheticItem,
        quantity: qtyInfo.quantity,
        unit: qtyInfo.unit,
        unitPrice,
        lineNet,
        priceSource: "price_rule",
        ruleId: rule.id,
      });
      appliedLines.push({
        ruleId: rule.id ?? rule.name,
        ruleName: rule.name,
        calculationType: rule.calculationType,
        expression: formatExpression(rule, qtyInfo.quantity, qtyInfo.unit, unitPrice, lineNet),
        quantity: qtyInfo.quantity,
        unit: qtyInfo.unit,
        unitPrice,
        lineNet,
        source: "price_rule",
      });
      break;
    }
  }

  return {
    items: resolved,
    explainability: {
      dimensions: dims,
      appliedLines,
      knowledgeSources: params.knowledgeSources ?? [],
      exampleSources: params.exampleSources ?? [],
    },
    warnings,
  };
}
