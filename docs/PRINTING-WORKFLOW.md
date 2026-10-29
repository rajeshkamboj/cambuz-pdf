# Printing workflow: prepared PDF → system viewer

Status: implemented in code; physical Windows printing is **not yet verified**.

## Why the former route was replaced

The old desktop path was:

1. `PrintController` composed page selection, media size, margins, scale and N-up with `pdf-lib`.
2. PDF.js rendered those composed bytes in Cambuz's custom preview.
3. Cambuz enumerated printers in the renderer. Selecting a named printer sent a silent job; leaving the selector on “system dialog” requested a dialog.
4. `main.js` wrote a temporary PDF, loaded that file into a transient Electron `BrowserWindow` (Chromium's internal PDF viewer), and called `printWindow.webContents.print(...)`.
5. The window and temporary directory were destroyed when Electron's callback settled.
6. Cambuz's manual-duplex mode split odd/even sheets and submitted two direct one-sided jobs, with a model-specific reload panel between them.

Electron's documented `webContents.print` API prints a window's **web page**. With
`silent: false` it asks the user for print settings; with `silent: true` it can
submit to a system device name. The API does not document a guaranteed native
PDF-viewer preview path. Cambuz was calling it on Chromium's internal PDF viewer,
not on the source PDF through a PDF-specific operating-system API. On the
reported Windows machine that nested path displayed “This app doesn't support
print preview,” and the direct route produced almost-solid-black pages.

Changing only `silent`, a dialog option, or a page background would leave the
same PDF-plugin-to-Chromium-to-driver path in place. The white-sheet composition
is retained and tested, but is not treated as a physical-print fix.

References:

- Electron `webContents.print`: <https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback>
- Electron `shell.openPath`: <https://www.electronjs.org/docs/latest/api/shell#shellopenpathpath>

## Current responsibilities

### Cambuz

- Resolve current, all or selected source pages.
- Compose paper dimensions/orientation, margins, scaling and 1/2/4-up layout.
- Paint an opaque white physical sheet **under** source content. Transparent
  artwork composites over white; dark source content remains above it.
- Preview the exact prepared bytes with PDF.js.
- Save those exact bytes through **Download print-ready PDF**.
- On an explicit click, write a bounded temporary copy and call
  `shell.openPath` through **Open PDF in system viewer**.

### Registered system PDF viewer / Windows / printer driver

- Enumerate and select installed printers.
- Show its supported print preview and device preferences.
- Select copies, collation and any additional print-time page range.
- Control automatic or manual duplex and all paper-reload prompts.
- Cancel or submit the physical job.

Cambuz does not submit a job, select a printer, or launch another application
until the user clicks the corresponding action.

## Manual duplex consequence

Cambuz no longer runs a two-pass odd/even sequence. It does not rotate, reverse
or reorient a second pass. For a simplex printer, the registered PDF viewer or
printer driver controls the second pass. The user must follow that application's
prompts and the printer's own feed instructions. This is deliberately not
claimed to preserve the former Cambuz manual-duplex behavior.

## Temporary-file lifecycle

A successful system-viewer handoff needs the file to remain available after
`shell.openPath` resolves. Cambuz therefore retains the copy for at most 24
hours, attempts delayed cleanup, and removes stale copies on later startup.
Launch failures are cleaned immediately. If Windows keeps a PDF locked, cleanup
is retried on a later startup rather than changing permissions or forcing the
viewer to close.

If Cambuz itself is the registered PDF application, the handoff can loop back to
the running instance. Cambuz recognizes its own temporary path, refuses to
replace the document currently being read, removes the handoff copy, and asks
the user to save the print-ready PDF and choose another application with
**Open with**.

## What automation establishes

Tests inspect preparation for single, multiple and selected pages; page order;
media dimensions/orientation; normal black-on-white content; grayscale;
transparent artwork; legitimate dark backgrounds; and Hindi/Punjabi text. Tests
also cover explicit handoff, exact-byte export/handoff, Save cancellation,
viewer-launch failure and stale temporary-file cleanup.

These checks establish artifact and control-flow behavior only. They do not
prove that a Windows PDF viewer, printer driver or physical printer will render
the artifact correctly.
