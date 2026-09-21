# Lab checklist

Run before the first lab day of a semester and after any app deploy, iPad OS update, or network change.

## 0. Prerequisites
- [ ] Every iPad: Home Screen web app installed at `/student?ws=N`, Single App Mode on, Auto-Lock Never, plugged in.
- [ ] Every iPad: Settings → Safari → Camera → Allow for the Pages origin.
- [ ] Teacher Mac: Chrome, `/teacher` open, external camera selected in Scan modal.
- [ ] Teacher Mac: **macOS Firewall allows incoming connections for Chrome** (System Settings → Network → Firewall), or the firewall is off on the lab network. Host ICE candidates carry the Mac's LAN IP and the firewall silently drops the inbound STUN connectivity checks, so tiles sit in `connecting` forever with no error. This is the same reason the e2e suite has to pass `--allow-loopback-in-peer-connection` to Chromium.
- [ ] MDM web clip URL includes `?ws=N` (`https://<pages-host>/<base>/student?ws=7`). Without it a fresh iPad has nothing to resolve a workstation from; a *wrong* value now shows a visible notice instead of silently using the saved number.
- [ ] Phone with `/courier` open; screen brightness up.
- [ ] Teacher header and every iPad status bar show the **same `appVersion`**.

## 1. Network sanity (do this first)
- [ ] Pair ws 1 only. If it never leaves `connecting`, the LAN is blocking P2P UDP (client isolation / AP isolation) — or the teacher Mac's firewall is on (§0). Stop and talk to IT; nothing else will work.
- [ ] Confirm the offer carries real LAN IPs. If the iPad shows "only mDNS candidates found — camera permission missing, cannot pair", the origin lost its camera grant: fix §0's Safari camera setting and reload. The app refuses `.local`-only offers rather than pairing into a dead connection.

## 2. Full pairing
- [ ] Pair all stations following the Re-pair queue order. Record time per station (target < 45 s).
- [ ] Dashboard: 30 green, RTT < 20 ms.

## 3. Resilience
- [ ] Toggle WiFi off on one iPad for ~10 s → tile amber → back to green without re-pair.
- [ ] Toggle WiFi off on one iPad for ~90 s → tile red → iPad shows new offer QR → re-pair succeeds.
- [ ] Reload teacher tab → all tiles red → Re-pair queue lists 1..30 → pair three, confirm green.
- [ ] After that reload, give the iPads up to ~75 s (15 s degraded + 60 s failed) to notice and show fresh offer QRs. They are not dead before then — wait it out rather than walking the room.
- [ ] Force-quit the Home Screen app on one iPad, relaunch → new offer, re-pair succeeds.
- [ ] Send `cmd: reload` from a tile drawer → iPad reloads and shows offer.

## 4. Soak
- [ ] Leave all 30 connected overnight. Next morning: count greens, note any `status.visibility: hidden` or wake-lock-lost events in tile drawers.

## 5. Sign-off
Date · appVersion · greens after soak · notes.
