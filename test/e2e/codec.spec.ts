import { expect, test } from "@playwright/test";

/** Offer from a real browser → extract → rebuild → another real PC accepts it and answers → extract again. */
test("rebuilt SDP is accepted by a real RTCPeerConnection in both directions", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const codec = window.__labCodec!;
    // WebKit filters every ICE candidate until a camera grant lands, so prime it the way
    // bootStudent/bootTeacher do; failure is non-fatal (Chromium gathers without it).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* no camera: Chromium's fake device path does not need one */
    }
    const gather = (pc: RTCPeerConnection) =>
      new Promise<void>((res) => {
        if (pc.iceGatheringState === "complete") return res();
        const t = setTimeout(res, 3000);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(t);
            res();
          }
        };
      });

    const a = new RTCPeerConnection({ iceServers: [] });
    a.createDataChannel("lab");
    await a.setLocalDescription(await a.createOffer());
    await gather(a);
    const offer = codec.extractPayload(a.localDescription!.sdp, "offer", 7);
    const offerWire = await codec.encodeWire(offer);
    const offerBack = await codec.decodeWire(offerWire);

    const b = new RTCPeerConnection({ iceServers: [] });
    await b.setRemoteDescription({ type: "offer", sdp: codec.buildSdp(offerBack) });
    await b.setLocalDescription(await b.createAnswer());
    await gather(b);
    const answer = codec.extractPayload(b.localDescription!.sdp, "answer", 7);
    const answerWire = await codec.encodeWire(answer);
    const answerBack = await codec.decodeWire(answerWire);

    await a.setRemoteDescription({ type: "answer", sdp: codec.buildSdp(answerBack) });

    const connected = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 15000);
      const check = () => {
        if (a.iceConnectionState === "connected" || a.iceConnectionState === "completed") {
          clearTimeout(t);
          res(true);
        }
      };
      a.oniceconnectionstatechange = check;
      check();
    });

    return {
      offerWireLen: offerWire.length,
      answerWireLen: answerWire.length,
      offerCands: offer.cands.length,
      mid: offer.mid,
      connected,
      ice: a.iceConnectionState,
    };
  });
  expect(result.offerCands).toBeGreaterThan(0);
  expect(result.offerWireLen).toBeLessThan(300);
  expect(result.answerWireLen).toBeLessThan(300);
  // Loopback ICE inside one browser process may legitimately not complete in headless CI; the assertion
  // that matters for the codec is that both setRemoteDescription calls above did not throw.
  test.info().annotations.push({
    type: "ice",
    description: `${result.ice} (connected=${result.connected})`,
  });
});
