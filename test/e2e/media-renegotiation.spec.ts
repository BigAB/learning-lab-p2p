import { expect, test } from "@playwright/test";

/**
 * Spec §4.4 guard: the Phase 1 remote description is rebuilt from the compact QR payload; the
 * media offer must be accepted by the engine as a continuation of it. Runs in Chromium and WebKit.
 */
test("media transceivers negotiate on top of a codec-built DataChannel session", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const codec = window.__labCodec!;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: true });
      st.getTracks().forEach((t) => t.stop());
    } catch {
      /* Chromium's fake device path does not need it */
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
    const roundtrip = async (sdp: string, role: "offer" | "answer") =>
      codec.buildSdp(
        await codec.decodeWire(await codec.encodeWire(codec.extractPayload(sdp, role, "7"))),
      );

    // Phase 1: student (a) offers a DataChannel through the compact codec; teacher (b) answers.
    const a = new RTCPeerConnection({ iceServers: [] });
    a.createDataChannel("lab");
    await a.setLocalDescription(await a.createOffer());
    await gather(a);
    const b = new RTCPeerConnection({ iceServers: [] });
    await b.setRemoteDescription({
      type: "offer",
      sdp: await roundtrip(a.localDescription!.sdp, "offer"),
    });
    await b.setLocalDescription(await b.createAnswer());
    await gather(b);
    await a.setRemoteDescription({
      type: "answer",
      sdp: await roundtrip(b.localDescription!.sdp, "answer"),
    });

    // Phase 2: the teacher offers two video transceivers with a full SDP.
    b.addTransceiver("video", { direction: "sendonly" });
    b.addTransceiver("video", { direction: "recvonly" });
    await b.setLocalDescription(await b.createOffer());
    await a.setRemoteDescription({ type: "offer", sdp: b.localDescription!.sdp });

    // MediaLink.onOffer identifies transceivers by mid, not index: real engines must hand back a
    // non-null mid for every transceiver right after setRemoteDescription(offer).
    const aMids = a.getTransceivers().map((t) => t.mid);

    // Inline the same mid → direction parsing as src/core/media.ts's offeredDirections (this runs
    // in the page, which cannot import from src/core), then flip the transceiver the way
    // MediaLink does: the one whose mid was offered recvonly is where we send.
    type OfferedDirection = "sendonly" | "recvonly" | "sendrecv" | "inactive";
    const offeredDirections = (sdp: string): Map<string, OfferedDirection> => {
      const out = new Map<string, OfferedDirection>();
      const sections = sdp.split(/\r?\n(?=m=)/).slice(1);
      for (const sec of sections) {
        const lines = sec.split(/\r?\n/);
        const mid = lines
          .find((l) => l.startsWith("a=mid:"))
          ?.slice(6)
          .trim();
        const dir = lines
          .find((l) => /^a=(sendonly|recvonly|sendrecv|inactive)\s*$/.test(l))
          ?.slice(2)
          .trim();
        if (mid && dir) out.set(mid, dir as OfferedDirection);
      }
      return out;
    };
    const dirs = offeredDirections(b.localDescription!.sdp);
    const toFlip = a
      .getTransceivers()
      .find((t) => t.mid !== null && dirs.get(t.mid) === "recvonly");
    if (!toFlip)
      throw new Error(`no transceiver whose mid maps to recvonly; mids=${aMids.join(",")}`);
    toFlip.direction = "sendonly"; // offered recvonly → we send

    await a.setLocalDescription(await a.createAnswer());
    await b.setRemoteDescription({ type: "answer", sdp: a.localDescription!.sdp });

    const currentDirs = (pc: RTCPeerConnection) =>
      pc.getTransceivers().map((t) => t.currentDirection);
    const out = {
      aCount: a.getTransceivers().length,
      bCount: b.getTransceivers().length,
      aState: a.signalingState,
      bState: b.signalingState,
      aMids,
      aDirs: currentDirs(a),
      bDirs: currentDirs(b),
      bundle: /^a=group:BUNDLE \S+ \S+ \S+/m.test(b.localDescription!.sdp),
    };
    a.close();
    b.close();
    return out;
  });
  expect(r.aCount).toBe(2);
  expect(r.bCount).toBe(2);
  expect(r.aState).toBe("stable");
  expect(r.bState).toBe("stable");
  expect(r.aMids.every((m) => m !== null)).toBe(true);
  expect(r.bDirs).toEqual(["sendonly", "recvonly"]);
  expect(r.aDirs).toEqual(["recvonly", "sendonly"]);
  expect(r.bundle).toBe(true);
});
