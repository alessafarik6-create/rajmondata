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

export type StreamTrackMeta = {
  codec: StreamCodecHint;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
};

export type RecordSettingStreams = {
  main: StreamTrackMeta;
  sub: StreamTrackMeta | null;
};

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

function readNumeric(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function readCodecFromRow(row: Record<string, unknown>): StreamCodecHint {
  const keys = [
    "videoEncodingType",
    "videoCodecType",
    "encodeType",
    "codecType",
    "videoCodec",
    "encodingType",
  ];
  for (const k of keys) {
    const v = String(row[k] ?? "").toUpperCase();
    if (!v) continue;
    if (v.includes("265") || v.includes("HEVC")) return "H265";
    if (v.includes("264") || v.includes("AVC")) return "H264";
  }
  return "unknown";
}

function streamMetaFromRow(row: Record<string, unknown> | null | undefined): StreamTrackMeta {
  if (!row || typeof row !== "object") {
    return { codec: "unknown", width: null, height: null, fps: null, bitrateKbps: null };
  }
  const width =
    readNumeric(row, ["videoWidth", "width", "resolutionWidth"]) ??
    (() => {
      const res = String(row.resolution ?? row.videoResolution ?? "").match(/(\d+)\s*[x×*]\s*(\d+)/i);
      return res ? Number(res[1]) : null;
    })();
  const height =
    readNumeric(row, ["videoHeight", "height", "resolutionHeight"]) ??
    (() => {
      const res = String(row.resolution ?? row.videoResolution ?? "").match(/(\d+)\s*[x×*]\s*(\d+)/i);
      return res ? Number(res[2]) : null;
    })();
  const fps =
    readNumeric(row, ["frameRate", "fps", "videoFrameRate", "maxFrameRate"]) ?? null;
  const bitrateRaw =
    readNumeric(row, ["bitrate", "videoBitrate", "constantBitRate", "maxBitrate"]) ?? null;
  const bitrateKbps =
    bitrateRaw != null ? (bitrateRaw > 10_000 ? Math.round(bitrateRaw / 1000) : bitrateRaw) : null;
  return {
    codec: readCodecFromRow(row),
    width,
    height,
    fps,
    bitrateKbps,
  };
}

/** Extrahuje main/sub metadata z řádku recordsettings/get (OpenAPI). */
export function parseRecordSettingStreams(
  row: Record<string, unknown> | null | undefined
): RecordSettingStreams {
  if (!row) {
    return { main: streamMetaFromRow(null), sub: null };
  }
  let subRow: Record<string, unknown> | null = null;
  for (const key of ["subStream", "substream", "SubStream", "sub", "extraStream"]) {
    const nested = row[key];
    if (nested && typeof nested === "object") {
      subRow = nested as Record<string, unknown>;
      break;
    }
  }
  const mainRow =
    (row.mainStream && typeof row.mainStream === "object"
      ? (row.mainStream as Record<string, unknown>)
      : null) ??
    (row.streamInfo && typeof row.streamInfo === "object"
      ? (row.streamInfo as Record<string, unknown>)
      : null) ??
    row;
  const main = streamMetaFromRow(mainRow);
  const sub = subRow ? streamMetaFromRow(subRow) : null;
  if (sub && sub.codec === "unknown" && sub.width == null && sub.height == null) {
    const hint = codecHintFromRecordSetting(row, "sub");
    if (hint !== "unknown") {
      return { main, sub: { ...sub, codec: hint } };
    }
  }
  return { main, sub };
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

/** Kandidátní sub-stream URL (bez duplicit, pořadí priority). */
export function listEzopenSubStreamCandidates(baseUrl: string): string[] {
  const raw = String(baseUrl ?? "").trim();
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    const u = String(url ?? "").trim();
    if (!u || u === raw || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  push(ezopenSubStreamFallbackUrl(raw));
  if (/\.hd\.live$/i.test(raw)) push(raw.replace(/\.hd\.live$/i, ".live"));
  if (/\.hd\./i.test(raw)) push(raw.replace(/\.hd\./gi, "."));

  const parsed = parseEzopenLiveUrl(raw);
  if (parsed) {
    const ch = parsed.channelNo;
    if (/^\d+$/.test(ch)) {
      const n = parseInt(ch, 10);
      if (n % 100 === 1) {
        push(raw.replace(`/${ch}.`, `/${n + 1}.`));
        if (/\.hd\.live$/i.test(raw)) {
          push(raw.replace(`/${ch}.`, `/${n + 1}.`).replace(/\.hd\.live$/i, ".live"));
        }
      }
      if (n > 0 && n < 100) {
        push(raw.replace(`/${ch}.`, `/${n * 100 + 1}.`));
        push(raw.replace(`/${ch}.`, `/${n * 100 + 2}.`));
        if (/\.hd\.live$/i.test(raw)) {
          push(raw.replace(`/${ch}.`, `/${n * 100 + 2}.`).replace(/\.hd\.live$/i, ".live"));
        }
      }
    }
    if (raw.includes("/1.")) push(raw.replace("/1.", "/2."));
  }

  return out;
}

export type WebLiveStreamPick = {
  ezopenUrl: string;
  streamVariant: "main" | "sub";
  codecHint: StreamCodecHint;
  selectionReason: string;
  subCandidateIndex: number;
  webLiveWarning?: string | null;
};

/** Vybere ezopen URL vhodné pro web (priorita H.264 substream). */
export function pickWebLiveEzopenStream(input: {
  openapiUrl: string;
  streams: RecordSettingStreams;
  requestedVariant?: "main" | "sub";
  subCandidateIndex?: number;
}): WebLiveStreamPick {
  const openapiUrl = String(input.openapiUrl ?? "").trim();
  const streams = input.streams;
  const requested = input.requestedVariant ?? "sub";
  const subIdx = Math.max(0, input.subCandidateIndex ?? 0);
  const subCandidates = listEzopenSubStreamCandidates(openapiUrl);
  const mainCodec = streams.main.codec;
  const subCodec = streams.sub?.codec ?? "unknown";

  if (requested === "main") {
    if (mainCodec === "H265") {
      return {
        ezopenUrl: openapiUrl,
        streamVariant: "main",
        codecHint: "H265",
        selectionReason: "explicit_main_h265",
        subCandidateIndex: 0,
        webLiveWarning:
          "Main stream používá H.265 — webový přehrávač nemusí zobrazit obraz. Zvolte substream H.264.",
      };
    }
    return {
      ezopenUrl: openapiUrl,
      streamVariant: "main",
      codecHint: mainCodec,
      selectionReason: "explicit_main",
      subCandidateIndex: 0,
    };
  }

  if (subCodec === "H264" || subCodec === "unknown") {
    const url = subCandidates[subIdx] ?? subCandidates[0] ?? ezopenSubStreamFallbackUrl(openapiUrl) ?? openapiUrl;
    const parsed = parseEzopenLiveUrl(url);
    const profile = parsed?.streamProfile;
    return {
      ezopenUrl: url,
      streamVariant: profile === "main" ? "main" : "sub",
      codecHint: subCodec === "unknown" ? "H264" : "H264",
      selectionReason:
        subIdx > 0 ? `h264_sub_candidate_${subIdx}` : "h264_sub_preferred",
      subCandidateIndex: subIdx,
    };
  }

  if (mainCodec === "H264") {
    return {
      ezopenUrl: openapiUrl,
      streamVariant: "main",
      codecHint: "H264",
      selectionReason: "sub_h265_fallback_main_h264",
      subCandidateIndex: 0,
    };
  }

  const url = subCandidates[subIdx] ?? subCandidates[0] ?? openapiUrl;
  return {
    ezopenUrl: url,
    streamVariant: "sub",
    codecHint: "H265",
    selectionReason: subIdx > 0 ? `sub_candidate_${subIdx}_both_h265` : "both_streams_h265",
    subCandidateIndex: subIdx,
    webLiveWarning:
      "Webový live náhled vyžaduje kompatibilní H.264 stream. Kamera/NVR aktuálně používá H.265 na main i sub streamu.",
  };
}

export function codecHintFromRecordSetting(
  row: Record<string, unknown> | null | undefined,
  variant: "main" | "sub" = "main"
): StreamCodecHint {
  if (!row) return "unknown";
  if (variant === "sub") {
    for (const key of ["subStream", "substream", "SubStream", "sub"]) {
      const nested = row[key];
      if (nested && typeof nested === "object") {
        const hint = codecHintFromRecordSetting(nested as Record<string, unknown>, "main");
        if (hint !== "unknown") return hint;
      }
    }
  }
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
  const nested =
    variant === "sub"
      ? (row.subStreamInfo ?? row.substreamInfo ?? row.streamInfo ?? row.videoInfo)
      : (row.streamInfo ?? row.videoInfo ?? row.mainStream);
  if (nested && typeof nested === "object") {
    return codecHintFromRecordSetting(nested as Record<string, unknown>, "main");
  }
  return "unknown";
}

export function maskDeviceSerial(serial: string): string {
  const s = String(serial ?? "").trim();
  if (s.length <= 4) return "***";
  return `***${s.slice(-4)}`;
}

export function formatStreamTrackMeta(meta: StreamTrackMeta): string {
  const parts: string[] = [];
  parts.push(meta.codec === "unknown" ? "?" : meta.codec);
  if (meta.width && meta.height) parts.push(`${meta.width}x${meta.height}`);
  if (meta.fps) parts.push(`${meta.fps} fps`);
  if (meta.bitrateKbps) parts.push(`${meta.bitrateKbps} kbps`);
  return parts.join(" · ");
}
