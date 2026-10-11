# Cambuz PDF Reader — Development Notes & History

> **Looking for the product page and downloads? See [README.md](README.md).**
> This document preserves the phase-by-phase development record that previously
> filled the root README: implementation status per phase, CI evidence, benchmark
> tables, packaging internals, test methodology and historical blocker lists.
> The content below was moved verbatim on 2026-10-10; where a statement was later
> superseded, the Phase 10 section marks it.

**Current state (verified 2026-10-10; Phase 11 added later on branch
`arena/887f6050-cambuz-pdf` and is not part of that verification).** All ten
development phases are complete; Phase 11 (continuous scroll and reader
navigation, above) is the newest work.
The Phase 10 release candidate `ac2b848` has since been merged into `main` (PR #11,
merge commit `a0a95b2`); the "not merged into main" notes inside the Phase 9 and
Phase 10 reports describe the state at their time of writing. **No GitHub Release
has been published.** Builds are unsigned, and manual hardware acceptance and
physical printing remain open (see
[`docs/WINDOWS-ACCEPTANCE-CHECKLIST.md`](docs/WINDOWS-ACCEPTANCE-CHECKLIST.md)).
Current distributions are CI build artifacts linked from the
[README download section](README.md#-download-cambuz).

---

## Phase 11 — Continuous scroll, reader navigation and a reading-feature audit

### Phase 11 Status: `IMPLEMENTED — HEADLESS VERIFIED, HUMAN PASS PENDING`

Branch `arena/887f6050-cambuz-pdf`. Single-page rendering and every existing
feature are preserved; the change adds the one standard reading mode the viewer
never had, plus the navigation around it.

| Requirement | Implementation |
|---|---|
| Continuous vertical scroll | ✅ `src/continuous-layout.js` (DOM-free geometry) + `src/continuous-view.js` (slots, render window, release) drive a `#pdf-column` of absolutely positioned page slots |
| Lazy rendering in a long document | ✅ Only pages intersecting the viewport (±1) hold a slot; canvases outside the window are released (backing store zeroed) and re-rendered on return |
| Page sizes known before a page is rendered | ✅ One `getPage` per page caches the unrotated size; unmeasured pages borrow the median measured height, and the background measurement pass replaces estimates nearest-the-reader first |
| Correct scroll height and no scroll jumps | ✅ Column height follows the geometry; measuring a page above the reading line re-anchors `scrollTop` by the height delta |
| Zoom / fit / rotation in continuous mode | ✅ `relayout()` rebuilds the geometry from the cached base sizes and keeps the reader on the same page (and the same offset into it) |
| UI follows the scroll position | ✅ Toolbar page box, prev/next state, status line, sidebar active thumbnail, recents last-page and form overlay all follow the page under the reading line |
| Search in continuous mode | ✅ Highlights apply per rendered slot; `SearchController.applyHighlights({ page, textLayerEl })` and `clearMarks(el)` are now addressable, and a new optional `onMarksChanged` dep keeps every live slot in step with the query |
| Copy permission in continuous mode | ✅ `no-copy` is applied to every column text layer, including slots created later |
| Layout choice | ✅ Toolbar **Scroll/Page** button, **View → Continuous Scroll / Single Page** (`Ctrl+Shift+M`), persisted in `localStorage` as `cambuz.viewMode` |
| Wheel / Space / PageUp-Down reading | ✅ `scrollStep()` scrolls a screen and turns the page at the end; single-page wheel gestures turn pages with a 320 ms / 40 px throttle |
| Case-sensitive search | ✅ The engine already supported `matchCase`; the search bar now exposes it (`setMatchCase()` re-runs the query) |
| Sidebar re-fit | ✅ Opening/closing the sidebar re-measures fit-page/fit-width in both modes |
| Tests | ✅ `scripts/test-phase11.mjs` — 110 assertions (geometry, view behaviour with a fake renderer, the real app in jsdom, case-sensitive search); wired into `npm test` |

**Default layout: single page.** Continuous mode is opt-in and remembered. The
packaged smoke test and the earlier jsdom suites therefore keep asserting the
same single-page behaviour they always did. Flipping the default is a one-line
change: `DEFAULT_VIEW_MODE = 'continuous'` in `src/renderer.js`.

**Evidence.** `npm test` passes with 1,257 assertions on this branch (Phase 11
adds 110). The sandbox has no Electron runtime and no display, so continuous
mode was verified headlessly (geometry tests, `ContinuousView` against a fake
renderer, and the real renderer in jsdom: switch modes on the ten-page sample,
jump to a page, scroll across a page boundary, watch the page box and status
line follow, switch back) — **no human has scrolled it in the packaged app
yet**. Re-run the packaged smoke test on Windows/Linux and do a manual scroll,
zoom and rotation pass before release.

**Superseded statements.** The two "continuous scroll still future / not yet
implemented" lines in the Phase 3 known-limitations list and the Phase 1 record
below describe their phase; Phase 11 implements continuous scroll.

**Feature audit.** The reading feature set was compared against mainstream
readers in [`docs/FEATURE-AUDIT.md`](docs/FEATURE-AUDIT.md): what is present,
what is missing (in-document link annotations, annotation display, Open Recent
while reading, night page colours, zoom presets, page labels, spreads, …) and a
suggested order for the next three tickets.

---

## Installer size reduction

Packaging-only pass on branch `arena/4089e3cf-cambuz-pdf` (commit `fe73e6f`). PDF
rendering, search, printing, forms, security and OCR code are unchanged; the only
runtime change is that the OS regional locale is forwarded for Recents dates.

### What changed

| Change | Where | Effect |
| --- | --- | --- |
| Chromium locale packs: keep `en-US` only (the UI is English-only) | `package.json` `build.electronLanguages` | Removes ~55 `locales/*.pak` (Windows/Linux) and `*.lproj` (macOS). Chromium-provided strings (e.g. native form validation bubbles) are English. Text rendering, Indian-language shaping, search and ICU data are unaffected (`icudtl.dat` still ships). |
| Recents dates keep the user's regional format | `main.js` `additionalArguments`, `preload.js` `systemLocale`, `src/recents.js` `timeAgo(ts, locale)` | Without other locale packs the renderer default locale is `en-US`; `app.getSystemLocale()` (validated BCP 47 tag) is forwarded so dates older than 30 days still follow the OS format. |
| SwiftShader removed on Windows and Linux | `scripts/after-pack.cjs` (`build.afterPack`) | `vk_swiftshader.dll` (5.3 MiB) / `libvk_swiftshader.so` (4.4 MiB) and the ICD JSON. Chromium 152 only uses SwiftShader for WebGL behind `--enable-unsafe-swiftshader`; PDF.js draws on a 2D canvas. Without a GPU Chromium composites in software (Windows always has WARP). macOS is untouched (unsigned, never launched in CI). |
| App payload allowlist | `scripts/stage-app.mjs` `RUNTIME_PACKAGE_FILES` | `node_modules` keeps only `pdfjs-dist/build/pdf.mjs`, `pdf.worker.mjs`, `standard_fonts/` and `pdf-lib/dist/pdf-lib.esm.js` (self-contained: inlines pako, tslib, `@pdf-lib/*`), plus every package's `package.json` and licence files. PDF.js `cmaps/` are dropped because no `cMapUrl` is configured. Staging fails if an allowlisted file is missing. |
| Maximum compression; solid NSIS payload | `build.compression: "maximum"`, `nsis.differentialPackage: false` | The setup was differential-aware (1 MB dictionary, non-solid 7z) for delta auto-updates, which Cambuz does not use. AppImage now uses xz squashfs, DMG uses UDBZ. |
| Regression guard | `scripts/check-packaged-app.mjs` | Fails if the `app.asar` file data exceeds **8 MiB** or if pruned trees (`cmaps/`, pdf-lib `cjs/es/src/ts3.4`, `*.min.js`, `.d.ts`, READMEs) reappear. Verified to fail on the previous payload (19.4 MiB, 1,172 unused files). |
| Size visibility | `scripts/after-pack.cjs` | Every CI build annotates the unpacked (installed) size and the largest files per platform (`Installed size` notices). |

### Measured sizes (CI)

Before: `main` run 38052144793 (commit `703dc75`). After: run 38066446109
(commit `fe73e6f`), all four jobs green.

| File | Before | After | Change |
| --- | ---: | ---: | ---: |
| Windows installer (`-setup.exe`) | 118.8 MiB | **97.3 MiB** | −21.5 MiB (−18%) |
| Windows portable (`-portable.exe`) | 118.4 MiB | **96.9 MiB** | −21.5 MiB (−18%) |
| Linux AppImage | 125.5 MiB | **93.0 MiB** | −32.5 MiB (−26%) |
| macOS DMG | 132.7 MiB | **106.7 MiB** | −26.0 MiB (−20%) |
| macOS ZIP | 127.2 MiB | **111.4 MiB** | −15.8 MiB (−12%) |
| `app.asar` (Cambuz payload) | 17.9 MiB | **5.7 MiB** | −12.2 MiB (−68%) |
| Installed app, Windows (unpacked) | not recorded | **320.2 MiB** (17 files) | — |
| Installed app, Linux (unpacked) | not recorded | **275.2 MiB** (16 files) | — |

Largest remaining Windows files: `Cambuz PDF Reader.exe` 234.9 MiB (Electron/Chromium),
`dxcompiler.dll` 24.6 MiB, `LICENSES.chromium.html` 19.5 MiB (licence notices; must
ship), `resources.pak` 11.9 MiB, `icudtl.dat` 10.4 MiB, `app.asar` 5.7 MiB.

### Validation

- `npm test`: all suites pass (Phase 2 132, DOM 62, Phase 3 58, Phase 4 133,
  Phase 5 278, Phase 6 229, Phase 7 54 + 2 Tesseract skips, samples 19, context
  menu 12, text selection 4, main process 118, Phase 8 focused); new assertions
  cover the forwarded locale and `timeAgo` locale handling.
- CI packaged smoke tests: Windows unpacked, silently installed and portable
  35/35 each; Linux unpacked under Xvfb 32/32. macOS built only (not launched).
- The pruned payload was loaded in isolation in Node (outside the repository, so
  no fallback to the full `node_modules`): pdf-lib form read, font embed and save;
  PDF.js open and English/Hindi text extraction through the staged worker.

### Not done / follow-ups

- **`dxcompiler.dll` + `dxil.dll` (Windows, ~26 MiB installed).** The DirectX
  shader compiler used by Chromium's WebGPU/D3D12 path. Cambuz does not use
  WebGPU, but Chromium's GPU stack can use D3D12 elsewhere and the CI runner
  has no real GPU, so removal would need testing on real GPUs. Not removed.
- **AppImage launch time with xz** was not measured (the CI smoke test launches
  the unpacked build).
- **The runtime floor.** The Electron executable alone is ~235 MiB unpacked
  (~75–80 MiB compressed), so an Electron build cannot reach the size of native
  readers such as SumatraPDF. A system-WebView runtime (e.g. Tauri with WebView2
  on Windows) could reuse the HTML/JS/PDF.js front end and is the path to a
  single-digit/low-double-digit MiB installer; it would require porting the
  main-process code (`main.js`, IPC, printing, file association, OCR bridge).

---

## Final branding pass — official icon, About dialog, README landing page

Applied after the 1.1.0 release candidate (`ac2b848`). Branding, the About dialog and
the README only: no PDF rendering or other application behavior was changed.

### Icon assets (official identity)

- **Master asset.** `assets/icon-master.png` (1254×1254 RGBA PNG, transparent
  corners) is the official Cambuz icon and the single source of truth. It is kept
  byte-for-byte as supplied; it is never redrawn, recoloured or substituted.
  Regenerate the shipped derivatives with `python3 scripts/generate-icon-assets.py`
  (requires Pillow); keep transparency in every output.
- **Derivation.** `scripts/generate-icon-assets.py` (Python 3 + Pillow) only rescales
  the master, with no cropping or shape changes:
  - `assets/icon.png` — 512×512, runtime window/taskbar icon, README logo, About dialog.
  - `build/icon.png` — 512×512, electron-builder Linux icon (AppImage hicolor set).
  - `build/icon.ico` — 16/24/32/48/64/128/256 px, Windows installer, portable
    executable, Explorer/shortcut/taskbar icons.
  - `build/icon.icns` — 32–1024 px (`ic07`–`ic14`), macOS bundle, Dock and Finder.
- **Fail-clearly guarantees.** The generator exits with an explicit error when the
  master is missing or unusable (non-PNG, non-square, below 1024 px); packaging via
  `scripts/stage-app.mjs` fails when any referenced icon file is absent, and
  electron-builder itself errors on a missing icon — there is no silent fallback to a
  generic icon. The interim Phase 9 generator `scripts/create-icon.py` (which drew an
  invented mark) was removed so it can never overwrite the official artwork.

### About dialog (Application → Help → About Cambuz PDF Reader)

- Implemented as `src/about.html`, opened by `showAboutWindow()` in `main.js`. It
  displays the official icon, the product name **Cambuz PDF Reader**, the description
  “PDF reading without the bloat.”, the creator **Rajesh Singh**, a clickable official
  website **<https://pixldot.com/>**, the version of the running application (passed
  from `app.getVersion()` — never hard-coded) and `Copyright © 2026 Cambuz` (year and
  rights holder taken from `LICENSE`).
- The website opens in the user's default browser through the same window-open policy
  as the main window (http(s) → `shell.openExternal`, everything denied); it is never
  rendered inside the app. Security posture is unchanged: `sandbox: true`, context
  isolation on, Node integration off, no preload bridge, `will-navigate` denied.
  Asserted by `scripts/test-main-process.mjs`.
- The macOS application menu keeps its native About panel (`role: 'about'`); the
  Quit/Hide/Services and Edit copy/cut/paste fixes in `src/mac-menu.cjs` are untouched.

### Verification status — automated checks vs native desktop tests

Verified automatically in this pass: derived icon formats and entry sizes
(`.ico`/`.icns` containers, PNG dimensions), recognisability of the 16/24 px
silhouettes, the full regression suite including the new About dialog assertions, and
CI packaging checks (AppImage icon + desktop-entry wiring, macOS `icon.icns` presence,
Windows product/publisher/version metadata asserts).

**Not visually verified on native desktops:** how the icon appears in the Windows
taskbar/Start Menu/Explorer, the macOS Dock/Finder and Linux desktop environments; the
About dialog's rendered appearance on each OS; and the NSIS wizard's icon pages. These
remain manual acceptance items (see
[`docs/WINDOWS-ACCEPTANCE-CHECKLIST.md`](docs/WINDOWS-ACCEPTANCE-CHECKLIST.md)). A
successful build is not treated as visual verification.

---

## Phase 10 — Release quality and final readiness

### Final Windows pre-release acceptance (release candidate `ac2b848`)

**Status: Windows x64 unsigned pre-release candidate. Automated acceptance passed; manual
acceptance on real hardware is pending and gates release.** Linux and macOS builds are
**experimental**. Nothing has been published or merged into `main`.

| Item | Value |
| --- | --- |
| Branch | `arena/e73ef198-cambuz-pdf` (session branch; `main` remains `5578c73`) |
| Release-candidate commit (builds the artifacts) | `ac2b848` |
| Docs commits after the candidate | Release notes and acceptance checklist (docs only; `paths-ignore: **.md` means they do not rebuild the artifacts) |
| CI run for the candidate | [Desktop builds, run 38032232208](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208): all four jobs succeeded, every step succeeded |
| Pull request | None opened. Not published. |

**Release decisions recorded (by the maintainer):**

- App ID `com.cambuz.pdfreader`: **confirmed**; permanent once users install.
- Publisher `Cambuz`: **confirmed**.
- Signing: **unsigned pre-release accepted** (no certificate or notarization).
- PDF copy restriction: **honour the document's copy-restriction flag**, enforced on every
  surface (see below). This is a Cambuz-side policy, **not DRM**.
- Electron 44 size and memory increase: **accepted**.

**Windows evidence from the candidate (CI, packaged app on GitHub runners):**

| Check | Unpacked | Installed (silent install, then uninstall) | Portable |
| --- | --- | --- | --- |
| Packaged checks passed | 35/35 | 35/35 | 35/35 |
| Installer and uninstaller exit codes | — | 0 / 0 | — |
| `ProductName`, `FileVersion` = 1.1.0, `CompanyName` on the installed exe | — | asserted in CI | — |
| Start Menu shortcut and `.pdf` association added and removed | — | asserted in CI | — |
| Zero uncaught renderer exceptions | yes | yes | yes |

These checks cover launch with a PDF path, second-launch hand-off, both samples, drop-to-open,
text-layer alignment, navigation, zoom, print-preview preparation (**no job sent to a printer**),
selection and Ctrl+C, the Windows clipboard (including Hindi and Punjabi), copy refusal in a
copy-restricted PDF, 100-page search, scanned page with no selectable text, and three
open/render/close cycles.

