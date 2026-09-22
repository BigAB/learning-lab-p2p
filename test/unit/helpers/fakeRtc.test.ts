import { test } from "node:test";
import assert from "node:assert/strict";
import { CHROME_MEDIA_OFFER, FakeRTCPeerConnection, FakeRtcFactory } from "./fakeRtc";
import { FakeMediaPort } from "./fakeMedia";

test("addTransceiver switches createOffer to the media fixture and assigns mids", async () => {
  const pc = new FakeRTCPeerConnection({});
  const tx = pc.addTransceiver("video", { direction: "sendonly" });
  const rx = pc.addTransceiver("video", { direction: "recvonly" });
  assert.deepEqual([tx.mid, rx.mid], ["1", "2"]);
  assert.equal((await pc.createOffer()).sdp, CHROME_MEDIA_OFFER);
  await pc.setLocalDescription(await pc.createOffer());
  assert.equal(pc.signalingState, "have-local-offer");
});

test("setRemoteDescription(offer) creates recvonly transceivers per m=video and tracks signaling", async () => {
  const pc = new FakeRTCPeerConnection({});
  await pc.setRemoteDescription({ type: "offer", sdp: CHROME_MEDIA_OFFER });
  assert.equal(pc.signalingState, "have-remote-offer");
  assert.deepEqual(
    pc.getTransceivers().map((t) => [t.mid, t.direction]),
    [
      ["1", "recvonly"],
      ["2", "recvonly"],
    ],
  );
  await pc.setLocalDescription(await pc.createAnswer());
  assert.equal(pc.signalingState, "stable");
  // A second offer must not duplicate transceivers.
  await pc.setRemoteDescription({ type: "offer", sdp: CHROME_MEDIA_OFFER });
  assert.equal(pc.getTransceivers().length, 2);
});

test("factory exposes codecs; port hands out tracks and records calls", async () => {
  assert.ok(new FakeRtcFactory().videoCodecs().some((c) => c.mimeType === "video/H264"));
  const port = new FakeMediaPort();
  const t = await port.camera({ width: 1280, height: 720, frameRate: 15 });
  assert.equal(t.getSettings().height, 720);
  assert.deepEqual(port.cameraCalls, [{ width: 1280, height: 720, frameRate: 15 }]);
  port.rejectCamera = new Error("NotAllowedError");
  await assert.rejects(port.camera({ width: 1, height: 1, frameRate: 1 }), /NotAllowedError/);
});
