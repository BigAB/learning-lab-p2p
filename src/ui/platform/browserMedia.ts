import type { MediaPort } from "../../core/ports";

/** Camera and screen capture. contentHint steers the encoder: motion for faces, detail for text. */
export const browserMedia: MediaPort = {
  async camera(c) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: c.width },
        height: { ideal: c.height },
        frameRate: { ideal: c.frameRate },
      },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("camera returned no video track");
    track.contentHint = "motion";
    return track;
  },
  async screen() {
    // Must run inside a user gesture; LabController calls this before its first await.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getAudioTracks().forEach((t) => t.stop());
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("screen share returned no video track");
    track.contentHint = "detail";
    return track;
  },
};
