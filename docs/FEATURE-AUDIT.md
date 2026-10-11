# Cambuz PDF Reader — feature audit: standard reader functions, present and missing

**Scope:** the reading experience of the 1.1.0 codebase (`9c7027e`, branch
`arena/887f6050-cambuz-pdf`), compared against what a person expects from a
mainstream PDF reader (Adobe Acrobat Reader, the Chrome/Edge/Firefox built-in
viewers, SumatraPDF, Okular, Foxit).

**Method:** every viewer module was read end-to-end —
`src/renderer.js` (rendering, navigation, zoom, keyboard, events),
`src/search.js`, `src/sidebar.js`, `src/continuous-layout.js`,
`src/continuous-view.js`, `src/pdf-forms*.js`, `src/pdf-ocr*.js`,
`src/printing.js`/`print-ui.js`, `src/pdf-ops*.js`, `src/canvas-budget.js`,
`src/recents.js`, `main.js`, `preload.js`, `src/index.html`, `src/*.css` — and
the whole regression suite was run (`npm test`, 1,257 assertions, 0 failures)
so gaps are reported against behaviour that is verified, not just claimed.

Two things are reported separately below:

1. **Fixed in this change** (the two gaps that most change how reading feels,
   including the continuous scroll you could not find).
2. **Still missing**, roughly ordered by how much a normal reader would notice.

---

## 1. Fixed in this change

| Gap | Before | Now |
| --- | --- | --- |
| **Continuous scrolling** | One page at a time, full stop. The viewer was built around a single `#page-wrapper`/`#pdf-canvas`/`#text-layer` triple, and `goToPage()` reset `scrollTop` to 0 on every page change. There was no layout mode to switch to (no `layout`/`scrollMode` state anywhere, and no View-menu entry). | A real continuous column: every page is stacked in one scroller, slots are created/painted/released lazily as you scroll, and the toolbar, status bar, page box, sidebar, recents and search all follow the page under the reading line. Toggle with the toolbar **Scroll/Page** button, the **View → Continuous Scroll / Single Page** menu item, or `Ctrl+Shift+M`. The choice is remembered between sessions. |
| **No scroll-to-read navigation** | In single-page mode a plain mouse wheel did nothing when the page fitted the window; `PageUp`/`PageDown` jumped a whole page; `Space` was inert. Reading a 200-page document meant the arrow buttons or the page box. | Wheel/trackpad gestures turn the page when the page cannot scroll any further (throttled, so one flick never skips pages); `Space`/`Shift+Space` scroll a screen and turn the page at the end; `PageUp`/`PageDown` do the same; `←`/`→` still change page directly. |
| **Case-sensitive search** | The comparison engine already supported `matchCase` internally, but nothing exposed it — every search was forced case-insensitive. | An **Aa** toggle in the search bar re-runs the whole-document search case-sensitively. (Whole-word and regex search remain missing — see P2.) |
| **Sidebar vs fit modes** | Opening the sidebar changed the available width without re-fitting, so `Fit width`/`Fit page` were stale until the next window resize. | Both layout modes re-fit when the sidebar opens or closes. |

Compatibility note: continuous mode is **opt-in**; single page stays the
default and the startup behaviour of the packaged app is unchanged. Flipping
the default is a one-line change (`DEFAULT_VIEW_MODE` in `src/renderer.js`).

---

## 2. Missing or partial, by priority

### P1 — immediately noticeable to a normal reader

| Feature | Status in Cambuz | Notes |
| --- | --- | --- |
| **In-document links** (PDF link annotations, cross-references, TOC entries on the page) | **Missing.** There is no annotation layer at all: `getAnnotations`/`AnnotationLayer` appear nowhere in `src/`. Only the sidebar outline navigates, and external outline URLs are handed to the browser (`sidebar.js:431`). | This is the biggest remaining gap: most real documents are navigated by clicking on the page. Needs a link layer over the text layer, internal destination handling, and a "go back" history (`Alt+←`). |
| **Annotation display** (highlights, notes, stamps, markup made in other apps) | **Missing.** Filled form fields are drawn; every other annotation type is invisible. | A document highlighted in Acrobat looks unmarked here. Display is independent of authoring and much cheaper to add. |
| **Open Recent while reading** | **Partial.** Recents exist, but only on the welcome screen — once a document is open there is no File → Open Recent menu and no way back to the list without closing the document. | Cheap, high-visibility fix. |
| **Night / inverted page colours** | **Missing.** The dark theme changes the chrome only; the page stays a white canvas (`#pdf-canvas { background: white }`), so reading at night is a bright rectangle on a dark app. | A page-inversion toggle (or "sepia/dim" tint) is a small CSS/canvas-filter change. |
| **Zoom presets / actual size / zoom to cursor** | **Partial.** `Ctrl +/−`, fit page, fit width and `Ctrl`+wheel exist, but the "100%" label is a read-only span: no preset menu (25–400%), no "actual size" (1:1 at screen DPI), no zoom-to-pointer, no marquee zoom. | The label is the natural place for a combobox. |
| **Two-page / facing-pages spread** | **Missing.** One layout mode was added (continuous, stacked); facing pages, cover mode and "book view" are still absent. | Depends on the same layout work continuous mode introduced. |
| **Page labels** (`getPageLabels`: roman numerals, custom numbering) | **Missing.** Page numbers are physical only, so "page iv" of a book shows as "page 4". | Small, self-contained: read labels once and format the status bar/page box. |

