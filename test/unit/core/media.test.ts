import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPTURE,
  applyEncoding,
  encodingFor,
  offeredDirections,
  orderCodecs,
  scaleFor,
} from "../../../src/core/media";

const OFFER = readFileSync(
  new URL("../../fixtures/sdp/chrome-media-offer.sdp", import.meta.url),
  "utf8",
);

test("capture is 720p15", () => {
  assert.deepEqual(CAPTURE, { width: 1280, height: 720, frameRate: 15 });
});

test("scaleFor divides the capture height by the target and never upscales", () => {
  assert.equal(scaleFor(720, 180), 4);
  assert.equal(scaleFor(720, 360), 2);
  assert.equal(scaleFor(720, 720), 1);
  assert.equal(scaleFor(480, 720), 1);
  assert.equal(scaleFor(undefined, 180), 1);
  assert.equal(scaleFor(0, 180), 1);
});

test("encodingFor maps a profile to sender encoding parameters", () => {
  assert.deepEqual(encodingFor({ height: 180, fps: 10, kbps: 150 }, 720), {
    scaleResolutionDownBy: 4,
    maxFramerate: 10,
    maxBitrate: 150_000,
  });
});

const codecs: RTCRtpCodec[] = [
  { mimeType: "video/VP8", clockRate: 90000 },
  { mimeType: "video/rtx", clockRate: 90000, sdpFmtpLine: "apt=96" },
  {
    mimeType: "video/H264",
    clockRate: 90000,
    sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
  },
  {
    mimeType: "video/H264",
    clockRate: 90000,
    sdpFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
  },
  { mimeType: "video/VP9", clockRate: 90000 },
];

test("orderCodecs puts the preferred codec first, packetization-mode=1 H264 first of all", () => {
  const h = orderCodecs(codecs, "h264").map((c) => c.sdpFmtpLine ?? c.mimeType);
  assert.equal(h[0], "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f");
  assert.equal(h[1], "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f");
  assert.deepEqual(h.slice(2), ["video/VP8", "apt=96", "video/VP9"]);
  assert.equal(orderCodecs(codecs, "vp8")[0]?.mimeType, "video/VP8");
  assert.deepEqual(orderCodecs(codecs, "auto"), codecs);
  assert.equal(orderCodecs(codecs, "h264").length, codecs.length);
});

test("orderCodecs leaves the list alone when the preferred codec is absent", () => {
  const noH264 = codecs.filter((c) => c.mimeType !== "video/H264");
  assert.deepEqual(orderCodecs(noH264, "h264"), noH264);
});

test("offeredDirections reads mid → direction for every m= section", () => {
  const d = offeredDirections(OFFER);
  assert.equal(d.get("1"), "sendonly");
  assert.equal(d.get("2"), "recvonly");
  assert.equal(d.has("0"), false);
  assert.equal(offeredDirections("v=0\r\na=sendonly\r\n").size, 0);
});

test("applyEncoding merges into encodings[0] and sets degradationPreference", async () => {
  const calls: RTCRtpSendParameters[] = [];
  const sender = {
    getParameters: () => ({
      encodings: [{ active: true }],
      transactionId: "t",
      codecs: [],
      headerExtensions: [],
      rtcp: {},
    }),
    setParameters: async (p: RTCRtpSendParameters) => {
      calls.push(p);
    },
  } as unknown as RTCRtpSender;
  await applyEncoding(sender, { maxFramerate: 5 }, "maintain-resolution");
  assert.deepEqual(calls[0]?.encodings, [{ active: true, maxFramerate: 5 }]);
  assert.equal(
    (calls[0] as { degradationPreference?: string }).degradationPreference,
    "maintain-resolution",
  );
  const empty = {
    getParameters: () => ({
      encodings: [],
      transactionId: "t",
      codecs: [],
      headerExtensions: [],
      rtcp: {},
    }),
    setParameters: async (p: RTCRtpSendParameters) => {
      calls.push(p);
    },
  } as unknown as RTCRtpSender;
  await applyEncoding(empty, { maxBitrate: 1 });
  assert.deepEqual(calls[1]?.encodings, [{ maxBitrate: 1 }]);
});
