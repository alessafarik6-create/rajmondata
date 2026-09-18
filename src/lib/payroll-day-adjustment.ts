/**
 * Parsování ruční korekce započteného času (minuty, může být záporné).
 */

export type PayrollAdjustmentDirection = "add" | "subtract";

export type ParseAdjustmentResult =
  | { ok: true; minutes: number }
  | { ok: false; error: string };

function parseNonNegativeInt(raw: string, label: string): number | null {
  const t = raw.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/**
 * Hodiny: celé kladné číslo (volitelně s + na začátku).
 * Minuty: 0–59.
 * Znaménko určuje `direction`, ne text v poli hodin.
 */
export function parsePayrollAdjustmentMinutes(
  hoursRaw: string,
  minutesRaw: string,
  direction: PayrollAdjustmentDirection
): ParseAdjustmentResult {
  let hoursStr = hoursRaw.trim().replace(",", ".");
  if (hoursStr.startsWith("+")) hoursStr = hoursStr.slice(1).trim();
  if (hoursStr.startsWith("-")) {
    return { ok: false, error: "Znaménko zadejte volbou Přidat / Odebrat, ne do pole hodin." };
  }

  let hoursNum = 0;
  if (hoursStr !== "") {
    const parsed = parseFloat(hoursStr);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: "Neplatné hodiny." };
    }
    hoursNum = Math.floor(parsed);
  }

  const minutesNum = parseNonNegativeInt(minutesRaw, "minuty");
  if (minutesNum === null || minutesNum > 59) {
    return { ok: false, error: "Minuty musí být celé číslo 0–59." };
  }

  const total = hoursNum * 60 + minutesNum;
  const signed = direction === "subtract" ? -total : total;
  return { ok: true, minutes: signed };
}

export function directionAndFieldsFromAdjustmentMinutes(totalMin: number): {
  direction: PayrollAdjustmentDirection;
  hours: string;
  minutes: string;
} {
  const abs = Math.abs(Math.round(totalMin));
  return {
    direction: totalMin < 0 ? "subtract" : "add",
    hours: String(Math.floor(abs / 60)),
    minutes: String(abs % 60),
  };
}
