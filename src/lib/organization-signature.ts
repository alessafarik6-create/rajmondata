export type OrganizationSignature = {
  url: string;
  storagePath: string;
  updatedAt: unknown;
  updatedBy: string;
  /** Volitelné jméno osoby, která podpis uložila (zobrazí se v razítku). */
  signedByName?: string | null;
  contentType: "image/png";
};

export function isPngDataUrl(s: string): boolean {
  return /^data:image\/png;base64,[a-z0-9+/=\s]+$/i.test(s.trim());
}

export function decodePngDataUrlToBuffer(dataUrl: string): Buffer {
  const trimmed = dataUrl.trim();
  const idx = trimmed.indexOf(",");
  if (idx < 0) throw new Error("Neplatný data URL.");
  const b64 = trimmed.slice(idx + 1).trim();
  return Buffer.from(b64, "base64");
}

