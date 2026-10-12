# Cambuz PDF Reader — Release Policy

> This document defines the end-to-end release pipeline for Cambuz PDF Reader.
> Every change that reaches `main` follows this path automatically.

---

## The pipeline at a glance

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  1. DEVELOPER writes feature on a branch                            │
  │     npm test  →  all assertions pass                                │
  │     commit & push to branch                                         │
  └──────────────────────┬───────────────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  2. CI VALIDATES the branch (pull request)                          │
  │     • Regression tests (Linux)                                      │
  │     • Windows build + packaged smoke test                           │
  │     • Linux AppImage build + headless smoke test                    │
  │     • macOS build                                                   │
  │     → All four jobs must pass before merge is allowed               │
  └──────────────────────┬───────────────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  3. MERGE to main                                                  │
  │     (either via PR merge or direct push)                            │
  └──────────────────────┬───────────────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  4. CI BUILDS + SIGNS + TESTS on main                               │
  │     • Regression tests                                              │
  │     • Windows x64: build → sign with Authenticode → verify          │
  │       → smoke test installer, installed app, portable               │
  │     • Linux x64: build → headless smoke test                        │
  │     • macOS arm64: build → sign with Developer ID → notarize        │
  │       → verify signature and stapling                                │
  └──────────────────────┬───────────────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  5. RELEASE JOB gates on signing                                    │
  │     • Checks SIGNED.txt from Windows and macOS builds               │
  │     • BLOCKS release if either platform is unsigned                  │
  │     • Creates/updates pinned GitHub Release                          │
  │       tag: v<version>-build.<run_number>                             │
  │     • Syncs README.md download links (badges, table, checksums)     │
  │     • Dispatches cambuz-release-published to cambuz-landing          │
  └──────────────────────┬───────────────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  6. DOWNLOAD LINKS are updated                                      │
  │     • README.md on github.com/rajeshkamboj/cambuz-pdf               │
  │     • cambuz.pixldot.com (via repository_dispatch)                   │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## Rules

### Every merge to `main` produces a release

There is no manual "release" button. Every successful push to `main` that
passes all five CI jobs (tests + three platform builds + release) publishes a
new pinned pre-release automatically. The tag is
`v<package.json version>-build.<GitHub run number>`.

### Every release must be code-signed

The release job checks that Windows and macOS binaries carry a valid
code-signature. If signing is not configured or the signature is missing, the
release is **blocked** — no unsigned build will ever be published from `main`.

See [CODE-SIGNING.md](CODE-SIGNING.md) for the exact secrets and setup.

### Every release must pass all automated tests

The pipeline enforces these quality gates before any binary is published:

| Gate | Where | What is tested |
|---|---|---|
| **Regression tests** | `npm test` on Linux | ~1,257 assertions covering rendering, search, forms, page tools, security, copy restriction, OCR UI, text selection, context menus, landing content, and release automation |
| **Packaged contents** | `check-packaged-app.mjs` | `app.asar` payload ≤ 8 MiB, no leaked dev files, allowlisted dependencies only |
| **Windows smoke tests** | Three runs (unpacked, installed, portable) | Open PDF, search, sidebar, close, reopen second PDF; silent install + Start Menu + `.pdf` association + uninstall |
| **Linux smoke test** | Xvfb (headless) | Same as unpacked Windows smoke test |
| **macOS build checks** | macOS runner | `codesign --verify`, `spctl --assess`, notarization stapling, Info.plist document types, app icon |
| **Signature enforcement** | Release job | `SIGNED.txt` must say `signed` for both Windows and macOS |

### `README.md` stays in sync automatically

After every release, the CI workflow rewrites the three `<!-- release-sync:… -->`
sections in `README.md` with the exact download links, checksums, and badge
URLs for the new release. This is committed directly to `main` by the
`github-actions[bot]` (the `paths-ignore: '**.md'` trigger prevents a loop).

### `cambuz-landing` is notified automatically

After the README is synced, the workflow dispatches a
`cambuz-release-published` event to `rajeshkamboj/cambuz-landing` via a
fine-grained PAT stored in `CAMBUZ_LANDING_DISPATCH_TOKEN`. The landing site
picks up the new release and updates its download links.

---

## Branching model

- **`main`** — the only branch that produces releases. All feature work happens
  on branches and is merged via pull request.
- **`arena/*`** — Arena agent branches for feature development.
- **Feature branches** — any name; opened as PRs against `main`.

---

## Version numbering

The current version in `package.json` is `1.1.0`. Automatic main builds produce
tags like `v1.1.0-build.53`. When the project is ready for a stable release:

1. Update `version` in `package.json` (e.g. `1.2.0`).
2. Push to `main` — CI produces `v1.2.0-build.<N>`.
3. Optionally, push a `v1.2.0` tag to create a non-prerelease GitHub Release
   (the workflow supports both automatic main builds and manual tag pushes).

---

## Required GitHub repository secrets

| Secret | Purpose |
|---|---|
| `WIN_CSC_LINK` | Base64-encoded Windows `.pfx` code-signing certificate |
| `WIN_CSC_KEY_PASSWORD` | Password for the `.pfx` file |
| `MAC_CSC_LINK` | Base64-encoded macOS `.p12` Developer ID certificate |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `CAMBUZ_LANDING_DISPATCH_TOKEN` | Fine-grained PAT for `rajeshkamboj/cambuz-landing` |

See [CODE-SIGNING.md](CODE-SIGNING.md) for step-by-step setup.

---

## What happens when a release is blocked

If the release job fails because code-signing secrets are not configured, the
build artifacts are still available as **CI artifacts** (valid for 30 days) on
the workflow run page. These artifacts are unsigned and intended for testing
only — they are never published as a GitHub Release and never linked from the
README.