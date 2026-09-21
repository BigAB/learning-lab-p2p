/** Obtain camera permission so WebRTC emits real host IPs instead of mDNS names. Stream is stopped at once. */
export async function primeCameraPermission(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
