# Learning Lab P2P

Serverless WebRTC between one teacher MacBook and any number of fixed iPads, signaled by QR codes carried on a phone. Static site on GitHub Pages.

- Design: `docs/superpowers/specs/2026-09-20-p2p-core-design.md`
- Design amendment (string IDs, dynamic roster): `docs/superpowers/specs/2026-09-21-variable-workstation-ids-design.md`
- Agent/contributor rules: `AGENTS.md`
- Lab day checklist: `docs/lab-checklist.md`

## Routes

`/student?ws=ID` · `/teacher` · `/courier` · `/dev/load`

## Develop

```
pnpm install
pnpm dev
pnpm test        # unit
pnpm test:e2e    # playwright (pnpm exec playwright install --with-deps chromium webkit once)
```

## Deploy

Push to `main`. Pages workflow sets `VITE_BASE=/<repo>/` and bakes the short SHA into the UI as the app version.

## License

UNLICENSED
