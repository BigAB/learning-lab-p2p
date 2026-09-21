import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export function QrView({
  wire,
  role,
  ws,
  size = 480,
}: {
  wire: string;
  role: "offer" | "answer";
  ws: number;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, wire, { errorCorrectionLevel: "M", width: size, margin: 2 });
  }, [wire, size]);
  return (
    <canvas
      ref={ref}
      className="qr"
      data-payload={wire}
      data-role={role}
      data-ws={ws}
      aria-label={`${role} code for workstation ${ws}`}
    />
  );
}
