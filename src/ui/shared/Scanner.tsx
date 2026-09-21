import { useEffect, useRef } from "react";
import jsQR from "jsqr";

/**
 * How long a rejected code stays suppressed before it is offered again. The frame loop runs at
 * ~60 fps and a courier holds the phone still, so clearing the de-dupe outright would re-decode
 * the same bad QR every frame and fire a toast per frame.
 */
const RETRY_AFTER_MS = 2000;

export function Scanner({
  onWire,
  deviceId,
  onError,
  resetKey,
}: {
  onWire: (wire: string) => void;
  deviceId?: string;
  onError?: (e: Error) => void;
  /** Change this to re-offer the last decoded value, so the same QR can be scanned again. */
  resetKey?: string | number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Kept in refs (not the effect closure) so a resetKey change schedules a retry without
  // restarting the camera, which would flash the preview and re-prompt on some browsers.
  const lastRef = useRef("");
  const retryAtRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    retryAtRef.current = Date.now() + RETRY_AFTER_MS;
  }, [resetKey]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let raf = 0;
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
        if (stop) return;
        if (text && text !== lastRef.current) {
          lastRef.current = text;
          retryAtRef.current = undefined; // a pending retry was for the previous code
          onWire(text);
        } else if (text && retryAtRef.current !== undefined && Date.now() >= retryAtRef.current) {
          retryAtRef.current = undefined; // one retry per resetKey bump
          onWire(text);
        }
      }
      raf = requestAnimationFrame(() => void loop());
    };

    (async () => {
      const s = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
      });
      if (stop) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = s;
      try {
        await video.play();
      } catch (e) {
        if (stop) return; // fast unmount aborts play(); that's not a real error
        throw e;
      }
      if (stop) return;
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
