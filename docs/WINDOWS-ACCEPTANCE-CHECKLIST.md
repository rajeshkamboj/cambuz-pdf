# Windows manual acceptance checklist — Cambuz PDF Reader 1.1.0

Run these checks by hand on a real Windows 10 or 11 x64 machine before any public release.
Automated CI already covers packaged launch, reading, search, copy and open/close on GitHub
runners. It does **not** cover your hardware, a real printer, or a person using the app.

Record the result for each item: **Pass**, **Fail** (add a note), or **Not run**.

Build under test: `Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe` and `…-portable.exe`
from commit `ac2b848` (or the commit named in the release notes). Check SHA-256 first.

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 1 | SHA-256 of the installer and portable file matches `SHA256SUMS.txt` from the same CI run. | | |
| 2 | SmartScreen warning appears (expected, unsigned). "More info → Run anyway" works. | | |
| 3 | Installer: choose a folder, install per user, no admin prompt needed. | | |
| 4 | Start Menu entry "Cambuz PDF Reader" exists and launches the app. | | |
| 5 | Properties of `Cambuz PDF Reader.exe`: Product name "Cambuz PDF Reader", version 1.1.0, company "Cambuz". | | |
| 6 | Right-click a `.pdf` → Open with → Cambuz PDF Reader is offered; double-click opens it. | | |
| 7 | With the app running, double-clicking a second PDF opens it in the same window (no second window). | | |
| 8 | A file path with spaces and an accented name (for example `fichier été.pdf`) opens. | | |
| 9 | Open PDF… dialog, drag-and-drop, and "Try Sample PDF" each open a document. | | |
| 10 | First, middle and last pages render; Page Up/Down and the page box navigate. | | |
| 11 | Zoom in/out, fit width and fit page work; rotation works. | | |
| 12 | Search: finds a word, next and previous work, a missing word shows "no results". | | |
| 13 | Select text with the mouse, Ctrl+C, then paste into Notepad: text matches. | | |
| 14 | Hindi and Punjabi sample text select and paste as correct Unicode. | | |
| 15 | Open a copy-restricted document (for example `secure-permissions-only.pdf` from the test fixtures, or your own): selection and Ctrl+C are refused with a message; Notepad receives nothing from the document. | | |
| 16 | On that restricted document, the search box still accepts typing and Ctrl+C in the search box. | | |
| 17 | Open a password-protected PDF: the prompt appears; wrong password is refused; right password opens it. | | |
| 18 | Print preparation opens and previews the selected pages; change page range, paper, orientation, margins and N-up, then confirm **Download print-ready PDF** saves the same artifact. | | |
| 19 | Click **Open PDF in system viewer**: the registered viewer opens only after the click, the original stays open in Cambuz, and its Print command permits printer selection and cancellation. | | |
| 20 | Page tools (rotate, delete, reorder, merge, split, extract) work on a copy; the original file is unchanged until Save As. | | |
| 21 | Form sample: fields can be filled and "Save Filled Form" writes a new file. | | |
| 22 | Repeated open and close of several documents: no crash, no frozen window. | | |
| 23 | A damaged or non-PDF file gives a clear error and the app still opens the next document. | | |
| 24 | Dark and light themes toggle; keyboard shortcuts listed in Help → Keyboard Shortcuts work. | | |
| 25 | Help → About shows "Cambuz PDF Reader v1.1.0". | | |
| 26 | Portable exe runs from a folder on a USB drive or desktop without installing. | | |
| 27 | Uninstall from Apps & features: program removed, Start Menu entry gone, `.pdf` association removed. | | |
| 28 | Optional: with Tesseract installed, a scanned page can be recognised with OCR; without it, the app says so. | | |
| 29 | Print the exact downloaded artifact through the registered system viewer: test one-sided output, size/orientation, normal black-on-white, grayscale/transparency, a legitimate dark page, and Hindi/Punjabi. Record printer and viewer. | | |
| 30 | On a duplex-capable printer, choose duplex in the system viewer/driver. On a simplex printer, run its manual-duplex procedure without any Cambuz rotation or reordering; verify both sides and page order. | | |
| 31 | Compare the same prepared artifact printed from the system viewer with the old Cambuz result; verify no solid-black pages. This is the required physical acceptance test, not covered by automation. | | |
| 32 | Continuous scroll: open a long document, click the toolbar **Page/Scroll** button (or `Ctrl+Shift+M`) and scroll through several pages — the pages stack without gaps or jumps, the page box and status line follow the scroll, and each page appears as it enters the window. | | |
| 33 | Continuous scroll, zoom and rotation: zoom in and out and rotate while scrolling; the reader stays on the same page, and reading returns to the same place. | | |
| 34 | Continuous scroll, search: search for a word, use next/previous across pages, then scroll away and back — highlights stay on the right pages. | | |
| 35 | Continuous scroll is remembered: close and reopen the app; it starts in the layout you left it in. Switch back to single page with the same button. | | |
| 36 | Reading with the wheel: in single-page mode, scroll past the bottom of a page — it turns once per gesture (no page skipping); `Space`/`PageDown` scroll then turn at the end. | | |

**Not part of this checklist:** macOS and Linux. Those builds are experimental and need their own
testing on real hardware before they can be called supported.

When done, record the tester, date, Windows version and printer model, and send the result
back with any failures.
