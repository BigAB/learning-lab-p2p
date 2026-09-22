# Lab checklist

Run before the first lab day of a semester and after any app deploy, iPad OS update, or network change.

## 0. Prerequisites
- [ ] Every iPad: Home Screen web app installed at `/student?ws=<ID>`, Single App Mode on, Auto-Lock Never, plugged in. IDs are free text (letters, digits, space, - and _; case does not matter). The teacher keeps them unique.
- [ ] Every iPad: Settings → Safari → Camera → Allow for the Pages origin.
- [ ] Teacher Mac: Chrome, `/teacher` open, external camera selected in Scan modal.
- [ ] Teacher Mac: **macOS Firewall allows incoming connections for Chrome** (System Settings → Network → Firewall), or the firewall is off on the lab network. Host ICE candidates carry the Mac's LAN IP and the firewall silently drops the inbound STUN connectivity checks, so tiles sit in `connecting` forever with no error. This is the same reason the e2e suite has to pass `--allow-loopback-in-peer-connection` to Chromium.
- [ ] MDM web clip URL includes `?ws=<ID>` (`https://<pages-host>/<base>/student?ws=7`). Without it a fresh iPad asks for the workstation ID on first launch (type it once; it is remembered; tap "change" in the status bar to fix a typo — but if the typo is in the MDM web-clip URL itself, fix the clip too: the installed app relaunches with its URL and will otherwise ask "Which workstation is this?" on every launch.); a *wrong* value shows a visible notice instead of silently using the saved ID.
- [ ] If adding by hand from Safari: open `/student?ws=<ID>` first, then "Add to Home Screen". The installed app has its own storage, so the ID must come from the URL or be typed once inside the app.
- [ ] Phone with `/courier` open; screen brightness up.
- [ ] Teacher header and every iPad status bar show the **same `appVersion`**.
- [ ] Teacher Mac on **Ethernet** if the room has a port (30 video streams in and out cross one access point otherwise). Note the AP model.

## 1. Network sanity (do this first)
- [ ] Pair one station only. If it never leaves `connecting`, the LAN is blocking P2P UDP (client isolation / AP isolation) — or the teacher Mac's firewall is on (§0). Stop and talk to IT; nothing else will work.
- [ ] Confirm the offer carries real LAN IPs. If the iPad shows "only mDNS candidates found — camera permission missing, cannot pair", the origin lost its camera grant: fix §0's Safari camera setting and reload. The app refuses `.local`-only offers rather than pairing into a dead connection.

## 2. Full pairing
- [ ] Pair all stations following the Re-pair queue order. Record time per station (target < 45 s).
- [ ] Dashboard: every station green, RTT < 20 ms.

## 3. Resilience
- [ ] Toggle WiFi off on one iPad for ~10 s → tile amber → back to green without re-pair.
- [ ] Toggle WiFi off on one iPad for ~90 s → tile red → iPad shows new offer QR → re-pair succeeds.
- [ ] Reload teacher tab → all tiles red → Re-pair queue lists every station from the previous run → pair three, confirm green.
- [ ] After that reload, give the iPads up to ~75 s (15 s degraded + 60 s failed) to notice and show fresh offer QRs. They are not dead before then — wait it out rather than walking the room.
- [ ] Force-quit the Home Screen app on one iPad, relaunch → new offer, re-pair succeeds.
- [ ] Send `cmd: reload` from a tile drawer → iPad reloads and shows offer.

## 3b. Media
- [ ] Teacher: **Cameras on** → every green tile shows video within 10 s. Any tile reading "no video (older build)" is a stale Home Screen app: reload that iPad.
- [ ] Click one thumbnail → focus pane shows a readable face; `[data-focus-stats]` reads ≥ 360p.
- [ ] **Share screen** → every iPad shows it; text on a terminal window is legible. **Stop sharing** → every iPad back to Ready.
- [ ] **Share camera** → every iPad shows the teacher. Header shows "⚠ N CPU-limited" only transiently; if it stays > 0, note N and the Mac's Activity Monitor CPU.
- [ ] Cameras off → every iPad's "● Camera on" pill disappears.

## 4. Soak
- [ ] Leave every station connected overnight. Next morning: count greens, note any `status.visibility: hidden` or wake-lock-lost events in tile drawers.
- [ ] Takeover: pair a station, then pair a second iPad under the same ID → one tile, "↺ replaced" badge, first iPad shows a fresh offer. Remove it from the drawer → tile gone; re-pair → tile back.
- [ ] Cameras on for two hours. Note any tile that goes to "camera error" (thermal) and whether the Mac's fans came on.

## 5. Sign-off
Date · appVersion · greens after soak · notes.
