import { describe, expect, it } from "vitest";
import {
  listEzopenSubStreamCandidates,
  parseRecordSettingStreams,
  pickWebLiveEzopenStream,
} from "./ezopen-stream-meta";

describe("ezopen sub stream candidates", () => {
  it("maps hd.live to live sub suffix", () => {
    const url = "ezopen://open.ezvizlife.com/ABC123/101.hd.live";
    const candidates = listEzopenSubStreamCandidates(url);
    expect(candidates.some((u) => u.endsWith(".live") && !u.includes(".hd."))).toBe(true);
  });

  it("offers 102 when channel is 101", () => {
    const url = "ezopen://open.ezvizlife.com/ABC123/101.hd.live";
    const candidates = listEzopenSubStreamCandidates(url);
    expect(candidates.some((u) => u.includes("/102."))).toBe(true);
  });
});

describe("pickWebLiveEzopenStream", () => {
  const openapiUrl = "ezopen://open.ezvizlife.com/DEV/101.hd.live";

  it("prefers H264 sub over H265 main", () => {
    const pick = pickWebLiveEzopenStream({
      openapiUrl,
      streams: {
        main: { codec: "H265", width: 2688, height: 1520, fps: 25, bitrateKbps: 4096 },
        sub: { codec: "H264", width: 640, height: 360, fps: 15, bitrateKbps: 512 },
      },
      requestedVariant: "sub",
    });
    expect(pick.codecHint).toBe("H264");
    expect(pick.streamVariant).toBe("sub");
    expect(pick.ezopenUrl).not.toContain(".hd.");
  });

  it("warns when both streams are H265", () => {
    const pick = pickWebLiveEzopenStream({
      openapiUrl,
      streams: {
        main: { codec: "H265", width: 2688, height: 1520, fps: 25, bitrateKbps: 4096 },
        sub: { codec: "H265", width: 640, height: 360, fps: 15, bitrateKbps: 512 },
      },
    });
    expect(pick.codecHint).toBe("H265");
    expect(pick.webLiveWarning).toMatch(/H\.264/i);
  });
});

describe("parseRecordSettingStreams", () => {
  it("reads nested subStream codec", () => {
    const streams = parseRecordSettingStreams({
      videoEncodingType: "H.265",
      videoWidth: 2688,
      videoHeight: 1520,
      frameRate: 25,
      subStream: {
        videoCodecType: "H.264",
        videoWidth: 640,
        videoHeight: 360,
        frameRate: 15,
      },
    });
    expect(streams.main.codec).toBe("H265");
    expect(streams.sub?.codec).toBe("H264");
    expect(streams.sub?.width).toBe(640);
  });
});
