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
  │  4. CI BUILDS + TESTS on main                                       │
  │     • Regression tests                                              │
  │     • Windows x64: build → try optional SignPath signing            │
  │       → smoke test installer, installed app, portable               │
  │     • Linux x64: build → headless smoke test                        │
  │     • macOS arm64: build → optional Developer ID signing            │
  │       and notarization when credentials are configured               │
  └──────────────────────┬───────────────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  5. RELEASE JOB validates and publishes                             │
  │     • Verifies all five installers and generates checksums           │
  │     • Reports signing status; unsigned builds are allowed            │
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
passes the tests, platform builds, smoke checks and release-asset validation
publishes a new pinned pre-release automatically. The tag is
`v<package.json version>-build.<GitHub run number>`.

### Code-signing is optional

Windows and macOS signing are attempted only when their credentials are
configured. Missing credentials, a rejected SignPath application, or an
unsuccessful optional SignPath request does **not** block publication: the
workflow retains and publishes the tested unsigned binaries, reports their
status, and generates SHA-256 checksums. Unsigned downloads can show Windows
SmartScreen or macOS Gatekeeper warnings. Signing improves publisher
identification and platform trust; it is not a release prerequisite.

See [CODE-SIGNING.md](CODE-SIGNING.md) for optional signing setup and behavior.

### Every release must pass all automated tests

The pipeline enforces these quality gates before any binary is published:

| Gate | Where | What is tested |
|---|---|---|
| **Regression tests** | `npm test` on Linux | ~1,257 assertions covering rendering, search, forms, page tools, security, copy restriction, OCR UI, text selection, context menus, landing content, and release automation |
| **Packaged contents** | `check-packaged-app.mjs` | `app.asar` payload ≤ 8 MiB, no leaked dev files, allowlisted dependencies only |
| **Windows smoke tests** | Three runs (unpacked, installed, portable) | Open PDF, search, sidebar, close, reopen second PDF; silent install + Start Menu + `.pdf` association + uninstall |
| **Linux smoke test** | Xvfb (headless) | Same as unpacked Windows smoke test |
| **macOS build checks** | macOS runner | Packaged contents, Info.plist document types and app icon; signature/notarization status is recorded when configured |
| **Signature status** | Build and release jobs | Signing markers and release notes report signed/unsigned status; unsigned binaries do not block publication |

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

## Optional GitHub repository secrets and variables

None of these values are required to build and publish an unsigned release.
Configure them only if signing or automatic landing-site notifications are desired.

| Name | Type | Platform | Purpose |
|---|---|---|---|
| `SIGNPATH_API_TOKEN` | Secret | Windows | SignPath CI user token (free for open source) |
| `SIGNPATH_ORGANIZATION_ID` | Variable | Windows | SignPath organization ID |
| `SIGNPATH_PROJECT_SLUG` | Variable | Windows | SignPath project slug |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Variable | Windows | SignPath signing policy slug |
| `MAC_CSC_LINK` | Secret | macOS | Base64-encoded `.p12` Developer ID certificate |
| `MAC_CSC_KEY_PASSWORD` | Secret | macOS | `.p12` password |
| `APPLE_ID` | Secret | macOS | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Secret | macOS | App-specific password |
| `APPLE_TEAM_ID` | Secret | macOS | Apple Developer Team ID |
| `CAMBUZ_LANDING_DISPATCH_TOKEN` | Secret | Landing site | Fine-grained PAT for `rajeshkamboj/cambuz-landing` |

Windows signing may be available through [SignPath Foundation](https://signpath.org/).
macOS Developer ID signing and notarization require the Apple Developer Program ($99/yr).

See [CODE-SIGNING.md](CODE-SIGNING.md) for optional signing setup.

---

## What happens when a release is blocked

Signing status alone cannot block a release. A release can still be blocked by
failed tests or platform builds, failed smoke checks, or missing/invalid release
assets. The per-platform build artifacts remain available as **CI artifacts**
(valid for 30 days) on the workflow run page. When those checks pass, unsigned
binaries are published normally and linked from the README with checksum guidance.