### P2 — expected by many readers, not by all

| Feature | Status in Cambuz | Notes |
| --- | --- | --- |
| **Search options: whole word, regex** | **Missing** (match-case is now exposed). The engine is substring-only by design; the README documents this. | The comparison layer already normalises text, so whole-word is a contained change. |
| **Search results panel** (list of hits, jump to any) | **Missing.** Next/previous with highlights only. | Also enables "matches in other pages" at a glance. |
| **Export text / images / pages as PNG** | **Missing.** No text or image export anywhere (the only `toBlob` uses are OCR input and Ink Saver printing). | Standard in Acrobat/Okular. |
| **Annotation authoring** (highlight, note, ink, text markup) | **Missing** and documented as out of scope. | Big feature; worth a design note before implementation. |
| **Signature display and verification** | **Missing.** Signature form fields are shown read-only; existing signatures are not detected, displayed or validated. | Verification is security-sensitive; display-only is the safe first step. |
| **Multiple documents at once** (tabs or extra windows) | **Missing.** One document per window; "Duplicate Document…" saves a copy rather than opening a second view. | Tabs would touch recents, forms/page-tool sessions and the close path. |
| **Session restore of several files** | **Partial.** Only the last document + its last page reopen (`cambuz.reopenLast`). Zoom, rotation, scroll offset and the recents set are not restored. | |
| **Reload when the file changes on disk** | **Missing.** No `fs.watch`/`watchFile` in `main.js`; an edited file keeps showing the old render until reopened. | |
| **Reading progress indicator** | **Partial.** The status bar shows "Page n / m"; there is no progress bar or percentage of the document. | Trivial once page labels land. |
| **Hand tool / drag-to-pan, middle-click autoscroll** | **Missing.** Scrolling is via scrollbars, wheel and keyboard only. | |
| **Touch and trackpad pinch-zoom, gestures** | **Missing.** No touch/gesture handlers; `Ctrl`+wheel is the only zoom gesture. | Matters for Windows touch laptops; Electron supports pinch via `Ctrl`+wheel already. |
| **Presentation mode** | **Partial.** Full screen exists (`F11`) but the toolbar/sidebar/status bar stay visible, and there is no "advance on click". | |
| **Accessibility** (tagged order, screen-reader support, high-contrast/large-text reflow) | **Partial.** The PDF.js text layer gives selectable DOM text; tagged-PDF structure is not used and no accessibility settings exist. | |
| **Form data import/export (FDF/XFDF) and reset** | **Missing.** Values can be filled and saved into a new PDF only. | |
| **OCR: batch pages, merged searchable text** | **Partial and deliberate.** One page per run, results in a separate box, never merged into the PDF or its search (documented). | Whole-document OCR with a real text layer is the natural next step. |
| **Print: selection, current view, booklet, page scaling to printable area, printer capability query** | **Partial.** Current page / all / ranges, N-up, duplex and collation are implemented; per-printer non-printable margins are not queried (documented). | |

### Deliberate non-features (documented, not defects)

Copy restrictions are honoured app-wide (no bypass), encrypted files are never
re-saved unprotected, PDF JavaScript actions are not executed, there is no
auto-updater and no code signing. These are policy decisions, not gaps.

---

## 3. How the fixed items are verified

* `npm test` — full suite, **1,257 assertions**, 0 failures, including the new
  `scripts/test-phase11.mjs` (110 assertions):
  * layout maths in isolation (sizes under rotation, column offsets, the page
    under the reading line, the render window, scroll targets, canvas budget);
  * `ContinuousView` against a fake renderer (lazy slots, off-window canvas
    release, zoom re-layout that keeps the reader in place, background
    measurement, teardown);
  * the real app in jsdom: open the ten-page sample, switch to continuous,
    jump to a page, scroll across a page boundary and watch the page box and
    status line follow, switch back to single page, and turn a page with a
    wheel gesture;
  * case-sensitive search through the real `SearchController`.
* `npm run serve` — browser preview (`http://localhost:3000`) for a visual pass;
  the `samples/` PDFs (including the 10-page `cambuz-demo.pdf`) are the quickest
  documents to try it on.

**Not verified here:** this sandbox has no Electron runtime and no display, so
continuous mode was exercised headlessly (jsdom) and by reading, not by eye in
the packaged app. A human pass on real hardware — scrolling a long document,
zooming, rotating, and checking the packaged smoke test — is still the right
final gate, and the existing packaged smoke test continues to cover single-page
mode unchanged.

## 4. Suggested next three tickets

1. **Link annotations + "go back"** (`P1`): display `getAnnotations()` link
   rects over the text layer, resolve internal destinations through
   `getDestination`, guard external URLs with the existing browser handoff, and
   keep a small page history for `Alt+←`.
2. **Open Recent in the File menu** (`P1`, small): expose the existing recents
   list while a document is open, and consider a recent-list button in the
   toolbar.
3. **Night reading + zoom presets** (`P1`, small-medium): a page-inversion
   toggle that works in both layout modes, and turn the zoom label into a
   preset menu including "Actual size".
