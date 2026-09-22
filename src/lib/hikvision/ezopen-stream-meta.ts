/** Parsování ezopen URL a bezpečný sub-stream fallback (bez logování tokenů). */

export type EzopenStreamProfile = "main" | "sub" | "unknown";

export type ParsedEzopenUrl = {
  protocol: "ezopen";
  host: string;
  deviceSerial: string;
  channelNo: string;
  streamSuffix: string;
  streamProfile: EzopenStreamProfile;
};

export type StreamCodecHint = "H264" | "H265" | "unknown";

export function parseEzopenLiveUrl(url: string): ParsedEzopenUrl | null {
  const raw = String(url ?? "").trim();
  const m = raw.match(/^ezopen:\/\/([^/]+)\/([^/]+)\/([^/.]+)\.(.+)$/i);
  if (!m) return null;
  const host = m[1];
  const deviceSerial = m[2];
  const channelNo = m[3];
  const streamSuffix = m[4];
  const lower = streamSuffix.toLowerCase();
  let streamProfile: EzopenStreamProfile = "unknown";
  if (lower.includes("hd") || lower.includes("main")) streamProfile = "main";
  else if (lower === "live" || lower.includes("sub")) streamProfile = "sub";
  return {
    protocol: "ezopen",
    host,
    deviceSerial,
    channelNo,
    streamSuffix,
    streamProfile,
  };
}

/** Jednorázový fallback main → sub (typicky .hd.live → .live). */
export function ezopenSubStreamFallbackUrl(mainUrl: string): string | null {
  const raw = String(mainUrl ?? "").trim();
  if (!raw) return null;
  if (/\.hd\.live$/i.test(raw)) {
    return raw.replace(/\.hd\.live$/i, ".live");
  }
  const parsed = parseEzopenLiveUrl(raw);
  if (!parsed) return null;
  if (parsed.streamProfile === "main" && /\.live$/i.test(raw) && !/\.hd\./i.test(raw)) {
    return null;
  }
  if (parsed.channelNo === "1" && raw.includes("/1.")) {
    const alt = raw.replace("/1.", "/2.");
    if (alt !== raw) return alt;
  }
  return null;
}

export function codecHintFromRecordSetting(row: Record<string, unknown> | null | undefined): StreamCodecHint {
  if (!row) return "unknown";
  const keys = [
    "videoEncodingType",
    "videoCodecType",
    "encodeType",
    "codecType",
    "videoCodec",
  ];
  for (const k of keys) {
    const v = String(row[k] ?? "").toUpperCase();
    if (!v) continue;
    if (v.includes("265") || v.includes("HEVC")) return "H265";
    if (v.includes("264") || v.includes("AVC")) return "H264";
  }
  const nested = row.streamInfo ?? row.videoInfo ?? row.mainStream;
  if (nested && typeof nested === "object") {
    return codecHintFromRecordSetting(nested as Record<string, unknown>);
  }
  return "unknown";
}

export function maskDeviceSerial(serial: string): string {
  const s = String(serial ?? "").trim();
  if (s.length <= 4) return "***";
  return `***${s.slice(-4)}`;
}
