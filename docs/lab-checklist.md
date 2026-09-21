# Lab checklist

Run before the first lab day of a semester and after any app deploy, iPad OS update, or network change.

## 0. Prerequisites
- [ ] Every iPad: Home Screen web app installed at `/student?ws=N`, Single App Mode on, Auto-Lock Never, plugged in.
- [ ] Every iPad: Settings → Safari → Camera → Allow for the Pages origin.
- [ ] Teacher Mac: Chrome, `/teacher` open, external camera selected in Scan modal.
- [ ] Phone with `/courier` open; screen brightness up.
- [ ] Teacher header and every iPad status bar show the **same `appVersion`**.

## 1. Network sanity (do this first)
- [ ] Pair ws 1 only. If it never leaves `connecting`, the LAN is blocking P2P UDP (client isolation / AP isolation). Stop and talk to IT; nothing else will work.

## 2. Full pairing
- [ ] Pair all stations following the Re-pair queue order. Record time per station (target < 45 s).
- [ ] Dashboard: 30 green, RTT < 20 ms.

## 3. Resilience
- [ ] Toggle WiFi off on one iPad for ~10 s → tile amber → back to green without re-pair.
- [ ] Toggle WiFi off on one iPad for ~90 s → tile red → iPad shows new offer QR → re-pair succeeds.
- [ ] Reload teacher tab → all tiles red → Re-pair queue lists 1..30 → pair three, confirm green.
- [ ] Force-quit the Home Screen app on one iPad, relaunch → new offer, re-pair succeeds.
- [ ] Send `cmd: reload` from a tile drawer → iPad reloads and shows offer.

## 4. Soak
- [ ] Leave all 30 connected overnight. Next morning: count greens, note any `status.visibility: hidden` or wake-lock-lost events in tile drawers.

## 5. Sign-off
Date · appVersion · greens after soak · notes.
