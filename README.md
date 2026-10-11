<p align="center">
  <img src="assets/icon-master.png" alt="Cambuz PDF Reader icon" width="96" height="96" />
</p>

<h1 align="center">Cambuz PDF Reader</h1>

<p align="center">
  <strong>PDF reading without the bloat.</strong><br/>
  Read. Search. Print. Done.
</p>

<p align="center">
  <a href="https://github.com/rajeshkamboj/cambuz-pdf/actions/workflows/desktop-build.yml"><img src="https://github.com/rajeshkamboj/cambuz-pdf/actions/workflows/desktop-build.yml/badge.svg?branch=main" alt="Desktop builds status (main)" /></a>
  <img src="https://img.shields.io/badge/version-1.1.0--pre--release-informational" alt="Version 1.1.0 pre-release" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Windows%20x64-primary-0078D6" alt="Windows x64 (primary target)" />
  <img src="https://img.shields.io/badge/Linux%20x64-experimental-orange" alt="Linux x64 (experimental)" />
  <img src="https://img.shields.io/badge/macOS%20arm64-experimental-orange" alt="macOS arm64 (experimental)" />
</p>

<p align="center">
  Cambuz is a free, open-source desktop PDF reader that does the essentials and nothing else:<br/>
  open a PDF, read it comfortably, search the whole document, select and copy text,<br/>
  print exactly what you preview — plus page tools, form filling and optional local OCR.<br/>
  No accounts, no ads, no telemetry. Windows 10/11 x64 is the primary target and is verified by
  automated packaged-app tests in CI; Linux x64 and macOS (Apple Silicon) builds are
  <strong>experimental</strong>.
</p>

## ⬇️ Download Cambuz

> **How downloads work right now:** version **1.1.0** is a **pre-release candidate**.
> **No GitHub Release has been published yet**, so the installers below come from a
> successful **GitHub Actions run** — they are *CI build artifacts*. Downloading them
> requires a signed-in GitHub account, and artifacts are retained for **30 days**
> (this set expires around **9 November 2026**). Once manual acceptance passes, these
> will move to a tagged GitHub Release with permanent download links.

