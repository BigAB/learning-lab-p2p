import type { RtcFactory } from "../../core/ports";
export const browserRtc: RtcFactory = {
  create: (config) => new RTCPeerConnection(config),
  videoCodecs: () => RTCRtpReceiver.getCapabilities("video")?.codecs ?? [],
};
