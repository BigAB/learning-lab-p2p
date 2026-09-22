import { useEffect, useRef, type VideoHTMLAttributes } from "react";

type Props = { track: MediaStreamTrack } & Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  "ref" | "muted" | "autoPlay" | "playsInline"
>;

/** A muted, inline, autoplaying <video> bound to one track. The only place a MediaStream is built. */
export function VideoView({ track, ...rest }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = new MediaStream([track]);
    return () => {
      v.srcObject = null;
    };
  }, [track]);
  return <video ref={ref} muted autoPlay playsInline {...rest} />;
}