Every file is built from commit `fe73e6f` (installer size reduction, on top of the official
Cambuz branding and the updated About dialog) in
[CI run 38066446109](https://github.com/rajeshkamboj/cambuz-pdf/actions/runs/38066446109)
(all four jobs green). Artifacts are **unsigned** builds — expect SmartScreen/Gatekeeper notices.

| Platform & architecture | Artifact | Best for | Size | Download |
| --- | --- | --- | ---: | --- |
| **Windows 10/11 · x64** *(recommended)* | `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` — NSIS installer | Normal install: pick a folder, Start Menu entry, optional `.pdf` association. Per-user, no admin rights. | 97.3 MiB | [Windows CI artifact][win-dl] (contains installer, portable and `SHA256SUMS.txt`) |
| Windows 10/11 · x64 | `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | No install at all — run from Desktop, Downloads or a USB stick (it extracts itself at launch) | 96.9 MiB | [Windows CI artifact][win-dl] |
| Linux x64 *(experimental)* | `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage` | Try Cambuz on Linux; single-file AppImage | 93.0 MiB | [Linux CI artifact][linux-dl] |
| macOS 13+ · Apple Silicon *(experimental)* | `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` | Drag-to-Applications disk image; unsigned and not notarized | 106.7 MiB | [macOS CI artifact][mac-dl] |
| macOS 13+ · Apple Silicon *(experimental)* | `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | Same app bundle as a plain ZIP | 111.4 MiB | [macOS CI artifact][mac-dl] |
| Windows arm64, Intel Mac, Linux arm64 | — | Not built | — | *unavailable* |

Newer or expired links? Every push to `main` that changes application or packaging
files rebuilds all three platforms (documentation-only commits are skipped):
find the latest green run on the
[Desktop builds workflow page](https://github.com/rajeshkamboj/cambuz-pdf/actions/workflows/desktop-build.yml).

<details>
<summary><strong>SHA-256 checksums for this build</strong> (published by the CI run itself)</summary>

| File | SHA-256 |
| --- | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | *pending: copy from `SHA256SUMS.txt` in run 38066446109* |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | *pending: copy from `SHA256SUMS.txt` in run 38066446109* |
| `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage` | *pending: copy from `SHA256SUMS.txt` in run 38066446109* |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` | *pending: copy from `SHA256SUMS.txt` in run 38066446109* |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | *pending: copy from `SHA256SUMS.txt` in run 38066446109* |

Verify after download: `Get-FileHash -Algorithm SHA256 <file>` (PowerShell) or
`sha256sum -c SHA256SUMS.txt` (Linux/macOS, inside the artifact folder).
Digests are only reproducible within the run that produced them — always compare against
the `SHA256SUMS.txt` that ships inside the same artifact.

</details>

**At a glance:** version 1.1.0 (pre-release) · app ID `com.cambuz.pdfreader` · publisher
Cambuz · MIT licence with [third-party notices](THIRD-PARTY-NOTICES.md) · no telemetry ·
works fully offline after download · Electron 44 runtime (most of the installer size).

## What Cambuz does

Everything below is implemented in the downloadable build. "Verified in CI" means it was
exercised on GitHub runners against the *packaged* app — see
[DEVELOPMENT.md](DEVELOPMENT.md) for the exact evidence.

### 📖 Reading & navigation

- High-DPI PDF rendering with PDF.js (Mozilla's engine), one page at a time, with a
  go-to-page box, prev/next, Home/End and status line (page, zoom, rotation, size).
- Zoom in/out, fit page, fit width, rotation in 90° steps, full-screen mode, dark/light theme.
- Sidebar with lazily rendered page thumbnails and a collapsible document outline (bookmarks).
- Recent files with reopen-last-document.
- Open from the dialog, drag-and-drop, the command line, or double-click /
  **Open with** (a Windows `.pdf` association is registered — you stay in control of the default app).
  Launching a second PDF switches the running window instead of starting another process.
  Non-ASCII and spaced file paths are covered by CI tests.
- Two built-in samples on the welcome screen (a 10-page demo and a fillable form) — instant try, zero files.

### 🔍 Search & text

- Full-document search with on-page highlights and next/previous navigation that wraps
  across pages. Case-insensitive, Unicode-normalized substring matching
  (regex and whole-word search are not implemented).
- Mouse text selection, `Ctrl+A` on a page, and `Ctrl+C` copy through the PDF.js text layer.
- **Hindi, Punjabi and 11 more languages:** rendering, search and clipboard copy are
  covered by a 13-language test matrix (English plus Devanagari, Gurmukhi, Bengali,
  Gujarati, Tamil, Telugu, Kannada, Malayalam, Odia, Assamese, Marathi and RTL Urdu runs),
  including conjuncts and combining marks. Windows and Linux packaged runs verified Hindi
  and Punjabi text reaching the OS clipboard as Unicode. Copy quality still depends on the
  PDF's own font-to-Unicode mapping (see [limitations](#-compatibility--known-limitations)).

### 🖨️ Printing

- Print preview is rendered from the *exact* print-ready PDF that goes to the printer,
  so the preview is what you get: page selection with validated ranges, 1–99 copies,
  portrait/landscape, A4/A3/A5/Letter/Legal/Tabloid, five margin presets plus custom
  (0–50 mm), fit/actual/custom scaling, and 2-up / 4-up sheets.
- Choose one-sided or two-sided printing (flip on the long or short edge), plus
  collated or uncollated copies. Direct printing sends these choices to Electron's
  native print API; duplex requires a duplex-capable printer. In the system print
  dialog, verify the driver's two-sided and collation settings before confirming.
- Ink Saver preset: grayscale raster output (capped at 200 dpi) to save toner.
- On Windows, Cambuz lists system printers via Electron and can fall back to the native
  print dialog. Browser mode cannot set printer options: choose duplex, copies and
  collation in the browser/system dialog. The downloadable print-ready PDF contains
  the page selection and layout, **not** printer-only settings such as duplex/copies.
  Print preview, job preparation and native-option forwarding are covered by tests;
  **no physical printer output has been tested yet** — CI never sent a job to a printer.

### ✂️ Page tools

Work on an in-memory copy — your file on disk is never touched until you save:

- Rotate, delete, extract and reorder pages; duplicate the document.
- Merge other PDFs in; split into parts (`1-3; 4-6` or "every N pages").
- Save As with overwrite protection and atomic writes; up to 20 undo steps per session.
- Edit basic metadata (title, author, subject, keywords).

### 📝 Forms, passwords & permissions

- Fillable AcroForm fields (text, check boxes, radio groups, drop-downs, list boxes)
  appear as real controls on the page at any zoom; `Save Filled Form…` writes a **new**
  file and rebuilds appearance streams, so values are visible in other viewers too.
  The original is never modified.
- Password-protected PDFs open via a prompt; the password is used in memory only and is
  never stored. Encrypted documents stay read-only in Cambuz — there is deliberately no
  "remove password" action.
- The Document Security dialog lists all eight permission flags and enforces print,
  copy, change and form policies in the UI.

### 👁️ OCR for scanned pages — optional

- Scanned pages have no text layer; Cambuz renders them as images. An explicit
  **Recognize current page** action (never automatic) sends a local rasterization to a
  **Tesseract 4+ engine that you install separately** — Cambuz bundles and downloads no
  OCR engine or models, and nothing is uploaded anywhere.
- Choose up to three installed languages per run (`eng`, `hin`, `pan`, `urd`, plus nine
  more Indic language codes). Results appear in a separate selectable box labelled with
  page, language and engine version; they are *not* merged into the PDF or its search,
  and nothing is stored.
- Quality depends on your Tesseract build, models and scan quality; recognition of the
  engine itself has not yet been verified on a native desktop.

### ⚡ Offline & privacy by design

- The packaged app performs no network access by construction (audited in CI): files open
  over local IPC, and only `http(s)` links you click inside a document outline open in
  your system browser. There is no telemetry, analytics or crash reporting in the shipped
  code, and no auto-updater — updates are manual by re-downloading.
- Measured on CI runners (single observations on the Windows job, not benchmarks):
  ~260 ms from open to first rendered page on a 10-page sample; 52–83 ms for the first
  search across a 100-page document and under 1.5 ms for a cached repeat search;
  about 150–165 MiB private memory at the idle welcome screen.

## 📸 Screenshots

Real captures of the packaged Windows build, taken from the running application over the
DevTools protocol by [`scripts/capture-screenshots.mjs`](scripts/capture-screenshots.mjs)
on the `Marketing screenshots` workflow — a scripted click of the real buttons, not a
mockup. PNG masters are 2880×1800 (1440×900 at 2× device pixels, web contents only);
the files here are 2048×1280 WebP with nothing applied but crop, resize and format
conversion.

| Welcome screen | Hindi document | Print preview |
| --- | --- | --- |
| ![Welcome screen with the Open PDF, Try Sample PDF and Try Sample PDF Form buttons](assets/screenshots/welcome-screen.webp) | ![hindi-sample.pdf open at 116 % zoom with the thumbnails sidebar](assets/screenshots/feature-hindi.webp) | ![Print preview of cambuz-demo.pdf, pages 1-2, Microsoft Print to PDF selected](assets/screenshots/feature-print-preview.webp) |

[`assets/screenshots/`](assets/screenshots) holds the other seven plus `manifest.json`,
the reading view with page 1 of 10 and thumbnails, page navigation, search with its match
counter, a mouse-drag text selection, `punjabi-sample.pdf`, the same reading view in the
light theme and a clean fit-page view. The manifest records the state, sample, theme, size
and the CI run behind every file. Everything was captured with the bundled PDFs in
[`samples/`](samples); no document of anyone's own is shown.

Three further captures (the native window on a Windows desktop, with its title bar and the
taskbar) are still waiting for a machine with an interactive desktop: GitHub's Windows
runners present a 1024×768 headless session, which cannot hold the 1440×900 window. The
steps are written out in `capture-report.json` of the `marketing-screenshots` artifact.
Until then, the sample PDFs in [`samples/`](samples) let you judge the rendering with your
own copy of the app.

## Installation & quick start

### Windows (recommended: installer)

1. From the [Windows CI artifact][win-dl], unzip and keep `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe`.
   Check its SHA-256 against the table above.
2. Run it. **SmartScreen will show "Windows protected your PC"** because the build is
   unsigned — choose **More info → Run anyway** (only after the checksum matches).
3. Choose per-user install (no admin prompt) or a custom folder; you get a Start Menu
   shortcut, the MIT licence page, and a `.pdf` "Open with" registration (uninstalling removes both).
4. Or skip installing entirely: run `…-win-x64-portable.exe` from any folder.

The silent install/uninstall path, shortcuts, file association and launching are asserted
by CI on real packaged builds; the interactive wizard pages still await the
[manual acceptance checklist](docs/WINDOWS-ACCEPTANCE-CHECKLIST.md).

### Linux x64 (experimental — built and headless-tested in CI, not yet run by a person)

```bash
chmod +x Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage
./Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage
```

CI verified the AppImage's desktop entry, icons and MIME wiring, and ran the unpacked
build headless under Xvfb. It did **not** launch the AppImage itself; on hardened distros
that block user namespaces, Electron apps may need an AppArmor profile or `--no-sandbox`
(untested).

### macOS 13+ on Apple Silicon (experimental — built and inspected in CI, never launched)

1. Open `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` and drag the app to Applications.
2. The build is unsigned and not notarized, so Gatekeeper will block first launch:
   right-click the app → **Open** (or remove quarantine with
   `xattr -d com.apple.quarantine` on the app bundle).
3. There is no Intel (x64) build.

### Build and run from source

Requires Node 22 and npm (the Electron runtime downloads on first run):

```bash
npm ci
npm test            # full regression suite (~1,080 assertions, ~30 s)
npm start           # desktop app
npm run build:win   # or build:linux / build:mac — packaging details in DEVELOPMENT.md
```

## 🧯 Compatibility & known limitations

Honest status of the current build — details and evidence in
[DEVELOPMENT.md](DEVELOPMENT.md) and the [1.1.0 pre-release notes](docs/RELEASE-NOTES-1.1.0.md).

| Area | Where things stand |
| --- | --- |
| Release maturity | 1.1.0 is an unsigned **pre-release candidate**. Automated acceptance passed on CI runners; a person has not yet run the manual acceptance on real hardware, and that gates a public release. |
| Unsigned builds | No code-signing certificate or Apple notarization exists yet. Windows SmartScreen and macOS Gatekeeper warnings are expected, not defects; signing is the documented next step. |
| Linux / macOS validation | Headless/CI-only. The Linux app passed 32/32 packaged checks under Xvfb; the macOS app was built and content-checked but **never launched**. Neither has a human on native hardware yet. |
| Text extraction fidelity | Some PDFs ship missing or broken ToUnicode mappings or `/ActualText`; text copied from those files may be wrong or empty. Cambuz renders and searches what the file encodes and never substitutes characters. |
| Scanned PDFs | Render as images only. Selectable/searchable text requires the optional local Tesseract OCR (not bundled). |
| Copy-restricted PDFs | If the document's permissions deny copying, Cambuz **honours it** app-wide (no selection, Ctrl+C, cut or drag-out; OCR disabled) and says so — while search still works. This is a Cambuz-side courtesy, **not DRM**: other software may ignore the same flags. |
| Printing | Preview, job preparation and native duplex/collation option forwarding are tested; **physical printer output is untested**. Printer capabilities and per-printer non-printable margins are not queried (duplex may be unavailable; edge clipping possible with `None` margins). System dialogs/drivers may override settings. Filled form values do not appear in print — save the filled copy and print that. |
| Search | Substring, case-insensitive, NFC-normalized; no regex, whole-word or diacritic-insensitive modes. |
| Forms | AcroForm basics only: XFA/dynamic forms, signature fields and JavaScript-driven fields are shown read-only, never guessed. |
| Size & memory | The artifacts linked above are **93–111 MiB** (Windows setup 97.3 MiB, Windows portable 96.9 MiB, AppImage 93.0 MiB, DMG 106.7 MiB, ZIP 111.4 MiB), down from 118–130 MiB after trimming unused Chromium locales, SwiftShader and app payload (the Cambuz payload is now 5.7 MiB); the rest is the Electron 44 runtime. See [installer size reduction](DEVELOPMENT.md#installer-size-reduction). Idle memory measured roughly 150–165 MiB across CI runs on the Windows runner. |
| OS floors | Windows 10+ x64, macOS 13+ (arm64), modern x64 Linux. Electron 44 dropped Windows 7/8, 32-bit and macOS 12. |
| No auto-updates | Re-download a new build manually; there is no update service to run in the background. |

## 🔒 Privacy & security

- **Your files stay yours.** No uploads, no cloud, no account. The app opens local PDFs
  and renders them offline (code-audited: the packaged app contains no remote fetches).
- **No telemetry, analytics or crash reporting** — none exists in the shipped code.
- **Hardened Electron shell:** renderer runs with `sandbox: true`, context isolation on and
  Node integration off; page navigation away from the viewer is blocked, new windows are
  denied except `http(s)` outline links handed to your browser; OS permissions are denied
  except the Fullscreen API the reader itself uses.
- **Passwords** for protected PDFs are held in memory for that document only — never
  logged, cached or written to disk. Encrypted PDFs are never decrypted to disk or
  re-saved unprotected.
- These measures reduce risk; they are **not an absolute security guarantee**. Malformed
  or hostile PDFs remain a risk surface of any PDF reader — open files you trust.
- Licence: **MIT** ([LICENSE](LICENSE)), with bundled components listed in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (Electron, PDF.js, pdf-lib and friends).
- **Bugs, crashes, feature requests:** [open an issue](https://github.com/rajeshkamboj/cambuz-pdf/issues)
  — include the version from Help → About, your OS, and steps. This repository's issues are
  the only official support channel.

## ❓ FAQ

**Is Cambuz free?**
Yes — MIT-licensed, source open in this repository, no paid tiers, no ads, no upsell screens.

**Does it work offline?**
Yes. Everything (open, read, search, copy, print, page tools, form filling, OCR if you
installed Tesseract) runs with no network. Only links you explicitly click in a document
outline open your browser.

**Which platforms are supported?**
Windows 10/11 x64 is the primary, CI-verified target. Linux x64 (AppImage) and macOS 13+
(Apple Silicon) builds exist but are experimental — built and automated-checked in CI, not
yet validated by a person on real desktops. No Windows arm64, Intel-Mac or Linux arm64 builds.

**Do I have to install on Windows?**
No. The portable `.exe` runs from any folder. The installer just adds a Start Menu entry,
an uninstaller and a `.pdf` "Open with" registration (removal is clean — verified in CI).

**Does it handle Hindi and Punjabi PDFs?**
Yes — rendering, full-text search and copy-to-clipboard for Hindi and Punjabi are covered
by automated tests across the 13-language matrix, including Windows-clipboard round-trips in
packaged CI runs. If a particular file's fonts have broken Unicode mappings, copied text
from it may still be wrong; that is in the file, not the reader.

**Does it include OCR?**
Optional local OCR only. If a Tesseract 4+ executable is on your PATH, you can OCR the
current page explicitly (up to 3 languages, results in a separate box). Cambuz does not
bundle, download or auto-run Tesseract, and scanned PDFs stay image-only without it.

**Why is copied text sometimes wrong or missing?**
PDF text extraction can only recover what the file encodes. Older or badly exported PDFs
sometimes lack a proper ToUnicode map for Indic scripts or ligatures. Options: run OCR on
the page (with your own Tesseract), or improve the export settings in the application that
produced the PDF.

**Why does Windows or macOS warn about the build?**
The builds are unsigned (no certificate) and, on macOS, not notarized. SmartScreen and
Gatekeeper show their standard unknown-publisher warnings. The source and CI pipeline are
public — verify the SHA-256 of what you download, then proceed if it matches.

**Can I edit my PDFs?**
Page-level only: rotate, delete, extract, reorder, merge, split, save-as, duplicate and
basic metadata, all on a working copy. Filling and saving forms works too. There is no
content editing, annotation authoring or XFA/signature support.

**Where do I report a bug?**
[GitHub issues](https://github.com/rajeshkamboj/cambuz-pdf/issues). Download problems? State
which CI run you used and whether the checksums matched.

## 🛠 For developers

The phase-by-phase development record, CI evidence tables, performance methodology and
packaging internals live in **[DEVELOPMENT.md](DEVELOPMENT.md)**. Also useful:
[1.1.0 pre-release notes](docs/RELEASE-NOTES-1.1.0.md) ·
[Windows acceptance checklist](docs/WINDOWS-ACCEPTANCE-CHECKLIST.md) ·
[build workflow](.github/workflows/desktop-build.yml) · sample PDFs in [`samples/`](samples).

```bash
npm ci && npm test    # regression suite (Node only; no display needed)
npm start             # run from source (Electron)
npm run serve         # browser preview of the renderer (development only)
```

Contributions are welcome — please open an issue first for anything beyond a small fix,
and keep changes covered by `npm test`. No new release or signing automation is produced
by this documentation; publishing is a maintainer decision tracked in DEVELOPMENT.md.

## 🧭 About Us

Cambuz PDF Reader is developed by **Rajesh Singh** under the PixlDot brand, with a focus on making PDF reading simple, fast, and accessible.

Official website: [pixldot.com](https://pixldot.com/)

## 📄 License & project links

Cambuz PDF Reader is released under the [MIT License](LICENSE) — Copyright © 2026 Cambuz —
with bundled third-party components listed with full license texts in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

- Source code: [github.com/rajeshkamboj/cambuz-pdf](https://github.com/rajeshkamboj/cambuz-pdf)
- Bug reports and feature requests: [GitHub issues](https://github.com/rajeshkamboj/cambuz-pdf/issues)
- Automated builds: [Desktop builds workflow](https://github.com/rajeshkamboj/cambuz-pdf/actions/workflows/desktop-build.yml)
- Developer documentation: [DEVELOPMENT.md](DEVELOPMENT.md) ·
  [1.1.0 pre-release notes](docs/RELEASE-NOTES-1.1.0.md) ·
  [Windows acceptance checklist](docs/WINDOWS-ACCEPTANCE-CHECKLIST.md)

[win-dl]: https://github.com/rajeshkamboj/cambuz-pdf/actions/runs/38066446109/artifacts/11674263933
[linux-dl]: https://github.com/rajeshkamboj/cambuz-pdf/actions/runs/38066446109/artifacts/11674794491
[mac-dl]: https://github.com/rajeshkamboj/cambuz-pdf/actions/runs/38066446109/artifacts/11675445206