**Artifacts and SHA-256 checksums** (from the candidate run's "Write SHA-256 checksums" step):

| File | Size | SHA-256 |
| --- | ---: | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | 118.3 MiB | `7bd699b57cefc7cb76d46c239db89e02a4a3641fb4b6aa12ab49654b56c0e343` |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | 118.0 MiB | `3c100ecd868cc7711d8c4370f16de7c1d3d7ed20ee2f594db9880ba1b37ab45b` |

Artifacts from run 38032232208 (retained 30 days): [`cambuz-pdf-windows-x64`](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208/artifacts/11662571692),
[`smoke-test-evidence-windows-x64`](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208/artifacts/11662321981),
[`cambuz-pdf-linux-x64`](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208/artifacts/11662201852),
[`smoke-test-evidence-linux-x64`](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208/artifacts/11662216952),
[`cambuz-pdf-macos-arm64`](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38032232208/artifacts/11662616494).

**Linux and macOS (experimental).** Linux AppImage: build passed, packaged smoke test passed 32/32
under Xvfb with `--no-sandbox` (CI only). macOS arm64 DMG/ZIP: build and contents checks passed;
the app was **never launched**. Neither has been launched by a person on a real desktop.
Native Linux and macOS use is **not verified**.

**Copy restriction, enforced on every surface (commit `ac2b848`).** Earlier builds enforced the
flag only on the page text layer. Copy, Cut and drag-out are now refused document-wide while the
document denies copying. That covers Ctrl+C, the context-menu Copy item, text in the bookmarks
panel and text selected anywhere else in the window. Editable fields (the search box) stay usable,
except when page text is also selected. Regression tests: `scripts/test-phase5.mjs` section G2
(refused on body, text layer, bookmarks, drag and cut; allowed in the focused search box) and G4
(unrestricted document still copies). Copy-restricted documents also keep OCR disabled.

**Identity and version consistency (checked in this pass):**

| Item | Value | Where it is set or checked |
| --- | --- | --- |
| Product name | Cambuz PDF Reader | `package.json`, `index.html` title, About dialog, Windows ProductName (CI asserts) |
| Version | 1.1.0 | `package.json`; artifact names; About dialog now reads `app.getVersion()` (the hard-coded string is removed, covered by a test); CI now reads the expected FileVersion from `package.json` |
| App ID | `com.cambuz.pdfreader` | `package.json` `build.appId` (confirmed) |
| Publisher | Cambuz | `package.json` `author`; `LICENSE` copyright; Windows CompanyName (CI asserts non-empty) |
| Licence | MIT | `LICENSE`, `THIRD-PARTY-NOTICES.md` (shipped in the installer) |
| Icons | `.ico`, `.icns`, `.png` | `build/`; CI icon checks |

**Still required before release (gating):**

1. Manual Windows acceptance on real hardware using [`docs/WINDOWS-ACCEPTANCE-CHECKLIST.md`](docs/WINDOWS-ACCEPTANCE-CHECKLIST.md).
2. A physical print test to a real printer (CI did not print).
3. Your approval to publish, and your approval to merge `arena/e73ef198-cambuz-pdf` into `main`.

Release notes: [`docs/RELEASE-NOTES-1.1.0.md`](docs/RELEASE-NOTES-1.1.0.md).

**Open observations (not release blockers):** the first 100-page search measured 52–60 ms in one
CI run and 77–83 ms in the candidate run, on the same runner CPU model; Phase 8 measured 52–54 ms.
This needs a same-runner comparison. The context-menu Copy item stays enabled on restricted
documents and shows the refusal message when chosen. Native Linux and macOS desktop checks remain
open.

**Superseded by the decisions above:** the "Manual actions required" list and the "Known limitations"
item on copy restriction in the Phase 10 report below were written before these decisions. Their
history is kept; the current position is the list above.

### Phase 10 report (earlier, history preserved)

**Phase 10 status: `PARTIAL`.** Automated regression and packaged-app checks pass on the
release candidate in CI. Native desktop checks on Linux and macOS, physical printing,
manual device testing and code signing are **not** complete and are listed under
[Manual actions required](#manual-actions-required-from-the-maintainer).

- Branch: `arena/e73ef198-cambuz-pdf`. Not merged into `main`; merge requires explicit approval.
- Starting commit (`main`): `5578c7348c6d8c2022092e232292b6f5f606dcca` (PR #10 merge).
- Phase 10 commits: `08d4a35` (macOS menu roles), `279ef53` (explicit renderer sandbox),
  and the README docs commit at the tip of the branch.
- Release-candidate CI run: [`Desktop builds`, run 38030734309](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38030734309)
  on `279ef53`. All four jobs succeeded and every step of the Windows, Linux and macOS
  jobs succeeded.
- Baseline run on `main`: [run 38027635457](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38027635457) (`5578c73`), all four jobs succeeded.

### Release status and supported platforms

| Platform | Artifact | Build | Automated packaged-app test | Native desktop launch verified by a person | Status |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | NSIS installer and portable `.exe` (unsigned) | Passed (CI) | **Passed**: unpacked, silently installed, and portable runs, 35/35 checks each, on a GitHub Windows runner | Not performed | Supported for pre-release evaluation |
| Linux x64 | AppImage (unsigned) | Passed (CI) | **Passed**: packaged app under Xvfb, 32/32 checks, with `--no-sandbox` (CI only) | Not performed | Pre-release; desktop integration only partly tested |
| macOS arm64 | DMG and ZIP (unsigned, not notarized) | Passed (CI) | **Not run**: build, contents and `Info.plist` checks only; app never launched | Not performed | Pre-release; build-only evidence |
| Windows arm64, Linux arm64, macOS x64 | — | Not built | — | — | Not supported |

"Build passed" means electron-builder produced the artifact and the contents checks passed.
"Automated packaged-app test passed" means the headless smoke harness drove the packaged
Electron app in CI. Neither is a substitute for a person launching the app on that OS.

### Evidence from CI (release-candidate run 38030734309, commit `279ef53`)

Windows x64 (per packaging mode; the three modes are unpacked, silently installed, and portable):

- 35/35 packaged checks passed in each mode, including launch with a PDF path (a non-ASCII filename with spaces), second-launch hand-off, Open PDF switching, both bundled samples, the form sample's fillable fields, drop-to-open, text layer alignment, page navigation, zoom within budget, print-preview preparation, mouse selection, Ctrl+C and the Windows clipboard, Hindi and Punjabi copy, refusal of copy in a copy-protected PDF, 100-page search and repeat search, scanned-page rendering with zero selectable characters, three open/render/close cycles, and **zero uncaught renderer exceptions**.
- Installer: silent install, Start Menu shortcut, `.pdf` association (`CambuzPDFReader.Document`), installed-exe ProductName/FileVersion/CompanyName asserts, then uninstall with the same checks removed.
- Print: CI prepared a print-ready PDF and rendered a preview sheet. **No job was sent to any physical or virtual printer.**

Linux x64 (`cambuz-pdf-reader`, under Xvfb): 32/32 packaged checks passed, covering the same reading, search, selection, copy, scanned-page and open/close probes (without the Windows clipboard and OS-installation checks). The `.desktop` entry, icon and MIME wiring inside the AppImage were also asserted.

macOS arm64: the build, the packaged-contents check, and the document-type and icon checks in `Info.plist` passed. The app was **not launched**.

### Defects fixed in Phase 10

1. **macOS application menu and Edit roles (fixed in code, not yet verified natively).** The custom
   menu replaced Electron's default macOS menu, so there was no application menu (Quit, Hide,
   Services, About) and no standard Edit copy/cut/paste roles. On macOS, Cmd+C is routed through
   those roles, so copying may not have worked. `src/mac-menu.cjs` adds the application menu and
   Edit roles on macOS only, and removes the duplicate Cmd+Q accelerator from File > Exit. The
   Windows and Linux menu templates are returned unchanged. Covered by 11 assertions in
   `scripts/test-main-process.mjs`; **not** run in a macOS app.
2. **Explicit renderer sandbox.** `sandbox: true` was only the Electron default. It is now set
   explicitly on the main window and asserted by a test. No behaviour change is expected.

No other release-blocking defect was reproduced in the automated suite or in the CI packaged runs.

### Security boundary (static review and tests)

| Check | Result | Evidence |
| --- | --- | --- |
| Context isolation | Enabled | `main.js` `webPreferences`; test-main-process |
| Node integration | Disabled | `main.js`; test-main-process |
| Renderer sandbox | Enabled, explicit | `main.js`; new assertion |
| `webSecurity` | Never disabled | `main.js` comment and test |
| Preload surface | Named `cambuzAPI` bridge only; no raw `ipcRenderer` exposed | `preload.js` |
| External links | `http(s)` outline links open in the system browser; other new windows denied | `setWindowOpenHandler` in `main.js` |
| Navigation | Page-initiated navigation away from the viewer is blocked after first load | `will-navigate` in `main.js` |
| Permissions | Denied except the Fullscreen API | permission handlers in `main.js` |
| Uncaught renderer exceptions | 0 in all Windows and Linux packaged runs | CI annotations, run 38030734309 |

Not verified: a dedicated crash-dump scan (that check does not exist in this repository), and a
fuzzing pass over malformed IPC messages.

### Test results

- **Local regression suite** (`npm test`, commit `279ef53`): **1085 passed, 0 failed, 2 skipped**.
  The 2 skips are Phase 7 OCR checks that need the optional Tesseract engine.
  Main-process tests: 77 passed (Phase 10 added 11 menu and 1 sandbox assertion).
- **CI `Regression tests (Linux)`** on `279ef53`: success.
- **Packaged-app checks** (CI): Windows 3 × 35/35 passed; Linux 1 × 32/32 passed; macOS build-only.
- **Not run in Phase 10:** a local Electron launch (the Electron binary download from GitHub is
  blocked in this environment), physical printing, OS file-open on native Linux and macOS, the
  Phase 6 device checks, and the Phase 7 native OCR check.

### Reading, search, selection and printing: what the evidence covers

| Area | Evidence | Limit |
| --- | --- | --- |
| Open via UI, command line and OS file-open | Windows: launch argument, second launch hand-off, drag-and-drop; Linux: launch argument and second PDF. | macOS `open-file` was not run natively. |
| First and middle pages | First render, and navigation to pages 5 and 6 in both Windows and Linux runs. | Last-page navigation is not in the CI probes. |
| Zoom, fit-to-width, fit-to-page | Zoom in/out within the pixel budget (CI). | Fit modes were not individually exercised in CI. |
| Repeated open and close | Three open/render/close cycles per run, viewer canvas released. | Not a long-session leak study. |
| Empty, malformed, encrypted, damaged PDFs | Covered by the existing Phase 2–5 automated tests. | Not re-run natively in Phase 10. |
| Search, repeated search, no result | 100-page search and repeat search (CI). | No-result wording not separately asserted in CI. |
| Selection and Ctrl+C | Mouse selection and Ctrl+C on Windows and Linux; Windows clipboard receives Unicode. | macOS Cmd+C depends on the fix above and is unverified. |
| Hindi and Punjabi | Selection and copy on Windows and Linux (CI). | Depends on the PDF's font mapping; see limitations. |
| Scanned PDFs | Scanned page renders with zero selectable characters (CI). | Text needs OCR (optional Phase 7 engine). |
| Print preview and page ranges | Preview sheets prepared and rendered (CI). | No physical print. Paper size, margins and scaling not individually tested natively. |
| Merge, split, extract, reorder, delete | Covered by Phase 4 automated tests. | Not run natively in Phase 10. |
| Password-protected PDFs and forms | Form sample shows 8 fillable widgets (CI); encrypted fixtures in Phase 5 tests. | Not re-run natively in Phase 10. |

### Performance (measured, compared with Phase 8)

Phase 8 numbers come from [run 38019417062](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38019417062)
(Electron 28.3.3, commit `cb68803`). Phase 10 numbers come from runs 38030404030 (commit `08d4a35`) and 38030734309 (commit `279ef53`) (Electron 44.7.0),
so each Phase 10 range covers six observations: two runs times three packaging modes. Each observation is a
single reading on one GitHub runner, not a median, and runner CPU models vary between runs. The Phase 8 ranges cover three observations.
Process counts also differ (4 or 6 processes in the memory snapshot), which affects the memory rows. These are **not** timing targets, and no improvement is claimed.

| Measurement (Windows, three packaging modes) | Phase 8 (Electron 28) | Phase 10 (Electron 44) | Reading |
| --- | --- | --- | --- |
| Sample PDF open to first page rendered (ms) | 256.9–258.9 | 258.8–276.7 | Up to about 18 ms higher at the top of the range; no clear change in the median. |
| 100-page search, first query (ms) | 51.9–53.9 | 51.9–73.7 | Run 38030404030 measured 70–74 ms and run 38030734309 measured 52–60 ms. The Phase 9 `main` run measured 52–63 ms. Not conclusive; runner variance is likely. Needs a same-runner comparison. |
| 100-page search, cached repeat (ms) | 0.9–1.2 | 0.7–1.3 | No change observed. |
| Three open/render/close cycles, total (ms) | 800.7–817.6 | 800.7–833.5 | No change observed. |
| Print-preview preparation, first sheet (ms) | 301.1–358.8 | 314.3–390.4 | Slightly higher at the top of the range; no clear change. |
| Launch to renderer-ready (ms) | 559.5–9,078.5 | 581.1–6,679.0 | Very wide spread in both phases; no reliable comparison. |
| Idle welcome screen, private bytes (MiB) | 105.1–110.8 | 154.1–164.6 | **Higher by about 50 MiB** in every Phase 10 observation. Electron 44 runtime footprint is presumed but not investigated. |
| After three cycles, private bytes (MiB) | 155.8–157.8 | 209.7–223.3 | **Higher by about 60 MiB.** |

Packaging size (from the `Build output` annotations):

| File | Phase 8 (run 38019417062) | Phase 10 (run 38030734309) |
| --- | ---: | ---: |
| Windows installer (`-setup.exe`) | 81.6 MiB | 118.3 MiB |
| Windows portable (`-portable.exe`) | 81.4 MiB | 118.0 MiB |
| Linux AppImage | 105.5 MiB | 125.1 MiB |
| macOS DMG | 96.7 MiB | 129.7 MiB |
| macOS ZIP | 93.3 MiB | 125.7 MiB |
| Renderer payload `app.asar` (Windows) | 19.1 MiB | 17.7 MiB |

The installer growth is about 37 MiB (about 45%) on Windows. It comes from the Electron 44 runtime,
since the renderer payload shrank. The Phase 9 runtime cleanup is in place. Reducing the runtime
footprint is not in scope for Phase 10 and is recorded as a follow-up.

### Identity and metadata consistency

| Item | Value | Where checked |
| --- | --- | --- |
| Product name | `Cambuz PDF Reader` | `package.json`, `src/index.html`, CI ProductName assert |
| Version | `1.1.0` | `package.json`, artifact names, CI FileVersion assert. The About dialog reads `app.getVersion()` at runtime (asserted in `test-main-process.mjs`); no version string is hard-coded there. |
| App ID | `com.cambuz.pdfreader` | `package.json` `build.appId`. **Unchanged; unconfirmed.** Changing it after release would create a new app identity. |
| Publisher (`CompanyName`) | `Cambuz` (from `author`) | CI asserts it is non-empty. **Unchanged; unconfirmed.** |
| Copyright | `Copyright (c) 2026 Cambuz` | `LICENSE`, `package.json` |
| Licence | MIT, with third-party notices | `LICENSE`, `THIRD-PARTY-NOTICES.md`, shipped in the installer |
| Icons | `.ico`, `.icns`, `.png` | `build/`, CI icon checks in the AppImage and `Info.plist` |

### Known limitations and unresolved issues

1. **Unsigned builds.** Windows SmartScreen will warn on the installer and portable executable. Gatekeeper will block the unsigned, un-notarized macOS app unless the user overrides it. See signing below.
2. **Native desktop coverage is partial.** Linux was tested headless under Xvfb with `--no-sandbox`. macOS was never launched. Neither platform has been tested by a person on real hardware.
3. **`--no-sandbox` in CI only.** The Linux smoke job needs it because the runner restricts user namespaces. The shipped app does not pass the flag. An AppImage on a hardened distribution may still need an AppArmor profile or the same flag. Not tested.
4. **Copy restriction (decided: honoured).** A PDF whose permissions deny copying keeps its text non-selectable and uncopyable in Cambuz, and Cambuz says so. This is a Cambuz-side policy, not DRM. Resolved in the final pre-release acceptance above.
5. **Scanned pages need OCR.** They have no text layer. Optional OCR (Phase 7) needs the Tesseract engine and has not had its native desktop check.
6. **Broken font mappings.** Some PDFs have missing or broken ToUnicode mappings. Copied text may be missing or wrong. Cambuz does not substitute characters. See the Phase 6 limitations.
7. **macOS menu fix unverified.** Quit, Hide and Cmd+C on macOS are fixed in code and covered by unit assertions only.
8. **Higher idle memory and installer size** on Electron 44, as measured above. No investigation yet.
9. **About dialog version (resolved).** The About dialog now reads the app version at runtime.
10. **Non-reproducible digests.** The AppImage, DMG and ZIP digests differ between builds with identical inputs. Verify a download against the `SHA256SUMS.txt` from its own run.
11. **Historical blocker list.** The "Known limitations and blockers before a public release" list in the Desktop packaging section predates Phase 9. Several items were resolved in Phase 9; the list is kept for history.
12. **Phase 6 device checks and the Phase 7 native OCR check** remain outstanding (see each phase).

### Signing and notarization status

**Not signed. Not notarized.** No certificates or secrets were available. Two separate paths are needed:

- **Windows:** an Authenticode code-signing certificate (EV or standard) applied to the installer and portable `.exe`. Until then, expect SmartScreen warnings.
- **macOS:** an Apple Developer ID Application certificate, `codesign` with hardened runtime, and notarization with `notarytool`, before the DMG is distributed to users.

CI is set to `CSC_IDENTITY_AUTO_DISCOVERY: false`, so no signing identity is picked up accidentally.

### Build and test commands

```bash
npm ci                 # installs dependencies; Electron binary is fetched on first run
npm test               # full regression suite (Phases 2–8), about 30 seconds
npm run build:win      # NSIS installer and portable exe (Windows x64)
npm run build:linux    # AppImage (Linux x64)
npm run build:mac      # DMG and ZIP (macOS arm64)
node scripts/check-packaged-app.mjs dist/win-unpacked/resources/app.asar   # packaged contents check
node scripts/smoke-test-packaged.mjs --app "dist/win-unpacked/Cambuz PDF Reader.exe" --out smoke/local --timeout 180   # headless packaged smoke test (Windows)
```

CI artifacts (run 38030734309, retention 30 days for the installers and 14 days for the smoke evidence):

- [Windows installer and portable (`cambuz-pdf-windows-x64`)](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38030734309/artifacts/11661613611)
- [Windows smoke-test evidence](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38030734309/artifacts/11662200151)
- [Linux AppImage (`cambuz-pdf-linux-x64`)](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38030734309/artifacts/11661538423)
- [Linux smoke-test evidence](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38030734309/artifacts/11661618588)
- [macOS DMG and ZIP (`cambuz-pdf-macos-arm64`)](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38030734309/artifacts/11661583629)

SHA-256 digests from this run (verify against the `SHA256SUMS.txt` in the same artifacts):

| File | SHA-256 |
| --- | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | `ff4971590baa50307ad350acc3d531d24f8892dd1f55243a29f239fe68da3a97` |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | `34a177eef57e1c12a61150afd7724faf25cc8254f2e333b6cb9946c62a38664b` |
| `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage` | `fd1bac1080e5c988d1831f0cc07143a1d667d58e5db8b65fbee532d2d7a8a6cb` |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` | `f78d9b68c77d1ea759a67cb8a20fff3f103fbcea33ec2f825149937c9e8d0762` |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | `607c1dba33087861564eaffa6d92191a32fbfc8693aeb6c72d84e8f818e1d890` |

### Manual actions required from the maintainer

1. **Confirm the app ID `com.cambuz.pdfreader` and publisher `Cambuz`.** Both are permanent once users install the app. Changing them later creates a second application identity. Approval is required before any change.
2. **Choose a signing path:** get a Windows code-signing certificate and an Apple Developer ID with notarization, or accept unsigned pre-release builds with the warnings above.
3. **Decide the copy-restriction policy:** honour the PDF's "copying not allowed" flag (current behaviour) or ignore it.
4. **Physical printing:** print a test page to at least one real printer on Windows, and ideally on Linux and macOS. Check paper size, orientation, margins and scaling.
5. **Native desktop tests:** on a Windows PC, install and run the installer, then test by hand (open, double-click a PDF, search, copy, print). On a Linux desktop, run the AppImage with and without `--no-sandbox`. On an Apple Silicon Mac, open the DMG, launch the app, and check Cmd+Q, Cmd+C and Open With.
6. **Accept or reject the Electron 44 footprint:** approve the +37 MiB installer and the higher idle memory, or ask for an investigation into the runtime footprint.
7. **Approve the merge to `main`.** Nothing has been merged.
8. **Phase 6 device checks and Phase 7 native OCR check** still need a person on the target machines.

---

## Phase 9 — Packaging and Distribution

**Phase 9 status: `COMPLETE`.**

- Branch: `arena/f547264f-cambuz-pdf` (all work committed here; `main` not merged).
- Starting commit: `a95c61a6ae1bce8148f807eae885d3755a7493cc`.
- Code commits: `6cbe602` (upgrade + fixes), `358b043` (Linux CI check fix),
  `25dd76e` (exe metadata CI check). Validation run below is on `25dd76e`.
- Final commit: the docs commit at the tip of `arena/f547264f-cambuz-pdf` in `git log`
  (docs-only follow-up to `25dd76e`; the validation run above pins the code).
- Electron before: `28.3.3` (end-of-life). Electron after: `44.7.0` (latest stable).
- Supported platforms: Windows x64, Linux x64, macOS arm64 (see build-vs-runtime table).
- Validation: GitHub Actions [`Desktop builds`, run 38025072964](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964) — all four jobs green.

> Branch note: the Phase 9 brief named branch `arena/98c3aa95-cambuz-pdf` at commit
> `34b9796`, but this session is bound to `arena/f547264f-cambuz-pdf`. The starting
> `HEAD` is `a95c61a`, the merge of PR #9 from `arena/98c3aa95-cambuz-pdf`, so all
> Phase 8 work described below was present. No unrelated work was touched.

### Starting-state audit (verified 2026-10-10, before any Phase 9 change)

Baseline regression suite on the starting commit: **978 passed, 0 failed, 2 skipped**
(123 + 59 + 54 + 133 + 268 + 229 + 54 Phase 2–7; 19 samples; 12 context-menu;
4 text-selection; 23 main-process; Phase 8 focused checks pass; the 2 skips are the
Phase 7 no-Tesseract skips). Phase 8 packaged-Electron evidence is GitHub Actions run
`38019417062` (32/32 Windows checks per packaging mode), as documented in Phase 8.

Each pre-Phase-8 packaging-audit finding was re-verified against the current code
instead of assumed open:

| Earlier finding | Verified starting state |
| --- | --- |
| “Try Sample PDF” / “Try Sample PDF Form” fail packaged (`ERR_FILE_NOT_FOUND`) | **Already fixed (Verified).** `main.js` serves bytes over the allow-listed `read-sample` IPC channel (`src/bundled-samples.cjs`); the browser preview uses a module-relative URL. Covered by `test-main-process.mjs` and the packaged smoke test. |
| Text selection/copy broken | **Already fixed (Verified).** Selection, Ctrl+C, Windows clipboard, Hindi/Punjabi copy and the copy-denied refusal pass in packaged smoke tests. |
| Electron 28.3.3 end-of-life | **Open (Blocked for release).** Fixed in Phase 9 (see below). |
| No application icon (`assets/icon.png` missing) | **Open.** Fixed in Phase 9 (see below). |
| No `LICENSE` file / third-party notices | **Open.** Fixed in Phase 9 (see below). |
| No PDF file association / open-with handling | **Open.** Fixed in Phase 9 (see below). |
| `express` in runtime `dependencies` | **Open.** Fixed in Phase 9 (see below). |
| App ID `com.cambuz.pdfreader` / publisher unconfirmed | **Open. Requires user action.** Still unconfirmed (see decisions). |
| Unsigned builds (SmartScreen / Gatekeeper warnings) | **Open. Requires user action.** Still unsigned; safe signing path documented below. |
| macOS arm64-only, no mac app menu, never launched | **Open.** Still arm64-only and unlaunched; menu unchanged (see limitations). |
| Linux sandbox (`--no-sandbox` needed on CI runner) | **Open.** Still needed on the CI runner; desktop behavior untested. |
| Staging rewrites source `package.json` | **Already fixed (Verified).** `scripts/stage-app.mjs` packages `.build-app/`; source manifest untouched (re-verified: clean `git status` after staging). |
| `@napi-rs/canvas` native binding ships | **Already fixed (Verified).** Staging uses `--omit=optional` and fails if the scope is non-empty; the contents check forbids it. |
| Non-reproducible digests | **Known, still true.** Re-confirmed: the Windows setup digest differs between runs `38024638266` and `38025072964` although the app payload is identical (only workflow files changed). Always verify a download against the `SHA256SUMS.txt` from its own run. |

### What changed in Phase 9

- **Electron `28.3.3` → `44.7.0`** (latest stable; lockfile updated consistently).
  Breaking changes v29–v44 were reviewed against every Electron API Cambuz uses
  (docs `breaking-changes.md` at `v44.7.0`). The only functional impact is the
  Electron 36 removal of `PrinterInfo.isDefault`/`status`: `main.js` keeps the
  `isDefault` field in its payload (always false now) so the preload contract is
  unchanged, and the renderer falls back to its “Choose in system print dialog…”
  choice, which still reaches the OS default through the native dialog. There is
  no replacement Electron API for the default printer. Other reviewed changes
  need no code: clipboard re-architecture (Cambuz copies through DOM events, not
  the `clipboard` module), same-WebContents PDF rendering, `window.open`
  resizability, Ozone/Wayland default on Linux. Two behavior notes: file dialogs
  without an explicit `defaultPath` now start in Downloads instead of the
  last-used folder (Electron 43; Save dialogs already pass a path, Open dialogs
  do not), and `ELECTRON_SKIP_BINARY_DOWNLOAD` is unsupported since Electron 42
  (removed from CI; `npm ci` no longer fetches a binary, electron-builder fetches
  its own, and `npm start` downloads the runtime on first run).
- **OS file-open integration.** New `src/file-open.cjs` (shared argv/PDF-path
  parsing); `main.js` handles startup arguments, single-instance `second-instance`
  handoff with window focus, and macOS `open-file` (including pre-ready arrival
  via a pending slot); the renderer collects an early file through a new
  `renderer-ready` handshake and later files over `open-file-path`, reading
  through the existing sandboxed `read-file` channel. Re-opening the already-open
  file is a no-op; missing files show the same clear in-app error as the Open
  dialog. `package.json` declares `fileAssociations` for `pdf`
  (`CambuzPDFReader.Document`, MIME `application/pdf`, role Viewer, rank
  Alternate). 42 new unit assertions in `test-main-process.mjs`; the packaged
  smoke test gained `--launch-pdf`/`--second-pdf` probes that launch real
  processes (the launch path contains a space and non-ASCII characters).
- **Window hardening (no security feature weakened).** Context isolation stays
  on, Node integration stays off, `webSecurity` is never disabled (all three now
  asserted in tests). Added: `setWindowOpenHandler` routes http(s) outline URLs
  to the system browser and denies everything else (print window denies all);
  `will-navigate` blocks page-initiated navigation away from the viewer (armed
  only after the first load, so startup can never block itself); permission
  request/check handlers deny everything except the Fullscreen API the reader
  uses. The existing `window.cambuzAPI` surface is unchanged apart from the two
  additive file-open members (`rendererReady`, `onOpenFilePath`).
- **Icon set.** (Superseded by the final branding pass — see the top of this
  document.) Phase 9 drew an interim mark with `scripts/create-icon.py`; the
  shipped icon files are now derived from the official master
  `assets/icon-master.png` via `scripts/generate-icon-assets.py`:
  `assets/icon.png` (512, staged for the window icon), `build/icon.ico`
  (multi-size Windows), `build/icon.icns`
  (macOS), `build/icon.png` (512, Linux). Wired in `package.json`
  (`win`/`mac`/`linux` icon); staging fails fast if any icon is missing, and
  electron-builder itself errors on a missing icon file, so there is no silent
  fallback to the generic Electron icon.
- **Licensing.** New MIT `LICENSE` (matches `package.json`) shown by the NSIS
  installer (`nsis.license`); new `THIRD-PARTY-NOTICES.md` covering the exact
  shipped set (Electron 44.7.0 MIT, pdfjs-dist 4.10.38 Apache-2.0, pdf-lib 1.17.1
  MIT, @pdf-lib/* MIT, pako MIT, tslib 0BSD) with full license texts, plus the
  Electron/Chromium credits that ship next to the executable. Both files are
  staged into the app and required by the contents check; CI asserts Electron's
  own `LICENSE*` files are present in `win-unpacked`.
- **Runtime cleanup.** `express` moved to `devDependencies` (`npm run serve`
  still works for development; the preview server no longer ships — the contents
  check now forbids `node_modules/express/`). Staging also removes the 16 empty
  scope directories `npm ci --omit=dev --omit=optional` leaves behind. Staged
  tree: **19.2 MiB** (was 21.4 MiB); `app.asar`: **17.7 MiB** (was 19.1 MiB).
- **Distribution pipeline.** CI keeps the lockfile/`npm ci` procedure and the
  Phase 8 regression gate, and adds: Start Menu shortcut + HKCU `.pdf` ProgId
  registration asserts after silent install (and removal asserts after
  uninstall), installed-exe ProductName/FileVersion/CompanyName asserts,
  `.desktop` Icon/MimeType + hicolor icon + mime-XML asserts inside the AppImage,
  `Info.plist` document-type + `icon.icns` asserts for macOS, and the OS-open
  probes on every runtime smoke run. Checksums, artifact names, and upload order
  are unchanged.

### Distribution artifacts (Verified)

From validation run [`38025072964`](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964)
(commit `25dd76e`). Verify any download against the `SHA256SUMS.txt` in its own
artifact — digests differ run to run (see audit table).

| File | Size | SHA-256 | Artifact |
| --- | --- | --- | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | 118.3 MiB | `138baf02f2e683f3d69d5bef305a221df6c1a580bc0e09d25f6f7cab12806afd` | [cambuz-pdf-windows-x64](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964/artifacts/11660138284) |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | 118.0 MiB | `ee6f07624b8619c68eb9d05b63fa641f6c75ac9271697faae7df0900eb84ecbe` | same |
| `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage` | 125.1 MiB | `bd744b9f17714a653bcea7dbcb5b95410f00824c7f36a4a763d295aa5f37e0ff` | [cambuz-pdf-linux-x64](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964/artifacts/11660193280) |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` | 129.7 MiB | `48fa0ea46e86017de40eb9f885acc81bac36d76d15496eab1dd8385a74ac59d6` | [cambuz-pdf-macos-arm64](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964/artifacts/11660098430) |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | 125.7 MiB | `d19bfdef67552cee6efe46359409dd9a11441609861033825a63790c7d8d6a77` | same |
| `app.asar` in the Windows build (renderer payload) | 17.7 MiB | — (inside the installed app) | — |

Size changes vs Phase 8 (setup 81.6 → 118.3, portable 81.4 → 118.0, AppImage
105.5 → 125.1, dmg 96.7 → 129.7, zip 93.3 → 125.7 MiB) come entirely from the
Electron 28 → 44 runtime upgrade (sixteen Chromium majors of growth, including
statically linked ANGLE); the Cambuz payload itself shrank (`app.asar`
19.1 → 17.7 MiB) through the `express` removal. No feature was added to the app
payload to cause the growth.

### Validation

`npm test`: **1025 passed, 0 failed, 2 skipped** (128 + 59 + 54 + 133 + 268 +
229 + 54 Phase 2–7; 19 samples; 12 context-menu; 4 text-selection; 65
main-process; Phase 8 focused checks pass; the 2 skips are the pre-existing
Phase 7 no-Tesseract skips). Identical results locally and in the CI `test` job.
The Phase 8 search-cache behavior is preserved in the packaged runs below
(cached repeat query 0.8–0.9 ms on 100 pages).

| Platform | Build | Runtime validation | Result |
| --- | --- | --- | --- |
| Windows x64 | NSIS installer + portable (Verified) | Unpacked, silently installed, and portable apps: 35/35 smoke checks each (Verified). Install/uninstall, Start Menu shortcut, HKCU `.pdf` ProgId + open command, exe ProductName/FileVersion/CompanyName, and Electron `LICENSE*` files asserted (Verified). | **Verified** |
| Linux x64 | AppImage (Verified) | Unpacked app under Xvfb with `--no-sandbox`: 32/32 smoke checks (Verified; 3 fewer than Windows because OS-clipboard assertions are Windows-only). `.desktop` Icon/MimeType, hicolor icons, and mime XML asserted inside the AppImage (Verified). The AppImage itself was not launched (Not verified). | **Partially verified** |
| macOS arm64 | DMG + ZIP, unsigned (Verified) | Not launched (Not verified). `icon.icns` and `Info.plist` `CFBundleDocumentTypes` (pdf, Viewer) asserted on the build output (Verified). Intel/Universal builds do not exist (arm64 only). | **Build only** |

Windows packaged-app observations (run `38025072964`; three single observations
across unpacked/installed/portable modes — order unattributed, as in Phase 8;
same runner image `win25-vs2026`, Node `v22.23.3`, 4 EPYC 7763 CPUs, 16379 MiB
RAM):

| Measurement | Observed values | Notes |
| --- | --- | --- |
| Process launch to renderer-ready | 660.2 ms; 1,245.9 ms; 6,607.2 ms | Includes DevTools polling/attachment; spread too wide for a startup claim. |
| Sample drop to first rendered page | 259.8 ms; 260.9 ms; 265.4 ms | Phase 8: 256.9–258.9 ms. Same ballpark. |
| 100-page search first / cached repeat | 73.40 / 0.80 ms; 78.00 / 0.90 ms; 81.70 / 0.80 ms | Phase 8 cache intact (repeat < 1 ms). First-query values are single observations on a different CPU, not a regression claim. |
| Print-preview preparation | 341.4 ms; 341.4 ms; 405.3 ms | 10 sheets prepared, first `252×357` sheet rendered. No OS print submission. |
| Three open/render/close cycles | 817.7 ms; 849.8 ms; 850.1 ms total | All cycles passed with canvas release. |
| Working set / private bytes, welcome idle | 327.5/154.1; 330.4/157.5; 360.7/161.8 MiB | Follows the launch-open probe + close (boundary changed vs Phase 8's pristine idle). Higher than Phase 8 (268.8–301.4 / 105.1–110.8), consistent with the larger Electron 44 runtime. |
| Working set / private bytes, after first render | 373.3/180.8; 376.9/185.1; 407.7/190.4 MiB | Phase 8: 332.4–356.1 / 143.4–148.3. |
| Working set / private bytes, after searches | 418.7/214.7; 423.6/222.1; 462.2/230.3 MiB | Phase 8: 350.5–380.3 / 155.3–157.2. |
| Working set / private bytes, after cycles, closed | 408.3/214.6; 407.7/217.0; 439.9/221.2 MiB | Still above idle; not a leak study (same caveat as Phase 8). |

Linux observations (single unpacked run; 4 EPYC 7763 CPUs, 15990 MiB RAM,
`ubuntu24` image): startup 5,033.3 ms (with CDP attach), DOMContentLoaded
61.8 ms, sample drop to first page 264.3 ms, print preview 313.6 ms, 100-page
probe first page 256.9 ms. Memory is not measured off-Windows. Full per-check
detail is in the evidence artifacts ([Windows](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964/artifacts/11659573993),
[Linux](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38025072964/artifacts/11659778556));
all jobs report zero error/warning annotations.

What CI proves and what it does not: installer compilation, silent
install/launch/uninstall, shortcuts, registry/mime/plist registration, launch
with a spaced non-ASCII path, second-instance handoff, rendering, navigation,
zoom, search (incl. repeat), selection/clipboard (Windows), Hindi/Punjabi copy,
sample buttons, print-preview preparation, and clean shutdown are all
**Verified** where the table says so. Print-preview preparation is still not a
real print job (**Not verified**). Core reading needs no network by construction
(**Verified** by code audit: no remote URLs in app code; packaged loads travel
over local IPC/ArrayBuffer; outline links intentionally open in the system
browser) — but no dedicated offline CI run exists. A real double-click, the GUI
installer pages, and desktop (non-runner) behavior remain manual (see below).

### Building and testing locally

Prerequisites: Node 22, npm, Python 3 + Pillow (only to regenerate icons via
`scripts/generate-icon-assets.py`), and network access to the npm registry and GitHub
(Electron/electron-builder binaries download from GitHub releases).

```bash
npm ci              # reproducible install from the lockfile (no Electron binary yet)
npm test            # full regression suite incl. Phase 8 and main-process checks
npm start           # development run (downloads the Electron runtime on first launch)
npm run serve       # browser preview at http://localhost:3000 (dev only, needs express)
npm run build:win   # installer + portable (on Windows; needs the downloaded runtime)
npm run build:linux # AppImage (on Linux)
npm run build:mac   # DMG + ZIP, arm64, unsigned (on macOS)
```

`npm start` / `npm run serve` are development runs. Packaged-app validation is
separate: build first, then `node scripts/check-packaged-app.mjs <app.asar>`
(contents) and `node scripts/smoke-test-packaged.mjs --app <executable> --out
<dir> [--launch-pdf <file> --second-pdf <file>]` (runtime). Always build through
the `build:*` scripts so `scripts/stage-app.mjs` runs first, and check `git
status` afterwards (it must stay clean — staging writes only to ignored
`.build-app/`).

### Known limitations

1. **Unsigned builds (Requires user action).** All artifacts are unsigned and
   un-notarized: Windows SmartScreen will warn on the installer (“Unknown
   publisher”; the app runs after More info → Run anyway), and macOS Gatekeeper
   will refuse the download until the quarantine flag is cleared (right-click →
   Open, or `xattr -d com.apple.quarantine`). This is expected for unsigned
   software, not a defect; signing removes it (path below).
2. **Installer size grew ~45%** through the Electron 44 runtime (see sizes).
   Unavoidable without staying on an end-of-life runtime.
3. **Default-printer preselection is gone.** Electron 36 removed
   `PrinterInfo.isDefault` with no replacement; the print dialog now starts on
   “Choose in system print dialog…”, which still reaches the OS default. The
   “· Default” label no longer appears.
4. **Open dialogs start in Downloads** (Electron 43 default) instead of the
   last-used folder. Save dialogs are unaffected (they pass a path).
5. **macOS is arm64-only, unsigned, unlaunched, and still has no native app
   menu.** Intel and universal builds were not attempted. The `Viewer` /
   `Alternate` file-association rank is deliberately modest until signing exists.
6. **The AppImage was built and inspected but never launched;** the Linux smoke
   run covers the unpacked build under Xvfb with `--no-sandbox`. Whether a
   desktop distro needs the same flag (or an AppArmor profile) is untested.
7. **Windows default-app choice belongs to the user.** The installer registers
   the `CambuzPDFReader.Document` ProgId (verified in HKCU), but Windows 10/11
   will not silently make Cambuz the default PDF handler; the user confirms via
   Open With / Default apps. Uninstall removes the registration (verified).
8. **Not verified:** a real double-click on each OS, the GUI (non-silent)
   installer pages including the license screen, icon appearance on a real
   desktop, the native right-click menu (invisible to the smoke test), real
   printer enumeration/submission/output, long-session memory, and the Phase 8
   Node/PDF.js scanned-raster segfault (unchanged, still documented as a
   separate Node-only failure; packaged scanned rendering passes).
9. **Platform floors are now macOS 13+, Windows 10+ x64, Linux x64**
   (Electron 44 dropped macOS 12 and all 32-bit builds).

### Signing and notarization status (**Not verified**, credentials unavailable)

No signing credentials exist in the repository or CI (verified: no secrets to
leak — nothing was added). Current state: `CSC_IDENTITY_AUTO_DISCOVERY=false`
in CI so builds never look for an identity. Safe path to signed releases:

- **Windows:** obtain a code-signing certificate (OV/EV, or an Azure Trusted
  Signing account). Add repository secrets `WIN_CSC_LINK` (base64 `.pfx`) +
  `WIN_CSC_KEY_PASSWORD` (or `CSC_LINK`/`CSC_KEY_PASSWORD`), remove the
  `CSC_IDENTITY_AUTO_DISCOVERY=false` env line, and re-run — electron-builder
  signs the exe/installer/portable with no config change. For Azure Trusted
  Signing instead, configure `win.azureSignOptions` (`publisherName` exactly as
  on the certificate, `endpoint`, …) plus the Entra ID environment auth the
  option requires. Expect SmartScreen reputation to build gradually even after
  signing (new certificates warn until trust accumulates; EV shortens this).
- **macOS:** enroll in the Apple Developer Program, create a Developer ID
  Application certificate (`CSC_LINK`/`CSC_NAME` secret), and add notarization
  secrets — either `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
  (recommended) or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
  — so electron-builder's `@electron/notarize` integration activates on the
  existing `mac` target. Notarization is required for Gatekeeper acceptance;
  signing alone is not enough.
- Never commit certificates, keys, or passwords; keep them in GitHub Actions
  secrets and out of logs (electron-builder redacts the password env vars).

### Manual tests still required (Requires user action)

On a normal desktop (not the CI runner), with the artifacts from run
`38025072964`:

1. **Windows GUI install:** run the setup exe unflagged; confirm the MIT license
   page shows; change the install folder; finish; confirm the Start Menu
   shortcut, the Cambuz icon on the installer/exe/shortcut, and launch from the
   shortcut. Repeat the per-machine choice once (expect a UAC elevation prompt;
   per-user must not elevate).
2. **Windows file opening:** double-click a PDF (confirm Windows offers Cambuz
   via Open With on first use; set “Always” and double-click again); right-click
   → Open with → Cambuz on a path containing spaces and non-ASCII characters;
   double-click a second PDF while Cambuz runs (window must switch, no second
   window); delete/rename a target and double-click its stale link (expect the
   clear in-app error, not a crash).
3. **Windows printing:** with a real or virtual printer (e.g. Microsoft Print to
   PDF), open Print, confirm the printer list populates, print 1 and 2 copies,
   try the empty-printer system-dialog fallback, and inspect the output.
4. **Native context menu:** right-click page text (Copy enabled), empty page
   area (Copy disabled), and the search box (Cut/Copy/Paste/Select All).
5. **Linux desktop:** on a distro with FUSE, `chmod +x` and launch the AppImage
   from a file manager; confirm the window icon, Open With integration, and
   whether `--no-sandbox` is needed; try setting Cambuz as the default PDF app.
6. **macOS (Apple Silicon):** open the DMG, drag-install, clear quarantine via
   right-click → Open; confirm launch, Open With on a PDF, and menu/window
   sanity. There is no Intel build to test.
7. **Offline:** disconnect the network, then open, search, zoom, and
   print-preview a local PDF (must all work; only outline http(s) links need the
   browser).
8. **SmartScreen/Gatekeeper:** confirm the exact unsigned warnings above so the
   release notes describe them accurately.

### Decisions or credentials required from the requester

1. **App ID / publisher:** confirm `com.cambuz.pdfreader` and publisher “Cambuz”
   (stamped as exe CompanyName, verified non-empty) before any public release —
   the ID is permanent once users install.
2. **Signing credentials:** provide the Windows and/or Apple secrets above (or
   approve staying unsigned for this distribution round).
3. **File-association rank:** `Viewer`/`Alternate` is conservative; say if a
   future signed release should claim `Default` on macOS.
4. **Manual tests:** run the eight procedures above on real desktops.

---

## Phase 8 — Performance audit, measurement and optimization

**Audit status: COMPLETE WITH DOCUMENTED LIMITATIONS.** The renderer/search/canvas changes and automated regressions pass, and the unpacked, installed, and portable Windows Electron apps passed packaged-runtime checks in GitHub Actions. That runner also collected one set of startup, render, search, and process-tree memory observations per packaging mode. These are CI-runner observations, not universal performance guarantees. The separate Linux Node/PDF.js scanned-page raster probe still segfaults; native printer output and a long-session memory/leak profile remain unverified. No application feature or visual redesign was removed, and no dependency version was changed for performance.

### What changed

- `src/search.js` now keeps an **8 MiB / 2,048-page LRU** of extracted page text and its comparison form. A repeat query over the same document reuses text instead of asking PDF.js to extract every page again. Oversized page strings are not retained; document replacement/close clears the cache, and a late in-flight extraction cannot refill it after close.
- `src/canvas-budget.js` bounds the viewer backing store to **16 million pixels and 8,192 px per dimension**. Thumbnail canvases are capped at **250,000 pixels / 4,096 px per dimension**; retained thumbnail bitmaps share a **4 million-pixel / 64-entry LRU**.
- `src/sidebar.js` and `src/pdf-ops-ui.js` create zero-backing-store placeholders and render nearby thumbnails lazily. Both use an `IntersectionObserver` where available and a scroll-geometry fallback otherwise. Eviction releases canvas pixels; rotation/close cancels outstanding thumbnail tasks and page resources are cleaned up.
- `src/renderer.js` coalesces page/zoom requests into a latest-request render queue, cancels superseded PDF.js canvas/text-layer tasks, avoids repainting an unchanged displayed request, and clears the main canvas on close. Document-load/close generations prevent stale asynchronous opens or renders from replacing a newer document; asynchronous fit/rotation/resize measurements also verify document, page, rotation and fit mode before updating scale.
- The existing PDF.js/pdf-lib versions, UI layout, selection/copy, print preparation, forms, passwords/permissions, page tools, OCR, languages, and keyboard shortcuts were not removed or upgraded. The visual canvas is only downsampled when a page would exceed the explicit bitmap limits; the logical page and selectable text layer keep their normal geometry.

### Measurement method and environment

Run with `PHASE8_BENCH_TRIALS=3 npm run benchmark:phase8`. Every fixture runs in a fresh Node worker; each displayed value is the median of **three** workers. The harness records `performance.now()` timings, `process.cpuUsage()` operation CPU, and `process.memoryUsage().rss`; it uses PDF.js plus `@napi-rs/canvas`, `jsdom`, and `pdf-lib`, not the Electron/Chromium app. “Open” is PDF.js `getDocument().promise`; “first render” is a single bounded Node-canvas render; “all-page thumbnails” is a serial PDF.js raster pass; search timings cover a full-document query; print timing is `buildPrintPdf` preparation, not the OS print dialog/spooler. The 100-page and 100-page text-heavy PDFs are generated in the OS temporary directory and removed by the harness. `cambuz-demo.pdf` is the 10-page sample. Hindi, Punjabi, mixed-language, and scanned fixtures are repository samples.

Machine: **Linux 6.1.158+ x64**, Node **v22.22.3**, Intel Xeon @ **2.60 GHz**, **2 logical CPUs**, host RAM **3,939.89 MiB**. The “idle RSS” snapshot is after imports and forced GC, immediately before opening a fixture; it is not application startup memory. “After first render” is sampled before the all-thumbnail pass. “After close” clears the search cache, destroys the PDF.js document, drops the input byte buffer/references, closes jsdom, runs GC, then samples process RSS. RSS can remain elevated or rise because Node/native allocators retain memory; it is not proof of a live PDF leak.

### Baseline versus current probe

The baseline is the previously recorded three-worker median before the Phase 8 cache/canvas/render edits; “current” is the final three-worker run above. All values are actual probe measurements, in milliseconds except PDF size and RSS (MiB). A pair is **baseline → current**. `n/a` means the harness did not run that operation.

| Fixture (pages / PDF MiB) | Open ms | First render ms | Serial all-page thumbnails ms | First search ms | Repeat search ms | RSS after search MiB | Print prep ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| one-page (1 / 0.01) | 64.16 → 62.17 | 48.13 → 46.23 | 2.58 → 2.44 | 28.09 → 25.28 | 1.89 → 0.24 | 189.29 → 188.67 | n/a |
| ten-page (10 / 0.01) | 66.04 → 64.11 | 31.32 → 30.00 | 46.35 → 46.30 | 48.16 → 43.65 | 21.67 → 0.27 | 191.17 → 190.13 | 47.72 → 60.95 |
| hundred-page (100 / 0.03) | 70.97 → 73.89 | 23.79 → 27.00 | 145.22 → 141.59 | 83.62 → 84.71 | 45.80 → 0.74 | 209.88 → 207.44 | 207.42 → 203.81 |
| large text-heavy (100 / 0.46) | 105.39 → 117.30 | 53.14 → 63.66 | 2,480.14 → 2,444.74 | 975.19 → 960.05 | 810.48 → 1.18 | 219.77 → 221.63 | n/a |
| image-heavy scanned (4 / 0.32) | 64.97 → 66.19 | n/a → n/a | n/a → n/a | 27.92 → 27.41 | 1.90 → 0.33 | 196.92 → 197.94 | n/a |
| Hindi (4 / 0.02) | 61.56 → 61.19 | 48.36 → 50.87 | 20.36 → 19.50 | 29.71 → 29.72 | 5.51 → 0.27 | 194.65 → 191.88 | n/a |
| Punjabi (4 / 0.01) | 63.90 → 65.41 | 46.46 → 45.77 | 17.43 → 17.57 | 29.65 → 30.65 | 5.47 → 0.33 | 192.00 → 194.04 | n/a |
| mixed-language (16 / 1.27) | 65.90 → 65.33 | 90.44 → 96.85 | 301.03 → 358.25 | 130.12 → 144.09 | 76.75 → 0.73 | 211.12 → 213.02 | n/a |

The repeat-query improvement is the clear measured result: the current run makes **zero page-text extraction calls on the second query** (the baseline re-extracted text; on both 100-page cases it made 100 calls on each query). Repeat-query medians fell from 45.80 to 0.74 ms for the 100-page probe and 810.48 to 1.18 ms for the text-heavy probe. First-query, open, thumbnail, and print numbers move in both directions; these small fresh-process samples do not establish a causal regression or improvement for those unchanged subsystems. In particular, the observed large-text open/first-render and 10-page print deltas are retained above rather than described as wins. The Windows packaged-app measurements below are from a different runtime and method; they should not be conflated with these PDF.js/Node medians.

### Current process memory and operation CPU snapshots

All values below are current three-worker medians. RSS is MiB. CPU is process CPU ms for the named operation; **idle CPU was not sampled**.

| Fixture | RSS idle | After open | After first render | After search | Before close | After destroy + GC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| one-page | 175.06 | 180.50 | 183.13 | 188.67 | 188.27 | 188.80 |
| ten-page | 176.01 | 181.48 | 184.25 | 190.13 | 195.89 | 195.89 |
| hundred-page | 177.98 | 182.69 | 185.47 | 207.44 | 214.64 | 214.64 |
| large text-heavy | 179.64 | 187.80 | 187.92 | 221.63 | 221.09 | 220.37 |
| image-heavy scanned | 177.95 | 184.38 | n/a | 197.94 | 195.41 | 195.41 |
| Hindi | 176.32 | 180.95 | 184.46 | 191.88 | 191.62 | 191.62 |
| Punjabi | 178.18 | 183.01 | 187.05 | 194.04 | 193.61 | 193.61 |
| mixed-language | 176.65 | 185.40 | 189.34 | 213.02 | 212.81 | 212.81 |

| Fixture | Open CPU ms | Serial thumbnail CPU ms | First / repeat search CPU ms | Print prep CPU ms | Close CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| one-page | 65.71 | 3.65 | 25.28 / 0.24 | n/a | 1.33 |
| ten-page | 71.22 | 67.28 | 57.29 / 0.28 | 92.14 | 3.01 |
| hundred-page | 87.82 | 199.57 | 122.84 / 0.75 | 335.70 | 1.75 |
| large text-heavy | 161.13 | 2,634.22 | 1,122.14 / 1.19 | n/a | 1.77 |
| image-heavy scanned | 68.76 | n/a | 28.09 / 0.36 | n/a | 1.62 |
| Hindi | 66.70 | 32.35 | 29.74 / 0.28 | n/a | 1.51 |
| Punjabi | 65.48 | 28.78 | 30.67 / 0.34 | n/a | 1.61 |
| mixed-language | 72.55 | 503.22 | 215.38 / 0.74 | n/a | 2.48 |

### Native packaged Electron validation (Windows x64)

The native run is GitHub Actions [`Desktop builds`, run 38019417062](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38019417062), on commit `cb68803ef3d8e21124ae7c588f1671766d43a857` (2026-10-10). All four jobs succeeded: Linux regression tests, the Windows packaged runtime checks, the experimental Linux AppImage build/smoke test, and the experimental unsigned macOS build. This is a separate runtime and benchmark from the PDF.js/Node table above.

**Runner and method.** Windows x64 GitHub runner image `win25-vs2026`; Node `v22.23.3`; 4 logical CPUs reported as AMD EPYC 9V45; 16,379 MiB RAM. The workflow launched the actual Electron executables for the unpacked build, a silently installed NSIS build (then uninstalled it), and the portable executable. Each mode passed **32/32 checks**. The smoke harness drives the actual packaged renderer over Chromium DevTools Protocol and dispatches a file-drop event there, plus pointer, keyboard, and Windows-clipboard operations; it is not a browser-only test. Per-mode timings below are three single observations (one per packaging mode), not medians or timing thresholds. Their concise CI annotation does not retain a reliable target-to-value mapping, so values are reported as observed sets/ranges rather than attributed to a specific packaging mode.

**Functional results, per mode:** packaged PDF open/render; page-number jump to page 5 and next/previous navigation; zoom out/in and back within the canvas pixel budget; print-preview preparation and first-sheet rendering; mouse text selection and Ctrl+C to the Windows clipboard; Hindi and Punjabi Unicode selection/copy; refusal to select text in a copy-protected PDF; 100-page search and case-insensitive repeat search; and scanned-page rendering all passed. Each run also completed **3/3** open/first-render/close cycles with the viewer canvas released and reported zero uncaught renderer exceptions. The four-page scanned fixture rendered at `958×1354` with zero selectable characters. CI prepared a print-ready PDF and rendered the first of 10 sheets; it did **not** submit a job to a physical or virtual printer.

**Packaged-app observations:**

| Measurement | Observed values across the three Windows package runs | Measurement boundary |
| --- | --- | --- |
| Process launch to renderer-ready | 559.5 ms; 1,664.1 ms; 9,078.5 ms | Includes DevTools target polling/attachment; this spread is too wide to claim a reliable startup score. |
| 10-page sample drop to first rendered page | 256.9 ms; 257.4 ms; 258.9 ms | From the harness's drop-event dispatch inside the packaged renderer until page 1 canvas/status are ready. |
| 100-page search, first / same-marker cached repeat | 51.90 / 0.90 ms; 52.60 / 1.10 ms; 53.90 / 1.20 ms | Renderer `performance.now()`; includes PDF.js text indexing/highlighting. Both queries found the marker on all 100 pages. |
| Print-preview preparation | 301.1 ms; 317.3 ms; 358.8 ms | Prepare the 10-sheet print PDF and render its first `256×363` preview sheet; no OS print submission. |
| Three open/render/close cycles | 800.7 ms; 806.6 ms; 817.6 ms total | Per smoke invocation, for all three cycles together. |

Windows process memory is the **sum of the launched app process and its descendants**, not the Node worker's RSS. The smoke test records point-in-time working-set/private-byte snapshots (5–6 processes); these are not peak-memory or idle-CPU measurements.

| Snapshot | Working set (MiB) | Private bytes (MiB) |
| --- | ---: | ---: |
| Settled welcome-screen idle | 268.8–301.4 | 105.1–110.8 |
| After the 10-page sample first render | 332.4–356.1 | 143.4–148.3 |
| After print preview was closed | 384.4–407.3 | 155.2–165.8 |
| After the first and repeat 100-page searches | 350.5–380.3 | 155.3–157.2 |
| After three document cycles, viewer closed | 355.8–379.6 | 155.8–157.8 |

These are single snapshots on one virtualized Windows runner, not a long-session leak study; the post-cycle footprint remains above the welcome-screen reading, which alone does not establish a leak. Startup was measured once per packaging mode and includes harness attachment overhead; no stable cold-start/visible-window latency is claimed. The build remains Electron 28.3.3 (Chromium 120); updating the end-of-life runtime was outside Phase 8.

**CI artifacts:** [Windows installer and portable executables (`cambuz-pdf-windows-x64`)](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38019417062/artifacts/11657780653) and [Windows smoke-test evidence (`smoke-test-evidence-windows-x64`)](https://github.com/pixldotcom/cambuz-pdf/actions/runs/38019417062/artifacts/11657463439). The evidence artifact contains the smoke reports, logs and screenshots. Artifacts follow the repository's GitHub Actions retention policy.

### Regression coverage and limits

- `npm test` runs the full Phase 2–8 and sample/context-menu/text-selection/main-process suite. The new `test:phase8` checks extreme canvas dimensions, pixel/entry LRU accounting, stale-search invalidation, lazy thumbnail rendering, the scroll fallback, cancellation/cleanup in both thumbnail views, overlapping document loads (a delayed stale fetch cannot replace a newer committed PDF), and a real ten-page PDF through rapid navigation, repeated zoom, bounded viewer output, and close cleanup.
- The existing suite continues to cover Unicode extraction/search and selection/copy for Hindi, Punjabi, mixed scripts and other Indian languages; print-PDF preparation; forms; password protection and permissions; page operations; OCR UI/input bounds; sample buttons; and context menus. OCR quality checks are skipped when Tesseract/language packs are absent.
- **Still unmeasured:** idle CPU, peak native memory, reliable window-paint/cold-start latency (the launch observations include DevTools attachment and vary widely), actual OS printer enumeration/submission/output, and a long-session app-level leak curve. The packaged memory snapshots are process-tree working-set/private-byte samples on one virtualized Windows runner, not RSS or proof that memory is returned to the OS.
- **Separate Node/PDF.js raster failure remains unresolved.** The Linux benchmark parses the four-page scanned fixture and obtains its operator lists, which contain a `2481×3508` image XObject per page. A direct `@napi-rs/canvas` `loadImage()` and scaled `drawImage()` of the image succeed in an isolated Node child process, but the PDF.js `page.render()` path segfaults (exit 139). The fault in that PDF.js/Node-canvas render path has not been identified or fixed; the benchmark deliberately records raster timings as `n/a`. This does not contradict the successful scanned-PDF rendering in packaged Windows Electron—the two execution paths differ. Do not interpret `n/a` as a zero-time render or claim the Node failure is resolved.
- `node scripts/stage-app.mjs` stages the runtime tree at **21.4 MiB uncompressed**; that is not an ASAR or installer size. The latest successful CI build measured the Windows `app.asar` at **19.1 MiB** and built all three desktop targets. The local sandbox still lacks the Electron runtime, so native builds and runtime checks were performed on CI. No dependency upgrade was made for Phase 8.

Re-run the Node benchmark with `PHASE8_BENCH_TRIALS=3 npm run benchmark:phase8`; run the focused regression checks with `npm run test:phase8`; the benchmark has no timing pass/fail thresholds. Packaged Electron validation is documented above and is run by the `Desktop builds` workflow.

## Desktop packaging — Windows x64 build (Phase 9 groundwork)

> Historical note: this section records the pre–Phase 8 packaging audit and
> groundwork. The current source of truth is the
> [Phase 9 section](#phase-9--packaging-and-distribution) above, which resolves
> the Electron, icon, licensing, file-association, and runtime-dependency items
> listed here as open.

### Packaging status: `WINDOWS X64 INSTALLER AND PORTABLE BUILT AND SMOKE-TESTED IN CI; LINUX AND macOS EXPERIMENTAL; UNSIGNED; NOT RELEASED`

Packaging was audited before Phase 8. The work added electron-builder configuration,
a staging script, a package contents checker, a runtime smoke test and a CI
workflow. A follow-up fix changed runtime code for the sample buttons and for
text selection (see *Sample buttons and text selection* below). Phase 8 preserves
that packaging setup; Windows native-runtime measurements and their limits are
recorded in the Phase 8 section above.

| Target | Command | Output in `dist/` | Verified in CI (`Desktop builds`) |
| --- | --- | --- | --- |
| Windows x64 | `npm run build:win` | `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` (NSIS installer); `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` (single file); `win-unpacked/Cambuz PDF Reader.exe` | Built; silent install, smoke test of the installed app, and silent uninstall passed; smoke tests of the unpacked and portable builds passed |
| Linux x64 | `npm run build:linux` | `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage`; `linux-unpacked/cambuz-pdf-reader` | Built; smoke test of the unpacked build under Xvfb passed (with `--no-sandbox`); the AppImage itself was not launched |
| macOS arm64 | `npm run build:mac` | `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg`; `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | Built and contents verified; not launched; unsigned and not notarized |

Measured sizes and digests are listed under *Measured sizes* below. The renderer
payload (`app.asar`) is 19.1 MiB; most of each installer is Electron's own runtime.

Artifact formats: Windows NSIS installer (per-user by default, can change the install
folder, Start-menu shortcut, uninstaller) and a portable executable
that extracts itself at launch; Linux AppImage; macOS DMG and ZIP containing an
unsigned `.app`. Each job uploads `SHA256SUMS.txt` next to the files.

#### Building locally

```bash
npm ci              # downloads the Electron runtime for your OS
npm run build:win   # or build:linux / build:mac on the matching OS
```

Packaging needs the Electron runtime download, which restricted networks may
block; `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` is enough for the tests but not
for packaging. Always build through the `build:*` scripts. They run
`scripts/stage-app.mjs` first (see *How the package is built*).

Checks that can be run on a build:

```bash
node scripts/check-packaged-app.mjs dist/win-unpacked/resources/app.asar
npm run test:packaged -- --app "dist/win-unpacked/Cambuz PDF Reader.exe" --out smoke-test-output
```

`check-packaged-app.mjs` reads the asar header and fails if a required renderer
file is missing or if development-only payloads (tests, scripts, the Electron
toolchain, the Node-only `@napi-rs/canvas` binding, source maps, PDF.js legacy
and viewer builds) were packaged. `test:packaged` starts the executable with
Chromium's remote-debugging port and drives the real window over the DevTools
protocol. It checks the title and the preload bridge; both welcome-screen sample
buttons; a drop-open of `samples/cambuz-demo.pdf`; the canvas, the text layer, its
alignment with the page and what the pointer hits; real mouse selection and
Ctrl+C (with the Windows clipboard on Windows); Hindi and Punjabi selection and
copy; and the refusal for a document that denies copying. It writes a screenshot,
the app log and a JSON report. Mouse and keyboard input go through the DevTools
Input domain, the same path a user's input takes. The test cannot see the native
right-click menu, so that still needs a manual check.

`npm test` also covers the bundled-sample list, the right-click menu template, the
page status text, and the main-process and preload code, which it loads against a
stand-in for the `electron` module.

#### How the package is built

- `scripts/stage-app.mjs` copies only the runtime files (`main.js`, `preload.js`,
  `src/`, two sample PDFs) to `.build-app/` and installs production dependencies
  from the lockfile with `--omit=dev --omit=optional --ignore-scripts`. It then
  removes the PDF.js legacy, viewer and typings folders and all source maps. The
  result is about 21 MiB on disk before compression.
- electron-builder packages `.build-app/` (`directories.app`), not the project
  root. This matters: during an early build that packaged the project root,
  electron-builder rewrote the project's own `package.json` and removed its
  `scripts`, `devDependencies` and `build` sections; later builds then silently
  used default settings. Packaging the staged copy keeps the project file
  untouched. Check `git status` after any packaging run.
- `@napi-rs/canvas` is pulled in by `pdfjs-dist` as an optional dependency. It is
  a Node-only native binding (roughly 37 MiB unpacked for win32 x64), and the
  renderer never loads it, so the staged build leaves it out.
- `productName` is `Cambuz PDF Reader` both in `build` and in `package.json`, so
  the packaged app and `npm start` use the same name. Consequence: the
  per-user data folder for `npm start` is now `Cambuz PDF Reader`, not
  `cambuz-pdf`, and recent-file entries from earlier development runs do not
  carry over.

#### Continuous integration

`.github/workflows/desktop-build.yml` runs on pushes and pull requests that change
files other than Markdown:

- `test` (Ubuntu): `npm test` — the regression suites must pass first.
- `windows-x64` (gating, Windows Server): build; verify packaged contents; write
  `SHA256SUMS.txt`; upload `cambuz-pdf-windows-x64` *before* any runtime check;
  smoke-test the unpacked build; install the NSIS installer silently into a temp
  folder, smoke-test the installed app, uninstall silently and confirm removal;
  smoke-test the portable executable; upload `smoke-test-evidence-windows-x64`.
- `linux-x64` (experimental, `continue-on-error`): AppImage build; verify
  contents; checksums; upload; smoke test of the unpacked build under Xvfb.
- `macos-arm64` (experimental): DMG and ZIP build; verify contents; checksums;
  upload. No runtime test yet.

Each smoke run publishes a summary annotation listing every check; Windows runs
also publish a separate, concise native-measurement annotation. Failing checks
receive error annotations. The run's step summary holds the results table, so
checks can be reviewed without downloading evidence. Builds are unsigned:
`CSC_IDENTITY_AUTO_DISCOVERY=false` stops electron-builder from searching for a
signing identity.

#### Sample buttons and text selection (follow-up to the first Windows test)

**Sample buttons.** Both buttons requested `/samples/…` with `fetch()`. Packaged
builds load the page from `file://`, where that path resolves to the file-system
root, so the request failed (`ERR_FILE_NOT_FOUND` in CI). The Electron build now
asks the main process for the bundled sample over a `read-sample` channel. That
channel accepts only the names on the bundled-sample list
(`src/bundled-samples.cjs`), which the staging script and the packaged-contents
check also use. The browser preview still fetches the sample, relative to the
renderer module (`../samples/…`), so the path does not depend on the server's root.

**Text selection.** The PDF.js 4.10 text-layer code, the stacking, the CSS, the
event handlers and the copy path were checked. Findings:

| Area | Finding |
| --- | --- |
| PDF.js text layer | Spans are placed as percentages of the page size, and the layer is sized from `--scale-factor`, which the renderer sets. Layer setup is correct. |
| Stacking and canvas | The text layer (z-index 2) sits above the canvas (z-index 1) and is what the pointer hits. |
| CSS | `html, body` set `user-select: none` and `.textLayer` sets `user-select: text`. Selection works with that combination. |
| Event handlers | No global mouse, selection or copy handler blocks input. Ctrl+C is not intercepted, and Ctrl+A selects the page text. |
| Copy permission | **The only code path that disables selection.** When a PDF's permissions deny copying (Phase 5), the text layer gets `no-copy`, which applies `user-select: none`. Before this change the only cue was a small lock chip in the status bar. |
| Scanned pages | A page with no text layer has nothing to select. OCR is a separate optional feature and its result is not added to the text layer. |

What was verified:

- Ordinary text PDFs (the English, Hindi, Punjabi, Tamil and multilingual samples): a real
  mouse drag selects multi-line text, Ctrl+C fires the copy event with that text,
  and the Hindi and Punjabi selections are Unicode. Checked in headless Chromium
  119, 121 and 153, and on a `file://` page.
- Alignment: the layer matches the canvas size and position, and spans sit over
  painted glyphs, at 100%, 125% and 150% scale.
- Packaged builds, through the smoke test: both sample buttons and the form sample
  fields, selection, Ctrl+C, the Windows clipboard, Hindi and Punjabi copy, and the
  copy-denied refusal. Checked on the Windows installed, unpacked and portable
  builds and on the Linux unpacked build under Xvfb.

The status bar now says why a page cannot be selected: *copying not allowed by this
document*, or *no selectable text on this page (scanned image?)*. Right-click on a
page offers Copy and Select All Text on Page. In a text field it offers the
standard editing commands.

#### Known limitations and blockers before a public release

> **Historical (written before Phase 9; kept for the record).** Items 1 (Electron end-of-life), 4 (file association), 5 (icon), 6 (licence) and 7 (`express`) were resolved in Phase 9. Item 10's missing macOS app menu and Edit roles were addressed in Phase 10 (code only; not verified in a running macOS app). Items 2 (unsigned), 3 (copy restriction), 8 (app ID and publisher) and 9 (Linux sandbox) remain open. The current limitations are in [Phase 10](#phase-10--release-quality-and-final-readiness).

1. **Electron 28.3.3 is end-of-life.** Electron supports only its three latest
   stable major versions ([endoflife.date](https://endoflife.date/electron)). The
   npm registry lists 44.7.0 as the current release. This is the largest release
   risk: the shipped runtime (Chromium 120) no longer receives security fixes.
   Moving to a supported major changes APIs and needs a full regression pass
   (printing, dialogs, menus, file handling). It was not attempted here.
2. **Unsigned builds.** Windows SmartScreen may warn about the installer, and
   macOS Gatekeeper will not open an unsigned, un-notarized download without a
   manual override. A code-signing certificate (Windows) and a Developer ID
   signature with notarization (macOS) are needed for distribution. No
   certificates or secrets were available.
3. **Copying can be turned off by the PDF itself.** When a document's permissions
   deny copying, Cambuz keeps that restriction (Phase 5). Its text then cannot be
   selected or copied, and the status bar says so. Whether Cambuz should honour
   that flag at all is a product decision that has not been made. The options are
   to keep the restriction, or to ignore it.
   Scanned pages have no text layer, so they cannot be selected either.
   OCR results are shown in a separate box and are not added to the text layer.
4. **No PDF file association and no open-with handling.** `main.js` does not read
   `process.argv`, and there is no `second-instance` or `open-file` handling, so
   launching the app with a PDF path would not open it. Phase 9's `.pdf`
   association should wait until that is implemented.
5. **No application icon.** `main.js` points at `assets/icon.png`, which does not
   exist, and there is no `.ico` or `.icns`; builds use Electron's default icon.
6. **No LICENSE file.** `package.json` declares MIT, but the repository has no
   license text. The packaged app contains third-party code (Electron, PDF.js,
   pdf-lib and their dependencies); their notices must ship with it. Electron's
   license text is already copied into each Windows install folder.
7. **Unused runtime dependency.** `express` is listed under `dependencies` but is
   only used by the `npm run serve` preview. It is packaged (a small share of the
   app payload). Moving it to `devDependencies` is a Phase 9 cleanup.
8. **Identifiers still to confirm:** the application ID `com.cambuz.pdfreader`
   and the publisher name. The ID is permanent once users install the app.
9. **Linux sandbox.** The CI smoke test passes `--no-sandbox`, because
   unprivileged user namespaces are restricted on the runner. An AppImage on a
   desktop distribution with the same restriction may need the same flag or an
   AppArmor profile; that was not tested.
10. **macOS** is arm64-only, its menu template has no macOS application menu
    (no `appMenu` role), and the build was never launched.

#### Measured sizes

From the latest successful `Desktop builds` run, `38019417062`, on commit
`cb68803` (the `Build output` annotations of each job):

| File | Size | SHA-256 |
| --- | --- | --- |
| `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` | 81.6 MiB | `0e46e2bf2760203321b16c5eb931920edbe2b92c2252314cede015029ce4e16c` |
| `Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe` | 81.4 MiB | `881540647796c3bdaa24cbc1fcc25b4c5b2c6365b3ba49a2cc671cc797c18bf0` |
| `Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage` | 105.5 MiB | `63e520a388162e805a8980200c6ac927a62c28a05b329c452feca422ed332a9d` |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg` | 96.7 MiB | `39ea0a0a4d2998c767e7a0066272c53000487378036e249fd03d0e7d488ae0e2` |
| `Cambuz-PDF-Reader-1.1.0-mac-arm64.zip` | 93.3 MiB | `4a7d4dcec303629090200a9ab655dae25d131a98f3a4450c91e8caba7b65f2d8` |
| `app.asar` inside the Windows build (renderer payload) | 19.1 MiB | - |

Digests identify one build, not one commit. The AppImage digest changed between
runs `0341f52` and `bf2b525` although the packaging inputs were identical (only a
comment in `scripts/stage-app.mjs` changed), so builds are not reproducible
bit-for-bit. Verify a download against the `SHA256SUMS.txt` in the same run's
artifact.

---

## Phase 7 — Optional OCR

### Phase 7 status: `OPTIONAL LOCAL OCR IMPLEMENTED; NATIVE DESKTOP CHECK PENDING`

OCR is an explicit, optional action for the **current page**. The reader never
starts OCR automatically. In the desktop app, the OCR dialog checks for a local
Tesseract 4+ command and the language data installed on the machine; a user must
choose one to three installed languages and press **Recognize current page**.
The page is rasterized locally (up to 300 dpi, bounded at 8,000 pixels per side
and 16 megapixels) and passed to the local `tesseract` executable through a
restricted Electron IPC bridge. The image is limited to 20 MiB and an OCR
operation is stopped after two minutes.

Recognized text is displayed in a separate selectable OCR result box, labelled
with page, language and engine version. It is **not embedded in the source PDF,
not merged into PDF.js's native text layer, and not included in normal document
search or printing**. Users can select/copy the OCR result from its box. OCR is
unavailable when document permissions deny copying, matching the existing
Phase 5 restriction. Results are temporary and are not stored or uploaded.

The desktop OCR adapter is separate from PDF.js text extraction and uses only
Node's built-in `child_process`/filesystem APIs. No OCR executable, traineddata,
new npm runtime dependency, auto-download or network service is bundled. Web
preview mode explains that it cannot access the desktop OCR engine.

**Languages:** `eng`, `hin`, `pan`, `urd`, `ben`, `guj`, `mar`, `tam`, `tel`,
`kan`, `mal`, `ori` and `asm` (English, Hindi, Punjabi, Urdu, Bengali, Gujarati,
Marathi, Tamil, Telugu, Kannada, Malayalam, Odia and Assamese). Only languages
reported by the local engine are selectable. Indic recognition quality depends
on the separately installed model, scan quality, layout and script; the list
is an available-engine matrix, not a guarantee of perfect recognition.

### Installing the optional OCR engine

Cambuz does not install or download Tesseract. Install a trusted Tesseract 4 or
newer build separately, include the language data you need, and make the
`tesseract` executable available on `PATH`. In a new terminal,
`tesseract --version` should report version 4 or newer and
`tesseract --list-langs` should list selected codes such as `eng`, `hin`,
`pan` or `urd`. Restart Cambuz after changing PATH or language data, open a PDF,
choose **OCR**, and use **Check OCR again** to refresh the detected language
packs. On Windows, use a trusted Windows Tesseract build and its language-data
selection; on Linux/macOS, use the distribution's package manager and review
that package's notices. Cambuz does not require network access while recognizing
text.

### Dependencies, licensing and size

- Cambuz adds **no Tesseract engine or model bytes** to the base package and
  adds no OCR npm dependency. The Electron main process calls the separately
  installed local CLI with a fixed argument list; it does not invoke a shell.
- Tesseract OCR is distributed upstream under Apache-2.0. Official upstream
  Tesseract language-data repositories also publish Apache-2.0 model data;
  downstream installers and third-party packs may have additional notices.
  Because Cambuz redistributes neither, users should review the license and
  notices for the engine/model packages they choose.
- The actual installed size of a native engine plus selected language models
  varies by platform, build and models. It was **not measured here** because no
  native OCR package is installed. The project has no completed installer in
  this checkout, so an installer-size delta cannot be reported; the base app
  includes no OCR binary or traineddata. The checked-in scanned PDF is a small
  327 KiB test/sample asset, not an application runtime dependency.

### Phase 7 verification and limitations

- `npm run samples:phase7` generates `samples/phase7-scanned.pdf`, a four-page
  image-only sample (English, Hindi, Punjabi and Urdu), plus the corresponding
  raster PNG fixtures used by quality tests. PDF.js confirms all four pages
  contain no native selectable text.
- `npm run test:phase7` — **54 passed, 0 failed, 2 skipped** in the default
  sandbox because no native Tesseract executable is installed. Through the
  same `execFile` adapter, a temporary Tesseract-compatible shim backed by
  Tesseract.js 7 WebAssembly plus `eng`/`hin`/`pan`/`urd` data completed **58
  passed, 0 failed, 0 skipped**; the English, Hindi, Punjabi and Urdu scan
  assertions exercised actual recognition output. No shim or OCR package is
  checked in or added to the application dependencies.
- `npm test` — **920 passed, 0 failed, 2 skipped** across the Phase 2–7 suites.
- **Still not verified here:** the native Tesseract executable itself, actual
  Electron IPC/window launch, Windows packaging, and a Windows UI session. The
  WebAssembly adapter check validates the same OCR call contract and controlled
  scan quality, but is not a native-CLI or Windows integration test.
- OCR is current-page-only and does not create a searchable PDF. Whole-document
  OCR, OCR-layer export, progress/cancel controls, handwriting, tables and
  automatic orientation correction remain out of scope. The native engine and
  language packages still need functional verification on a Windows desktop.

---

## Phase 6 — Indian Language Excellence

### Phase 6 status: `FIXTURES + AUTOMATED COMPATIBILITY TESTS PASS; DEVICE CHECKS PENDING`

Phase 6 preserves Phases 1–5 and adds a language compatibility suite that
checks text extraction and app behavior as well as visible rendering. The
main fixture has 16 pages: a cover, separate English and target
language pages, a mixed-script page and combining-mark/conjunct stress page.
Two one-page Tamil companions separately check visible text painted from an
embedded Noto font and missing-font fallback while retaining the Unicode map.

Each language row below is tested against its real PDF.js page for exact sample
text, two search hits, text-layer selection, a serialized clipboard payload,
visible PDF.js raster output, and logical text/search after print-PDF assembly.
"Clipboard payload" is emulated from the browser `Selection` in jsdom; it is not
an OS clipboard test. The print test rebuilds and reopens Cambuz's vector
print-ready PDF; it does not send pages to a physical printer.

| Language | Script / direction | Fixture page | Search query |
|---|---|---:|---|
| English | Latin, LTR | 2 | `LANGKEY` |
| Hindi | Devanagari, LTR | 3 | `नमूना` |
| Punjabi | Gurmukhi, LTR | 4 | `ਕੁੰਜੀ` |
| Bengali | Bengali, LTR | 5 | `কীচিহ্ন` |
| Gujarati | Gujarati, LTR | 6 | `કસોટી` |
| Marathi | Devanagari, LTR | 7 | `चिन्ह` |
| Tamil | Tamil, LTR | 8 | `குறி` |
| Telugu | Telugu, LTR | 9 | `సంకేతం` |
| Kannada | Kannada, LTR | 10 | `ಗುರುತು` |
| Malayalam | Malayalam, LTR | 11 | `കുറി` |
| Odia | Odia, LTR | 12 | `ଚିହ୍ନ` |
| Assamese | Bengali script, LTR | 13 | `চাবি` |
| Urdu | Arabic/Nastaliq, RTL | 14 | `کلید` |

**Additional cases:** page 15 combines the English and all twelve target
languages (including a separate RTL Urdu run); page 16 exercises Devanagari
NFC/NFD nukta spellings, conjuncts, Gurmukhi/Bengali combining sequences and
Urdu marks. A synthetic DOM case also splits the Hindi conjunct `क्षत्रिय`
across four PDF.js text items and verifies search, highlighting and clear.
The embedded-font Tamil companion exercises PDF.js's visible font-painting path;
the missing-font fixture verifies retained extraction/search and that the
fallback render path completes in this Node environment.

### Phase 6 verification

- `npm run test:phase6` — **229 assertions, all passing**. It uses the real
  `SearchController`, PDF.js `TextLayer`, PDF.js extraction/rasterization,
  `@napi-rs/canvas`, and the production `buildPrintPdf` path.
- Before Phase 7, the Phase 2–6 regression suites totaled 866 assertions
  (123 + 59 + 54 + 133 + 268 + 229). The current combined Phase 2–7 result is
  reported in the Phase 7 section above.
- `npm run samples:phase6` regenerates all three PDFs. Generation requires the
  development Noto font packages plus Python `fpdf2`, `uharfbuzz`, `fonttools`
  and `pypdf` (installation instructions below).
- **Not verified here:** native OS clipboard integration, browser/Electron
  rendering beyond PDF.js in Node, Electron's native print route, and physical
  printer output. Those still need the manual Windows/browser checks below.

### Phase 6 known limitations

- These are controlled fixtures, not a guarantee for every PDF exporter,
  Unicode map, font program, language variety or shaping convention. Real PDFs
  may have incomplete or incorrect `/ToUnicode` or `/ActualText`; the reader
  cannot infer source text that a file does not encode.
- The sample text has been shaped with Noto font data and its visible forms are
  embedded as vector outlines, with a separate Unicode text layer. That gives
  reliable fixture rendering/extraction, but it is not a substitute for testing
  arbitrary embedded fonts in target browsers and Windows/Electron.
- Tamil missing-font coverage confirms logical text and generic fallback
  execution only. The sandbox has no guaranteed Tamil system font, so it cannot
  certify the legibility or correctness of fallback glyph shapes on a user's
  machine.
- Urdu extraction, `dir="rtl"`, selection, search and print-PDF text are
  verified. The fixture keeps Urdu as a dedicated RTL run; mixed-direction
  Latin and Urdu within the *same* text run and broader bidi punctuation/layout
  cases are not covered. PDF.js bidi processing can reorder mixed-run text.
- Assamese uses Bengali script and the Bengali font; the fixture tests only the
  selected Assamese-specific characters, not full Assamese orthographic/font
  coverage. Marathi uses the Devanagari fixture font.
- The jsdom clipboard check verifies the selected Unicode string that a normal
  browser copy action serializes; it does not exercise the privileged OS
  clipboard or permission-enforcement UI. The physical printer and native
  driver output also remain untested in this sandbox.
- Search is NFC-normalized substring matching with case-insensitive Latin
  matching. It is not transliteration, stemming, locale-specific collation,
  diacritic-insensitive search, regex or whole-word search.

---

## Phase 5 — Implementation Status

### Phase 5 Status: `SECURITY AND FORMS IMPLEMENTED — TESTED`

Phase 5 adds **password-protected documents**, **PDF permission enforcement** and
**fillable PDF forms**. Reader, search, print and page-tool behaviour from
Phases 1–4 is unchanged.

| Requirement | Implementation |
|---|---|
| Password-protected PDFs | ✅ A prompt appears when a document needs one; the correct password opens it, a wrong one is reported and the document stays closed, Cancel leaves it locked |
| Encrypted PDFs | ✅ Readable once unlocked. Never decrypted to disk and never re-saved unprotected — page tools and "Save Filled Form…" stay unavailable while a document is encrypted |
| PDF permissions | ✅ All eight permission flags are read and listed in **Document Security…**; printing, copying, page changes and form filling are enforced in the UI |
| Basic PDF forms | ✅ Text (single/multi-line), check boxes, radio groups, drop-downs and list boxes are drawn as real HTML controls over the page |
| Form field interaction | ✅ Type, tick and choose directly on the page; filled/total counter, Reset, Tab navigation, per-field tooltips |
| Saving filled forms | ✅ **Save Filled Form…** writes a NEW copy (native dialog in Electron, download in the browser); read-only and unsupported fields are skipped and reported |
| Fail safely | ✅ Every refusal (encrypted, permission denied, unsupported field) shows a reason instead of doing nothing, and never works around the protection |

### How it behaves

- **Password prompt** — shown only when PDF.js reports a missing or incorrect
  password. The password is handed to PDF.js for that one document and is never
  stored, logged or written to disk.
- **Document Security…** (toolbar lock button, status-bar chip or
  `Ctrl+Shift+K`) lists every permission with *Allowed* / *Denied* and marks the
  four Cambuz enforces: printing, copying, changing the document, and filling in
  forms.
- **Enforcement** — printing, `Ctrl+A` select-all and clipboard copying are
  blocked when the document denies them; page tools stay disabled while a
  document is encrypted; form filling is unavailable while a document is
  encrypted or denies it. The text is still rendered and searchable.
- **Form filling** (`Ctrl+Shift+F`, toolbar *Forms*, File → Fill Form Fields)
  overlays real controls on the page at the exact field rectangles, at any zoom
  or rotation. Values live in memory until you save; **Save Filled Form…**
  writes a copy named `<document>-filled.pdf`. The file you opened is never
  modified.
- **Appearance streams** are rebuilt for the fields you change, so the values
  are visible in other viewers too.

### Implementation notes

- `src/pdf-security.js` — permission flags (PDF 32000-1 table 22), the security
  model, and classification of PDF.js password errors. DOM-free.
- `src/pdf-forms.js` — AcroForm reading and writing with pdf-lib: field types,
  options, flags, rectangles, per-field values, and a fill pass that returns new
  bytes. DOM-free.
- `src/pdf-password-ui.js` — the password prompt.
- `src/pdf-forms-ui.js` — the on-page overlay, the filling bar, Reset and Save.
- `src/pdf-security-ui.js` — the Document Security dialog and status-bar chip.
- `src/pdf-forms.css` and the new markup in `src/index.html`.
- `src/renderer.js` — the password retry loop, permission enforcement, the copy
  guard, `Ctrl+Shift+F` / `Ctrl+Shift+K`, and the unsaved-form-value guard.
- `src/printing.js` — encrypted documents are refused with a clear message
  instead of failing inside pdf-lib.
- `main.js` / `preload.js` — File → Fill Form Fields and File → Document
  Security…. Saving reuses the Phase 4 `save-pdf` IPC, so overwrite protection
  is unchanged.

### Phase 5 verification status

- `npm run test:phase5` — **268 assertions, all passing**:
  - **A (25)** the permission model: mask decoding, encrypted/unencrypted,
    every permission allowed/denied, status text, refusal messages, and
    classification of the *real* PDF.js password exceptions.
  - **B (35)** real encrypted fixtures opened with PDF.js: no password, wrong
    password, correct password, the permission flags of all four fixtures, and
    proof that refusals never touch the encrypted bytes.
  - **C (61)** AcroForm reading (types, options, flags, pages, rectangles),
    filling every supported type, verification of the saved PDF with **both**
    pdf-lib and PDF.js (including rebuilt appearance streams), clearing values,
    unknown options, control-character sanitising, dirty tracking, and the
    `samples/form-sample.pdf` sample.
  - **D (22)** the password dialog in jsdom: prompt, empty submit, Enter,
    Cancel, reveal toggle, re-entrancy, reset.
  - **E (58)** the form controller in jsdom against a real PDF.js viewport:
    control types and positions per page, typing, counters, reset, save,
    cancelled save, failed save, leave/re-enter, document swap, and every
    refusal path.
  - **F (15)** the Document Security dialog: unencrypted, fully locked and
    partially restricted documents, badges, enforced markers, status chip.
  - **G (52)** end-to-end through the real `renderer.js` in a DOM built from
    `src/index.html`: password prompt → wrong password → correct password →
    permissions applied, a permissions-only document (no prompt) refusing print
    and copy, a fully locked document, and filling + saving the sample form with
    `Ctrl+Shift+F`.
- Fixtures: `scripts/fixtures/secure-*.pdf` are real RC4-128 (V2/R3) encrypted
  PDFs generated with pypdf (`npm run samples:secure`; the password for the
  protected fixtures is `cambuz`). `scripts/fixtures/acroform-basic.pdf` is a
  two-page form with every supported field type plus a read-only field.
- **Not exercised:** the Electron desktop shell (no display or Electron binary
  in this sandbox), so the new File-menu entries, the native save dialog and the
  native print route are reviewed but untested at runtime. The web build is
  served by `npm run serve` for manual checks in a browser; this sandbox has no
  browser, so canvas rendering, the on-page look of the form controls and
  physical printing were **not** observed here and still need a human pass.
  Also untested: real-world forms from other producers, XFA/dynamic forms and
  signature fields.

### Known limitations (Phase 5)

- **Filled values are not printed.** A print job embeds the page graphics of the
  source document; widget annotations (form values) are not flattened into it.
  Save the filled form, open the saved copy and print that if you need the
  values on paper.
- **Encrypted documents are read-only.** Cambuz cannot write encrypted PDFs, so
  page tools, metadata editing and saving a filled form are unavailable while a
  document is encrypted. There is deliberately no "remove the password" action.
- **Appearance fonts.** Rebuilt appearances use the standard Helvetica
  (WinAnsi). Values outside that set (Devanagari, Gurmukhi, other scripts) are
  still saved and are always visible in Cambuz's own overlay, but some other
  viewers may only draw them once the field is focused.
- **Unsupported form features:** XFA/dynamic forms, signature fields, push
  buttons, JavaScript-driven fields, rich text, combo boxes with editable text,
  and multi-select lists (a list box takes a single selection). Such fields are
  listed in the overlay as read-only markers, never filled by guesswork.
- **Search stays available when copying is denied.** Extraction for
  accessibility is a separate permission; the clipboard is what gets blocked.
- **Password attempts are not rate-limited by Cambuz**; the limit is whatever
  the document's own encryption provides.

---

## Phase 4 — Implementation Status

### Phase 4 Status: `BASIC PDF UTILITIES IMPLEMENTED — TESTED`

Phase 4 adds a **Page Tools** dialog (toolbar *Pages* button, `Ctrl+Shift+E`,
or File → Page Tools…). It works on a **working copy in memory**: nothing on
disk changes until you choose **Save As**, and the original file is only
overwritten if you pick it as the destination and confirm the overwrite.
Reader features from Phases 1–3 are unchanged.

| Requirement | Implementation |
|---|---|
| Rotate pages | ✅ ↺/↻ 90° on selected pages (adds to any existing `/Rotate`) |
| Delete pages | ✅ Confirmation prompt; refuses to delete every page; Delete key |
| Extract pages | ✅ "Extract selected" keeps only the selected pages (working copy); confirmation prompt |
| Reorder pages | ✅ Move up / Move down for one or more selected pages |
| Merge PDFs | ✅ "Merge PDF…" appends all pages of chosen files to the working copy |
| Split PDFs | ✅ `1-3; 4-6` or `every N`; each part saved as `<name>-part-N.pdf`; working copy unchanged |
| Save As | ✅ Native save dialog (Electron) or download (browser); reopens the saved file |
| Duplicate document | ✅ Saves an identical copy of the file as it is on disk (unsaved edits excluded) |
| Basic metadata | ✅ Title, author, subject, keywords (Info dictionary); creator/producer shown read-only |
| Undo | ✅ Up to 20 steps until the document is closed; Discard changes restores the file as opened |
| Protect the original | ✅ Save As never replaces the original without an explicit extra confirmation; writes go to a temporary file first, then rename |
| Unsaved-change guard | ✅ Confirmation before opening/closing another file; window close asks in the desktop app and browser |
| Encrypted PDFs | ✅ Refused with a clear message — Phase 5 can *read* them with a password, but never edits or re-saves them |

### Implementation notes

- `src/pdf-ops.js` — DOM-free operations built on `pdf-lib`. Each function returns
  new bytes; the input is never mutated. Reorder, delete and extract work on the
  same document's page tree, so the outline, named destinations and document
  metadata survive them.
- `src/pdf-ops-ui.js` — the dialog controller (thumbnails with PDF.js, selection,
  undo history, confirmations, Save As / Duplicate / split saving).
- `src/pdf-ops.css`, plus the dialog markup in `src/index.html`.
- `main.js` / `preload.js` — `save-pdf` (single file, native dialog, overwrite
  confirmation for existing files and the original), `save-pdf-files` (split into
  a chosen folder, one batch confirmation for conflicts), `dialog-open-pdfs`
  (merge picker), and a `will-prevent-unload` prompt for unsaved edits.
- Browser builds save through downloads; split downloads each part in turn, so
  the browser may ask permission to download several files.

### Phase 4 verification status

- `npm run test:phase4` — 133 assertions. Covers every operation on generated
  PDFs and the samples: page order and count (checked by reopening output with
  PDF.js), rotation placement, invalid input, encrypted-file refusal (fixture at
  `scripts/fixtures/encrypted-password.pdf`), split plan parsing, metadata, Unicode
  merge (Hindi), and the dialog controller in jsdom (confirmations, undo, Save As,
  duplicate, split, cancel, overwrite reporting).
- Browser run (headless Chromium against `npm run serve`, 33 checks): opening
  with the keyboard shortcut, thumbnails, selection, rotate, undo, delete
  confirmation, Save As download and reopen, split downloads, merge through a
  file chooser, metadata, the unsaved-change prompt, Duplicate, and Discard. The
  downloaded files were checked with `pdf-lib` (page counts, rotation, the
  original left unchanged on disk).
- **Not exercised:** the Electron desktop shell itself (no display or Electron
  binary in this sandbox). The native Save/Open/folder dialogs, overwrite
  prompts and the window-close prompt in `main.js` are reviewed but untested
  at runtime. Verify them on Windows before release.

### Known limitations (Phase 4)

- Merge and split copy pages into new documents; outline/bookmarks, form fields
  (AcroForm) and annotations are not carried over in those operations and were not verified.
- Deleting or extracting pages can leave outline entries that point at removed pages.
- Metadata editing covers the Info dictionary only (not XMP).
- Undo history is kept in memory for the open document only.
- Encrypted or password-protected PDFs cannot be edited or saved as a filled form (Phase 5 reads them with a password; writing encrypted PDFs is not supported).

---

## Phase 3 — Implementation Status

### Phase 3 Status: `PRINT WORKFLOW IMPLEMENTED — HARDWARE TEST PENDING`

Phase 1 and Phase 2 reading features are preserved. Phase 3 adds a print
workflow that composes the chosen pages into a print-ready PDF before output.
The preview is rendered from that exact PDF, so its page selection, paper
size, margins, scaling, orientation and N-up layout match the file sent to
Electron's native print API.

| Requirement | Implementation |
|---|---|
| Print current page / all pages / selected pages | ✅ Radio choices and validated page lists/ranges |
| Page range validation | ✅ Bounds, syntax, descending ranges and duplicates rejected |
| Printer selection | ✅ Electron printer list, default printer, refresh and system-dialog fallback |
| Copies | ✅ 1–99 copies; passed to native printer or browser dialog |
| Portrait / landscape | ✅ Output paper media box and native printer settings aligned |
| Paper sizes | ✅ A4, A3, A5, Letter, Legal and Tabloid |
| Fit / actual / custom scaling | ✅ Applied in the generated print PDF |
| Margins | ✅ None, narrow, normal, wide and custom (0–50 mm) |
| Multiple pages per sheet | ✅ 1, 2 or 4; clipped to each sheet cell |
| Print preview | ✅ PDF.js preview of the composed output PDF |
| Ink Saver preset | ✅ Grayscale raster output, capped at 200 dpi / 18 megapixels per page |
| Native Windows printing | ✅ Electron printer enumeration and `webContents.print` route implemented |
| Browser print fallback | ✅ Opens the same print-ready PDF in the system PDF/print flow |
| Actual physical printer test | ⏳ Not available in this sandbox; verify on Windows with a configured printer |

Normal print jobs preserve the source PDF page content as vector content.
Ink Saver intentionally rasterizes each page in grayscale at print resolution.
The print-ready PDF can also be downloaded for external printer testing.

### Phase 3 verification status

Automated tests cover page-range validation, paper dimensions, orientation,
1/2/4-up sheet counts and geometry, margins, scale modes, output PDF page
counts and media boxes, text preservation (including Hindi and Punjabi), PDF
page rotation, and Ink Saver output. The sandbox has no installed Electron
binary/display or physical printer, so the Windows native dialog and hardware
output were **not** exercised; this is not represented as a printer test.

---

## Phase 2 — Implementation Status

### Phase 2 Status: `PHASE 2 COMPLETE`

Phase 1 functionality is fully preserved. This section records the Phase 2
reading-experience milestone; printing was intentionally outside that
milestone and is implemented in the Phase 3 section above. PDF utilities,
forms, OCR, AI, cloud, accounts and telemetry remain outside scope.

### Features Implemented

| Requirement | Status |
|---|---|
| Page thumbnails (lazy, sidebar) | ✅ Implemented |
| Document outline / bookmarks | ✅ Implemented |
| Search within PDF (Unicode) | ✅ Implemented |
| Search result highlighting | ✅ Implemented |
| Text selection (text layer) | ✅ Implemented |
| Copy text | ✅ Implemented |
| Select all (page) | ✅ Implemented |
| Keyboard shortcuts (extended) | ✅ Implemented |
| Recent files | ✅ Implemented |
| Reopen last document | ✅ Implemented |
| Full-screen reading | ✅ Implemented |
| Page rotation (90° steps) | ✅ Implemented |
| Status information (page/zoom/rotation/size) | ✅ Implemented |
| Better keyboard navigation | ✅ Implemented |
| Shortcuts help dialog | ✅ Implemented |

### Technology Deltas (Phase 2)

| Area | Choice |
|---|---|
| **Text selection** | PDF.js `TextLayer` overlay on the page canvas |
| **Search** | Per-page `getTextContent` index, NFC + case-fold matching, DOM highlight marks |
| **Thumbnails** | Small-scale canvas renders with `IntersectionObserver` lazy loading |
| **Outline** | `getOutline()` with named-destination resolution |
| **Recents** | `localStorage` metadata + `IndexedDB` byte cache (web) / native paths (Electron) |
| **Rotation** | `getViewport({ rotation })` re-render, thumbnails refreshed |
| **Full screen** | Fullscreen API (`F11` / toolbar) |

### Dependencies

Phases 2 and 6 add development dependencies for Unicode fixtures and PDF.js
raster tests. Phase 3 adds `pdf-lib` as a runtime dependency to compose the
vector-preserving print PDF; the web preview also uses `express`.

| Package | Version | Purpose | Runtime? |
|---|---|---|---|
| `pdfjs-dist` | ^4.0.379 | PDF rendering engine | Yes |
| `express` | ^4.18.2 | Web server for preview mode | Yes (preview) |
| `electron` | ^28.0.0 | Desktop application shell (dev) | App shell |
| `pdf-lib` | ^1.17.1 | Vector-preserving print PDF composition (also used by sample generator) | Yes |
| `@pdf-lib/fontkit` | ^1.1.1 | Custom-font support experiments (dev) | No |
| `@expo-google-fonts/noto-sans-devanagari` | ^0.4.1 | Noto Devanagari TTF for samples (dev) | No |
| `@expo-google-fonts/noto-sans-gurmukhi` | ^0.4.1 | Noto Gurmukhi TTF for samples (dev) | No |
| `@expo-google-fonts/noto-*` | versions in `package.json` | Noto Bengali, Gujarati, Tamil, Telugu, Kannada, Malayalam, Odia and Urdu TTFs (dev) | No |
| `@napi-rs/canvas` | ^1.0.10 | Node-side PDF.js raster assertions (dev) | No |
| `jsdom` | ^30.1.2 | DOM-level automated tests (dev) | No |
| `fpdf2` + `uharfbuzz` + `fonttools` + `pypdf` (pip) | — | Shaped/extracted Unicode fixtures (dev) | No |

### Installation

```bash
# Clone the repository
git clone https://github.com/pixldotcom/cambuz-pdf.git
cd cambuz-pdf

# Install dependencies (the Electron postinstall downloads the desktop runtime)
npm install

# In a restricted sandbox, npm install --ignore-scripts still enables the
# web preview and automated tests, but not npm start / native printing.

# Optional: needed only to regenerate the Unicode sample PDFs
pip install fpdf2 uharfbuzz fonttools pypdf

# Regenerate Phase 6 multilingual and missing-font fixtures
npm run samples:phase6

# Generate the Phase 7 raster-only English/Hindi/Punjabi/Urdu OCR sample
npm run samples:phase7

# Optional: needed only to regenerate the Phase 5 encrypted fixtures
pip install pypdf

# Run as web application (for preview/testing)
npm run serve

# Run as desktop application (requires Electron)
npm start

# Generate all sample PDFs (basic + Unicode)
npm run samples

# Generate the Phase 5 fixtures (encrypted PDFs need pypdf)
npm run samples:secure

# Run the automated test suites (Phase 2–7 regression and OCR tests)
npm test
```

### Development Commands

| Command | Description |
|---|---|
| `npm run serve` | Start web server on port 3000 |
| `npm start` | Launch Electron desktop app |
| `npm run samples` | Generate all sample PDFs (JS + Python) |
| `npm run samples:js` | Generate basic samples only |
| `npm run samples:unicode` | Generate Unicode samples only (needs fpdf2) |
| `npm run samples:secure` | Generate Phase 5 fixtures (JS + Python, needs pypdf) |
| `npm run samples:phase6` | Generate multilingual, embedded-font and missing-font fixtures (Python + Noto dev fonts) |
| `npm run samples:phase7` | Generate a raster-only English/Hindi/Punjabi/Urdu OCR sample and PNG test images |
| `npm test` | Run the complete Phase 2–7 regression, language and optional OCR suites |
| `npm run test:node` | Run PDF/extraction/search/outline tests |
| `npm run test:dom` | Run DOM tests (highlight/outline/recents/wiring) |
| `npm run test:phase3` | Run print-range, layout, PDF-output and Ink Saver tests |
| `npm run test:phase4` | Run page operation, merge/split, metadata and page-tools dialog tests |
| `npm run test:phase5` | Run password, permission, AcroForm, password-dialog, form-filling and security-dialog tests |
| `npm run test:phase6` | Run extraction, grapheme-safe search, selection/copy-payload, rendering, missing-font and print-PDF tests across English and twelve target languages |
| `npm run test:phase7` | Test OCR input safety, page rasterization, scanned-PDF text separation, optional-engine detection, permissions and real OCR quality when Tesseract/model packs are installed |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF |
| `Ctrl+W` | Close PDF (desktop) |
| `Ctrl+P` | Open print preview |
| `Ctrl+F` | Search in document |
| `Enter` / `Shift+Enter` | Next / previous match |
| `F3` / `Shift+F3` | Next / previous match |
| `Esc` | Close search / dialog, exit full screen |
| `PageUp` / `PageDown` | Previous / Next page |
| `←` / `→` | Previous / next page |
| `Home` / `End` | First / Last page |
| `F9` | Toggle sidebar (thumbnails / bookmarks) |
| `Ctrl+Plus` / `Ctrl+Minus` | Zoom in / Zoom out |
| `Ctrl+0` | Fit page |
| `Ctrl+Shift+0` | Fit width |
| `R` / `Shift+R` | Rotate clockwise / counter-clockwise |
| `F11` | Toggle full screen |
| `Ctrl+A` | Select all text on page |
| `Ctrl+C` | Copy selected text |
| `Ctrl+Shift+D` | Toggle dark/light theme |
| `Ctrl+Shift+E` | Open page tools |
| `Ctrl+Shift+F` | Fill in PDF form fields |
| `Ctrl+Shift+K` | Document security and permissions |
| `?` or `F1` | Keyboard shortcuts dialog |

### Project Structure

```
cambuz-pdf/
├── main.js                  # Electron menus, file IPC, printers, print and OCR adapters
├── preload.js               # Narrow Electron IPC bridge
├── server.js                # Express web server for preview
├── package.json             # Project configuration
├── src/
│   ├── index.html           # Reader UI and print-preview dialog
│   ├── renderer.js          # Loading, rendering, navigation and app events
│   ├── printing.js          # Range validation, sheet layout, print-PDF creation
│   ├── print-ui.js          # Settings, preview rendering and print actions
│   ├── print.css            # Print dialog and preview styling
│   ├── search.js            # Unicode search engine + highlighting
│   ├── sidebar.js           # Thumbnails + document outline
│   ├── recents.js           # Recent files + IndexedDB byte cache
│   ├── pdf-security.js      # Permission flags and password-error classification
│   ├── pdf-forms.js         # AcroForm reading and filling (pdf-lib)
│   ├── pdf-password-ui.js   # Password prompt
│   ├── pdf-forms-ui.js      # On-page form controls, filling bar, save
│   ├── pdf-security-ui.js   # Document Security dialog + status chip
│   ├── pdf-ocr.js           # Bounded page-to-PNG OCR rasterizer + language list
│   ├── pdf-ocr-ui.js        # Explicit per-page OCR dialog and separate results
│   ├── ocr-engine.cjs       # Optional local Tesseract adapter (not bundled)
│   ├── pdf-forms.css        # Password, security and form styling
│   ├── pdf-ocr.css          # OCR dialog styling
│   └── styles.css           # Reader styles (dark/light)
├── scripts/
│   ├── create-samples.js    # Basic sample PDFs (pdf-lib)
│   ├── create-unicode-samples.py  # Hindi/Punjabi/multilingual PDFs (fpdf2)
│   ├── create-secure-samples.js   # AcroForm + secure fixtures (pdf-lib)
│   ├── create-secure-samples.py   # Encrypted fixtures (pypdf)
│   ├── create-phase6-samples.py   # HarfBuzz-shaped Indian-language fixtures
│   ├── create-phase7-samples.mjs  # Raster-only English/Indic OCR sample
│   ├── test-phase2.mjs      # Node PDF/extraction/search suite
│   ├── test-phase2-dom.mjs  # DOM/reader/print wiring suite (jsdom)
│   ├── test-phase3.mjs      # Print composition and validation suite
│   ├── test-phase4.mjs      # Page operations, merge/split, metadata and page-tools dialog suite
│   ├── test-phase5.mjs      # Security, permissions, forms and password-dialog suite
│   ├── test-phase6.mjs      # Indian-language extraction, UI, raster and print tests
│   └── test-phase7.mjs      # Optional OCR safety, scanned fixtures and quality checks
├── scripts/fixtures/        # Security/form fixtures and Phase 7 raster PNGs
├── samples/                 # Sample PDF files for testing
│   ├── welcome.pdf          # 5-page welcome document
│   ├── cambuz-demo.pdf      # 10-page comprehensive demo
│   ├── form-sample.pdf      # 1-page fillable feedback form
│   ├── hindi-sample.pdf     # 4-page Devanagari sample (पंजाब ×6)
│   ├── punjabi-sample.pdf   # 4-page Gurmukhi sample (ਪੰਜਾਬ ×6)
│   ├── multilingual.pdf     # 7-page EN/HI/PA sample with outline (each term ×12)
│   ├── phase6-indian-languages.pdf # English + 12 target languages, mixed, stress
│   ├── phase6-embedded-font.pdf    # Visible Tamil text with embedded Noto font
│   ├── phase6-missing-font.pdf     # Tamil with its embedded font program removed
│   └── phase7-scanned.pdf          # Four image-only English/Hindi/Punjabi/Urdu pages
├── assets/                  # Application assets
└── README.md                # This file
```

### Architecture

```
Cambuz PDF Reader
       |
+------+------+------+------+------+
|      |      |      |      |      |
| PDF  | Text |Search|Side- | File |
|Render| Layer|Engine| bar  | I/O  |
|      |      |      |      |      |
+------+------+------+------+------+
       |      |
  PDF.js Engine  IndexedDB/localStorage
                 (recents)
```

- **Rendering**: PDF.js renders pages to canvas (high-DPI); a `TextLayer`
  overlay provides selection, copy and search highlights
- **Search**: document-wide Unicode index (NFC + case folding, grapheme-safe
  source offsets, adjacent PDF.js text-item joining with explicit line breaks);
  matches are wrapped in `<mark>` elements, the current match is scrolled into
  view, and navigation wraps across pages
- **Sidebar**: lazy thumbnails + hierarchical outline with expand/collapse
- **Recents**: metadata in `localStorage`; web mode caches small files in
  `IndexedDB` so reopen works; Electron reopens by native path
- **Rotation**: 0/90/180/270° applied to canvas, text layer and thumbnails
- **Printing**: `pdf-lib` composes source pages into physical-size sheets; PDF.js
  renders those exact sheets for preview; Electron routes the same PDF to the
  selected native printer, while browser mode opens it in the system PDF/print flow

### Search Verification (Unicode)

Required queries were verified end-to-end with the app's own matching
algorithm against the real sample PDFs:

| Query | multilingual.pdf | hindi-sample.pdf | punjabi-sample.pdf |
|---|---|---|---|
| `Punjab` | 12 | 0 | 0 |
| `पंजाब` | 12 | 6 | 0 |
| `ਪੰਜਾਬ` | 12 | 0 | 6 |

Full-page golden-text assertions (15 pages) guarantee byte-exact extraction
with no control-character corruption. All three scripts also render with
correct shaping (verified by rasterizing pages to PNG). Phase 6 adds the
13-language fixture matrix and grapheme-aware offsets; see the dedicated
compatibility matrix and `npm run test:phase6` results above.

### Known Limitations

- **Native printer verification**: Windows CI validated packaged print-PDF
  preparation and preview, but did not enumerate printers, open the native
  printer dialog, or submit a print job. Exercise the printer list, dialog,
  copies, paper sizes and actual Windows output on a machine with a configured
  printer before release. The local sandbox still has no Electron runtime.
- **Device printable margins**: the selected margin value defines the printable
  content box; per-printer non-printable margins are not queried automatically.
  Printers may clip at their hardware edges when `None` is selected.
- **Annotations and interactive forms**: vector composition embeds page graphics;
  annotations and interactive form widgets are not flattened into the print job,
  so filled form values do not appear on paper (see Phase 5 limitations).
- **Ink Saver quality**: Ink Saver rasterizes at up to 200 dpi (with an
  18-megapixel-per-page safety cap); normal print jobs preserve vector content.
- **Print preparation memory**: the active source PDF is retained for printing
  and the composed output is held in memory. Electron rejects a print job above
  250 MiB; very large documents can require substantial RAM.
- **Browser printer access**: web mode cannot enumerate native printers; it
  opens the system PDF/print flow instead. Electron mode provides the printer
  selector and direct native route.
- **Legacy sample-generator constraint**: older fpdf2-generated Hindi/Punjabi
  fixtures can mis-encode `ToUnicode` for pre-base matras and some
  ligature-plus-matra sequences. Phase 6's separate HarfBuzz-shaped fixture
  has its own verified Unicode map and covers conjunct/combining cases; use it
  rather than the legacy PDFs as Phase 6 search/copy evidence.
- **Single page view**: one page at a time (continuous scroll still future)
  — *superseded: Phase 11 added a continuous scroll mode; see the Phase 11 section*
- **No continuous scroll / no annotation authoring**: single page view; page operations and form filling are Phases 4–5 and are implemented
  — *continuous scroll is superseded by Phase 11; annotation authoring is still absent*
- **Recent-file cache**: web-mode byte cache capped at 5 files × 60 MiB;
  larger/older files must be reopened manually
- **Search**: case-insensitive substring search; no regex, no whole-word or
  diacritic-insensitive options yet

### Earlier regression suites (Phases 2–5 — 637 assertions, all passing)

Node suite (`npm run test:node`, 123 assertions):

1. All 5 sample PDFs exist and parse with expected page counts
2. Unicode extraction intact (पंजाब/ਪੰਜਾਬ/Punjab, conjuncts क्ष त्र ज्ञ श्र
   द्ध ह्म, adhak words ਪੁੱਤਰ/ਮੱਖਣ/ਦੁੱਧ, digits, danda, no control chars)
3. Search-helper unit tests (offsets, case folding, native-script queries,
   byte-exact slices, NFC stability)
4. End-to-end search counts via the app algorithm (12/12/12, 6, 6)
5. Full-text golden check on all 15 Unicode sample pages
6. Outlines present (8/4/4 entries) and every destination resolves to a page
7. Metadata (title/author) present
8. Rotation viewport math (90° swaps dimensions, 180° preserves)
9. Syntax check (`node --check`) on all application and test JS sources
10. Phase 3 print IPC/layout hooks remain present; the optional OCR engine stays in a separate module
11. Recents pure helpers (ids, sizes, relative time)

DOM suite (`npm run test:dom`, 59 assertions, jsdom + real modules):

1. Reader controls and accessible print dialog elements present
2. PrintController defaults, settings validation and 2-up/Ink Saver presets
3. Real `SearchController`: highlight marks created for EN/HI/PA queries
   with byte-exact text, current-mark tracking, wrap navigation, clear()
4. Real `SidebarController`: nested outline build, collapse/expand,
   explicit + named destination navigation, external-URL handling, tabs
5. Real `recents.js`: add/list/update/remove/clear round-trip in
   `localStorage`, reopen-last setting
6. `renderer.js` imports cleanly against the real DOM

Print suite (`npm run test:phase3`, 54 assertions):

1. Current/all/range selection; malformed, duplicate and out-of-range pages rejected
2. A4/Letter dimensions, portrait/landscape, margins, fit/actual/custom scale
3. 1/2/4 pages per sheet, partial sheets, selected-page order and clipping plan
4. Composed PDFs reopen in PDF.js with expected page count, media box and page text
5. Hindi and Punjabi content survives vector composition; page /Rotate is retained
6. Ink Saver passes grayscale PNG pages into a valid output PDF

Server checks cover `/src/index.html`, `/src/print.css`, `/src/print-ui.js`,
`/src/pdf-ocr.css`, `/src/pdf-ocr-ui.js`, `/src/printing.js`, PDF.js ESM and
`samples/phase7-scanned.pdf`.

Native Windows printer enumeration/driver output and browser canvas-preview
appearance remain outside the automated checks; the packaged Windows print-preview
path passed CI, but it is not a hardware-tested print result.

### Manual Browser / Windows Checklist

Start the web preview with `npm run serve` (port 3000). The live preview can
exercise the UI and browser print fallback; Windows + Electron is required to
verify native printer enumeration and driver output.

**Phase 6 language checks:**

- Open `samples/phase6-indian-languages.pdf`; search each matrix query, select
  and copy a sample from each language, and inspect Urdu direction and the
  mixed-script page.
- Open `samples/phase6-missing-font.pdf` on a system with and without Tamil
  fonts; compare fallback rendering with the selectable/searchable text.
- Open the prepared print PDF from the Phase 6 fixture and inspect conjuncts,
  combining marks, mixed scripts and Urdu output on paper/PDF.
- Repeat on the target browser and Windows/Electron builds; the automated
  Node/jsdom suite is not a substitute for native clipboard/printer testing.

**Phase 7 OCR checks (desktop app + separately installed Tesseract):**

- Verify `tesseract --version` and that `tesseract --list-langs` lists each
  installed model code. Open `samples/phase7-scanned.pdf`; its text layer should
  be empty, unlike selectable text in `samples/phase6-indian-languages.pdf`.
- Run OCR explicitly on pages 1–4 with `eng`, `hin`, `pan` and `urd` (install
  those models first). Compare OCR output with the visible page and confirm the
  separate OCR result is selectable but does not enter normal Search or save
  back into the PDF.
- Repeat with a PDF whose permission flags deny copying; the OCR button/action
  must remain blocked. Also check missing engine/model status, the **Check OCR
  again** control, a mixed-language selection, large/skewed scans and a slow
  OCR run. Confirm no page is processed until **Recognize current page** is
  clicked.
- Use the web preview to verify that it explains local OCR is desktop-only.
  The Node/jsdom suite and the controlled Tesseract.js model probe do not replace
  native Tesseract/Windows/Electron verification.

1. Open `samples/multilingual.pdf` via Open, drag-and-drop and `?pdf=` URL
2. Sidebar thumbnails/bookmarks, Unicode search, copy/select-all, rotation,
   fullscreen, theme and recents still work as before
3. Press `Ctrl+P`; verify the all-pages preview and output PDF use the same sheet layout
4. Select Current page, then Selected pages `2-4, 6`; test empty, duplicate,
   descending and out-of-document ranges are blocked with clear errors
5. Compare A4 portrait and landscape; also try Letter and Legal
6. Exercise Fit, Actual Size and a custom scale; use None, Normal and Custom
   margins and confirm the preview changes accordingly
7. Use 2-up and 4-up on `samples/cambuz-demo.pdf`; inspect the final partial
   sheet and page order in preview and downloaded print-ready PDF
8. Turn on Ink Saver; confirm pages render grayscale, then download/open the
   prepared PDF and inspect it independently
9. Electron on Windows: refresh printer list, select the default and another
   printer, print one copy and multiple copies; verify the driver paper size,
   orientation, clipping and margins
10. Also test the native system-dialog fallback with no selected printer and
    verify cancellation, printer errors and retry behavior
11. Electron only: native Open dialog, menus (Find/Rotate/Fullscreen/
    Sidebar/Shortcuts/Print) and reopen-by-path after restart

---

## Phase 1 — Implementation Status

### Phase 1 Status: `PHASE 1 COMPLETE`

### Features Implemented

| Requirement | Status |
|---|---|
| Launch application | ✅ Implemented |
| Open PDF through file picker | ✅ Implemented |
| Open PDF by drag-and-drop | ✅ Implemented |
| Render PDF pages | ✅ Implemented |
| Previous/next page | ✅ Implemented |
| Page number navigation | ✅ Implemented |
| Zoom in/out | ✅ Implemented |
| Fit page | ✅ Implemented |
| Fit width | ✅ Implemented |
| Scroll document | ✅ Implemented |
| Page count | ✅ Implemented |
| Basic toolbar | ✅ Implemented |
| Window resizing | ✅ Implemented |
| Close/open another PDF | ✅ Implemented |
| Basic error handling | ✅ Implemented |
| Dark/light UI | ✅ Implemented |
| Clean, minimal interface | ✅ Implemented |

### Technology

| Component | Choice |
|---|---|
| **Framework** | Electron (desktop) + Express (web preview) |
| **Language** | JavaScript (ES modules) |
| **PDF Engine** | Mozilla PDF.js (pdfjs-dist v4) |
| **Styling** | Custom CSS with CSS variables (dark/light themes) |
| **Architecture** | Modular — rendering, navigation, and UI separated |

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `pdfjs-dist` | ^4.0.379 | PDF rendering engine |
| `express` | ^4.18.2 | Web server for preview mode |
| `electron` | ^28.0.0 | Desktop application shell (dev) |
| `pdf-lib` | ^1.17.1 | Sample PDF generation (dev) |

### Installation

```bash
# Clone the repository
git clone https://github.com/pixldotcom/cambuz-pdf.git
cd cambuz-pdf

# Install dependencies
npm install

# Run as web application (for preview/testing)
npm run serve

# Run as desktop application (requires Electron)
npm start

# Generate sample PDFs
npm run samples
```

### Development Commands

| Command | Description |
|---|---|
| `npm run serve` | Start web server on port 3000 |
| `npm start` | Launch Electron desktop app |
| `npm run samples` | Generate sample PDF files |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF |
| `Ctrl+W` | Close PDF |
| `PageUp` / `PageDown` | Previous / Next page |
| `Home` / `End` | First / Last page |
| `Ctrl+Plus` / `Ctrl+Minus` | Zoom in / Zoom out |
| `Ctrl+0` | Fit page |
| `Ctrl+Shift+0` | Fit width |
| `Ctrl+Shift+D` | Toggle dark/light theme |

### Project Structure

```
cambuz-pdf/
├── main.js              # Electron main process
├── preload.js           # Electron preload script (IPC bridge)
├── server.js            # Express web server for preview
├── package.json         # Project configuration
├── src/
│   ├── index.html       # Main application HTML
│   ├── renderer.js      # PDF rendering and UI logic
│   └── styles.css       # Application styles (dark/light)
├── scripts/
│   └── create-samples.js  # Sample PDF generator
├── samples/             # Sample PDF files for testing
│   ├── welcome.pdf      # 5-page welcome document
│   └── cambuz-demo.pdf  # 10-page comprehensive demo
├── assets/              # Application assets
└── README.md            # This file
```

### Architecture

```
Cambuz PDF Reader
       |
+------+------+------+
|      |      |      |
| PDF  | UI   | File |
| Render| Layer| I/O  |
|      |      |      |
+------+------+------+
       |
  PDF.js Engine
```

- **Rendering**: PDF.js renders pages to HTML5 Canvas with high-DPI support
- **Navigation**: Page state management with prev/next/jump-to-page
- **Zoom**: Manual zoom, fit-to-page, fit-to-width with auto-refit on resize
- **File I/O**: File picker (Electron dialog or web input) + drag-and-drop
- **Theme**: CSS variables for instant dark/light switching

### Known Limitations

- **Electron binary**: Cannot be installed in all environments; web preview mode works everywhere
- **Single page view**: Currently renders one page at a time (continuous scroll not yet implemented)
  — *superseded at this milestone: Phase 11 added continuous scroll (single page remains the default)*
- **No text selection**: Phase 1 renders to canvas only; text selection/copy comes in Phase 2
- **No search**: Text search is a Phase 2 feature
- **No thumbnails**: Page thumbnails are a Phase 2 feature
- **No bookmarks**: Document outline/bookmarks are a Phase 2 feature
- **At the Phase 1 milestone only**: printing was still a future Phase 3
  feature; the current workflow is documented at the top of this README
- **Password support**: Encrypted PDFs were a Phase 5 feature; they are now opened with a password prompt (see the Phase 5 section)

### Tests Performed

1. **Page load**: Application loads correctly in web browser
2. **Resource serving**: All static resources (HTML, CSS, JS, PDF.js, samples) serve with correct MIME types
3. **Sample PDF validity**: Both sample PDFs validate correctly with pdf-lib
4. **PDF.js availability**: pdf.mjs and pdf.worker.mjs are accessible and correctly typed as JavaScript
5. **Navigation logic**: Page navigation bounds checking (min 1, max totalPages)
6. **Zoom logic**: Zoom scale limits (0.25x to 5.0x)
7. **Fit calculations**: Fit-to-page and fit-to-width algorithms use correct viewport math
8. **Theme switching**: CSS variables properly swap between dark and light palettes
9. **Error handling**: Error display shown for invalid files, dismissed by user action
10. **Drag and drop**