import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 30;
/** Quiet zone around the symbol, in modules (the QR spec asks for 4). */
const MARGIN = 4;

/**
 * Renders `text` as a QR code into an uncompressed Y4M (I420) clip that Chromium plays through
 * `--use-file-for-fake-video-capture`. Luma is the QR (black 16 / white 235, studio range),
 * chroma is flat grey, so the "camera" sees a crisp monochrome code filling the frame.
 */
export function writeQrY4m(text: string, path: string): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const scale = Math.floor(HEIGHT / (size + 2 * MARGIN));
  const px = size * scale;
  const x0 = Math.floor((WIDTH - px) / 2);
  const y0 = Math.floor((HEIGHT - px) / 2);

  const y = new Uint8Array(WIDTH * HEIGHT).fill(235);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) {
        const row = (y0 + r * scale + dy) * WIDTH + x0 + c * scale;
        y.fill(16, row, row + scale);
      }
    }
  }
  const chroma = new Uint8Array((WIDTH / 2) * (HEIGHT / 2)).fill(128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(path, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]));
}
