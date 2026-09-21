/** Jednoduché čtení tagů z ISAPI XML odpovědí (bez externí závislosti). */
export function xmlTagText(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = xml.match(re);
  if (!m?.[1]) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim();
}

export function xmlBlocks(xml: string, blockTag: string): string[] {
  const re = new RegExp(`<${blockTag}[^>]*>([\\s\\S]*?)<\\/${blockTag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

export function xmlBool(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "online";
}
