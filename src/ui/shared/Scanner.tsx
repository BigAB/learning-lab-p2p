import { useEffect, useRef } from "react";
import jsQR from "jsqr";

export function Scanner({
  onWire,
  deviceId,
  onError,
}: {
  onWire: (wire: string) => void;
  deviceId?: string;
  onError?: (e: Error) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let raf = 0;
    let last = "";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const detector =
      typeof BarcodeDetector !== "undefined" ? new BarcodeDetector({ formats: ["qr_code"] }) : null;

    const loop = async () => {
      if (stop) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        let text: string | undefined;
        try {
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue;
          } else if (ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height)?.data;
          }
        } catch {
          /* a bad frame is not an error */
        }
        if (text && text !== last) {
          last = text;
          onWire(text);
        }
      }
      raf = requestAnimationFrame(() => void loop());
    };

    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
      });
      video.srcObject = stream;
      await video.play();
      void loop();
    })().catch((e: unknown) => onError?.(e as Error));

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId, onWire, onError]);
  return <video ref={videoRef} className="scanner" playsInline muted />;
}
