# Cambuz PDF Reader 1.1.0 — Windows pre-release

> **Unsigned pre-release, published as
> [`v1.1.0-rc1`](https://github.com/rajeshkamboj/cambuz-pdf/releases/tag/v1.1.0-rc1).**
> Windows is the primary target. Linux and macOS
> builds are **experimental**: they build and pass headless checks, but they have not yet
> been launched on a real desktop. Please read the limitations before you install.
> The `-rc1` suffix stays until a person completes the manual acceptance pass on real
> hardware; the installers themselves are final unless that pass finds a problem.

**Original release candidate:** commit `ac2b848` (CI: Desktop builds run 38032232208).
The published files come from commit `7dcf557` and
[CI run 38156402210](https://github.com/rajeshkamboj/cambuz-pdf/actions/runs/38156402210),
which include the installer size reduction, the official Cambuz branding and the updated
About dialog. Documentation-only commits since then do not change the application.

Application identity: name **Cambuz PDF Reader**, app ID **`com.cambuz.pdfreader`**,
publisher **Cambuz**, licence **MIT**.

## Downloads (Windows x64)

Both Windows files, the Linux AppImage and the macOS DMG/ZIP are attached to the published
pre-release: **[Cambuz PDF Reader v1.1.0-rc1](https://github.com/rajeshkamboj/cambuz-pdf/releases/tag/v1.1.0-rc1)**.

| File | Use | SHA-256 |
| --- | --- | --- |
| [`Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe`](https://github.com/rajeshkamboj/cambuz-pdf/releases/download/v1.1.0-rc1/Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe) | Installer (per-user, choose folder, Start Menu entry, `.pdf` association) | `9d39c28aa53ccc84f407e113df97c3c732c2def542c53629a43d8385f55ba365` |
| [`Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe`](https://github.com/rajeshkamboj/cambuz-pdf/releases/download/v1.1.0-rc1/Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe) | Single file, no installation | `30b5532358dd7870796477bf6296c614bbb3cd53868e44755d392e998be9a27a` |

Verify a download against
[`SHA256SUMS.txt`](https://github.com/rajeshkamboj/cambuz-pdf/releases/download/v1.1.0-rc1/SHA256SUMS.txt)
from the same release (it lists all five files). Run `Get-FileHash -Algorithm SHA256 <file>`
in PowerShell to compute yours.

**Windows will warn you.** The builds are not code-signed. SmartScreen may show
"Windows protected your PC". Choose **More info → Run anyway** only if the checksum matches.

Experimental (not recommended for general use yet): Linux x64 AppImage
(`Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage`) and macOS arm64 DMG/ZIP
(`Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg`, `.zip`) — both on the
[same release page](https://github.com/rajeshkamboj/cambuz-pdf/releases/tag/v1.1.0-rc1).
The macOS build is unsigned and not notarized.
Gatekeeper will block it until you approve it manually.

## What this release contains

- Open PDFs from the Open dialog, drag and drop, the command line, or **Open with** / double-click
  (Windows `.pdf` association).
- Continuous page view with page navigation, zoom, fit width and fit page, rotation, and a
  thumbnails and bookmarks sidebar.
- Search within the document, with next and previous results.
- Text selection and Ctrl+C copy, including Hindi and Punjabi text with valid Unicode mappings.
- Print preview and printing through the Windows print dialog.
- Page tools: rotate, delete, extract, reorder, merge and split, on a working copy.
- Form filling and saving filled forms.
- Password-protected documents, and document permissions (print, copy, forms, changes).
- Optional local OCR for scanned pages, only if you install the Tesseract engine separately.
- Bundled sample PDFs: "Try Sample PDF" and "Try Sample PDF Form".

### Copy restriction (decision recorded)

If a PDF's permissions deny copying, Cambuz **honours that flag**. Text cannot be selected, copied
(Ctrl+C, the context-menu Copy item, Cut) or dragged out of the document in Cambuz, and OCR is
disabled. Editable fields such as the search box still work. Text remains searchable inside Cambuz.

**This is a Cambuz-side policy, not DRM.** It does not stop other software from reading the file,
and it does not stop a person from retyping or photographing the page.

## Changes since the Phase 9 baseline

- macOS application menu restored (Quit, Hide, Services) and Edit copy/cut/paste roles added
  (macOS build; not yet verified in a running macOS app).
- Renderer sandbox set explicitly on the main window (no behaviour change expected).
- Copy restriction enforced for every surface, not only the page text layer.
- About dialog shows the version from the app itself, not a hard-coded string.
- CI checks the installed file version against `package.json`.

## Known limitations

- **Unsigned.** No code-signing certificate or Apple Developer ID is used.
- **Electron 44 runtime.** Installers are about 37 MiB larger than the Electron 28 builds
  (Windows setup 118.3 MiB, previously 81.6 MiB). Idle memory of the Windows app is about
  50 MiB higher in automated measurements. Both changes were accepted for this release.
- **Physical printing is not verified.** CI prepared preview PDFs but did not send a job to a printer.
- **Scanned pages need OCR.** Without the optional engine, they show as images only.
- **Broken font mappings.** Some PDFs have missing or wrong ToUnicode data. Copied text may be
  missing or wrong. Cambuz does not substitute characters.
- **Context-menu Copy stays enabled on restricted documents.** Choosing it shows the refusal
  message and copies nothing.
- **Search speed.** The first search on a 100-page document took about 52–83 ms in automated runs,
  depending on the runner. This is not a defined target.
- **Not verified:** installing and running on real hardware by a person, Windows arm64, and
  the Phase 6 device checks. See the acceptance checklist.
- **Linux and macOS are experimental.** See the README for exactly what was and was not tested.
