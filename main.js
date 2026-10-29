const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  DEFAULT_MAX_AGE_MS,
  cleanupStaleViewerCopies,
  createViewerCopy,
  removeViewerCopy,
} = require('./src/system-pdf.cjs');
const { getOcrStatus, recognizePng } = require('./src/ocr-engine.cjs');
const { bundledSamplePath } = require('./src/bundled-samples.cjs');
const { buildPageContextMenu } = require('./src/context-menu.cjs');
const { pdfPathFromArgv } = require('./src/file-open.cjs');
const { applyMacMenuRoles } = require('./src/mac-menu.cjs');

let mainWindow;
// A PDF named by the OS before the renderer could receive it (launch with a
// file path, macOS open-file before ready). The renderer collects it through
// the `renderer-ready` handshake; later arrivals are pushed over
// `open-file-path`. Cambuz shows one document, so the newest pending file wins.
let pendingOsFile = null;
let rendererIsReady = false;

// Only the en-US Chromium locale pack ships (`electronLanguages` in package.json,
// which keeps the installer small), so the renderer's default locale is en-US.
// The OS regional locale is passed to the preload so dates in Recents still use
// the user's format. Only a well-formed BCP 47 tag is forwarded.
function systemLocaleArguments() {
  const locale = typeof app.getSystemLocale === 'function' ? app.getSystemLocale() : '';
  return typeof locale === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/.test(locale)
    ? [`--cambuz-system-locale=${locale}`]
    : [];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Cambuz PDF Reader',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Explicit (also Electron's default): the page runs in the Chromium sandbox.
      sandbox: true,
      additionalArguments: systemLocaleArguments(),
    },
    backgroundColor: '#1e1e2e',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // The renderer blocks unload while page edits are unsaved (beforeunload).
  // Ask before discarding them; "Leave" lets the window close.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Leave without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved page changes',
      message: 'Leave without saving your page changes?',
      detail: 'Your edits are only in memory. The original file on disk has not been changed.',
    });
    if (choice === 0) event.preventDefault();
  });

  // Right-click on the page: Copy and Select All Text on Page (src/context-menu.cjs).
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = buildPageContextMenu(params, {
      onSelectAll: () => mainWindow.webContents.send('menu-select-all'),
    });
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // Hardening for a local-only reader (Phase 9). Security posture is unchanged
  // otherwise: context isolation stays on, Node integration stays off, and
  // webSecurity is never disabled.
  //
  // - Outline/bookmark URLs and any other window.open() target leave the app:
  //   http(s) links open in the system browser; nothing else opens anywhere.
  // - The viewer never navigates after its initial load, so page-initiated
  //   navigation away from it is blocked. The expected URL is captured after
  //   the first successful load, so startup itself can never be blocked.
  // - The app requests no device or system permissions; all are denied except
  //   the Fullscreen API the reader itself uses (F11 / fullscreen button).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  let startPageUrl = null;
  mainWindow.webContents.on('did-finish-load', () => {
    if (!startPageUrl && mainWindow && !mainWindow.isDestroyed()) {
      startPageUrl = mainWindow.webContents.getURL();
    }
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (startPageUrl && url !== startPageUrl) event.preventDefault();
  });
  const ALLOWED_PERMISSIONS = new Set(['fullscreen']);
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

  // Build menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-open-file'),
        },
        {
          label: 'Close PDF',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('menu-close-file'),
        },
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow.webContents.send('menu-print'),
        },
        { type: 'separator' },
        {
          label: 'Page Tools…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow.webContents.send('menu-page-tools'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu-save-as'),
        },
        {
          label: 'Duplicate Document…',
          click: () => mainWindow.webContents.send('menu-duplicate'),
        },
        { type: 'separator' },
        {
          label: 'Fill Form Fields',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow.webContents.send('menu-forms'),
        },
        {
          label: 'Document Security…',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => mainWindow.webContents.send('menu-security'),
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Find in Document...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.send('menu-find'),
        },
        { type: 'separator' },
        {
          label: 'Select All Text on Page',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow.webContents.send('menu-select-all'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow.webContents.send('menu-zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('menu-zoom-out'),
        },
        {
          label: 'Fit Page',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('menu-fit-page'),
        },
        {
          label: 'Fit Width',
          accelerator: 'CmdOrCtrl+Shift+0',
          click: () => mainWindow.webContents.send('menu-fit-width'),
        },
        { type: 'separator' },
        {
          label: 'Continuous Scroll / Single Page',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => mainWindow.webContents.send('menu-view-mode'),
        },
        { type: 'separator' },
        {
          label: 'Previous Page',
          accelerator: 'PageUp',
          click: () => mainWindow.webContents.send('menu-prev-page'),
        },
        {
          label: 'Next Page',
          accelerator: 'PageDown',
          click: () => mainWindow.webContents.send('menu-next-page'),
        },
        { type: 'separator' },
        {
          label: 'Rotate Clockwise',
          accelerator: 'CmdOrCtrl+Right',
          click: () => mainWindow.webContents.send('menu-rotate-cw'),
        },
        {
          label: 'Rotate Counter-clockwise',
          accelerator: 'CmdOrCtrl+Left',
          click: () => mainWindow.webContents.send('menu-rotate-ccw'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'F9',
          click: () => mainWindow.webContents.send('menu-sidebar'),
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => mainWindow.webContents.send('menu-fullscreen'),
        },
        {
          label: 'Toggle Dark/Light',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow.webContents.send('menu-toggle-theme'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'F1',
          click: () => mainWindow.webContents.send('menu-shortcuts'),
        },
        { type: 'separator' },
        {
          label: 'About Cambuz PDF Reader',
          click: () => showAboutWindow(),
        },
      ],
    },
  ];

  // macOS only: restore the application menu (Quit) and Edit copy/paste roles.
  const menu = Menu.buildFromTemplate(applyMacMenuRoles(template, process.platform, 'Cambuz PDF Reader'));
  Menu.setApplicationMenu(menu);
}

// Help → About Cambuz PDF Reader: a small sandboxed dialog (src/about.html)
// showing the official icon, the product identity and the version of the
// running application (app.getVersion(), passed in the page query string —
// never hard-coded). It is a local page with no remote content; the website
// link leaves the app through the same policy as the main window: http(s)
// URLs open in the system browser and every other navigation is denied, so
// the site is never rendered inside the app.
function showAboutWindow() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const about = new BrowserWindow({
    width: 420,
    height: 470,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    title: 'About Cambuz PDF Reader',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#1e1e2e',
    autoHideMenuBar: true,
    parent,
    modal: Boolean(parent),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  about.loadFile(path.join(__dirname, 'src', 'about.html'), {
    query: { version: app.getVersion() },
  });
  about.once('ready-to-show', () => about.show());
  about.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  about.webContents.on('will-navigate', (event) => event.preventDefault());
}

// IPC handlers
ipcMain.handle('dialog-open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Read a PDF from disk for the renderer (Phase 2: correct Electron file
// loading + reopen of recent files by path).
ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false, error: 'No file path provided' };
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return { ok: false, error: 'Not a file' };
    }
    const buffer = await fs.promises.readFile(filePath);
    return {
      ok: true,
      name: path.basename(filePath),
      size: buffer.length,
      data: new Uint8Array(buffer),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Bundled sample PDFs for the welcome-screen buttons. The renderer is loaded from
// file://, where it cannot fetch the app's own files by URL, so the bytes are read
// here instead. Only names on the bundled-sample list are readable.
ipcMain.handle('read-sample', async (_event, name) => {
  try {
    const filePath = bundledSamplePath(__dirname, name);
    if (!filePath) return { ok: false, error: 'Unknown sample document' };
    const buffer = await fs.promises.readFile(filePath);
    return {
      ok: true,
      name,
      size: buffer.length,
      data: new Uint8Array(buffer),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Phase 7: optional OCR remains entirely local and is invoked only after the
// renderer's explicit per-page request. The adapter accepts only a bounded PNG
// and an allow-listed Tesseract language selection.
ipcMain.handle('ocr-status', async () => getOcrStatus());
ipcMain.handle('ocr-page', async (_event, imageBytes, languages) => {
  try {
    return { ok: true, ...(await recognizePng(imageBytes, languages)) };
  } catch (error) {
    return { ok: false, error: error.message || 'The optional OCR operation failed.' };
  }
});

// Phase 4: pick one or more PDFs to append (merge) into the working copy.
ipcMain.handle('dialog-open-pdfs', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add PDF pages',
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

// Print-ready artifacts are bounded at the IPC boundary. Cambuz no longer
// enumerates printers or submits silent/direct jobs: the prepared PDF is handed
// to the registered system viewer only after an explicit user action.
const MAX_PRINT_PDF_BYTES = 250 * 1024 * 1024;

function asPdfBuffer(input) {
  if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_PRINT_PDF_BYTES) throw new Error('The print-ready PDF exceeds the 250 MiB limit.');
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    if (input.byteLength > MAX_PRINT_PDF_BYTES) throw new Error('The print-ready PDF exceeds the 250 MiB limit.');
    return Buffer.from(input);
  }
  if (Array.isArray(input) && input.length <= MAX_PRINT_PDF_BYTES &&
      input.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return Buffer.from(input);
  }
  throw new Error('Invalid print-ready PDF data.');
}

// Paths created for shell.openPath are tracked so that, if Cambuz itself is the
// registered PDF viewer, the second-instance callback cannot replace the PDF
// the user is currently reading with our temporary copy.
const activeSystemViewerCopies = new Map();
const viewerCleanupTimers = new Map();

function forgetSystemViewerCopy(copy) {
  if (!copy) return;
  activeSystemViewerCopies.delete(path.resolve(copy.filePath));
  const timer = viewerCleanupTimers.get(copy.directory);
  if (timer) clearTimeout(timer);
  viewerCleanupTimers.delete(copy.directory);
}

async function cleanupSystemViewerCopy(copy) {
  forgetSystemViewerCopy(copy);
  await removeViewerCopy(copy).catch(() => {
    // The registered viewer may still hold the file open on Windows. Startup
    // cleanup retries it after the bounded retention period.
  });
}

function scheduleSystemViewerCleanup(copy) {
  const timer = setTimeout(() => cleanupSystemViewerCopy(copy), DEFAULT_MAX_AGE_MS);
  timer.unref?.();
  viewerCleanupTimers.set(copy.directory, timer);
}

ipcMain.handle('open-pdf-in-system-viewer', async (_event, rawBytes, rawOptions = {}) => {
  let copy = null;
  try {
    const buffer = validatePdfForSave(rawBytes);
    const suggestedName = safeFileName(rawOptions?.suggestedName || 'document-print-ready.pdf');
    copy = await createViewerCopy({
      tempRoot: app.getPath('temp'),
      pdfBuffer: buffer,
      suggestedName,
    });
    activeSystemViewerCopies.set(path.resolve(copy.filePath), copy);

    // shell.openPath opens the exact PDF with the OS registered application. It
    // does not request printing itself, so no job is silently submitted and the
    // system viewer retains printer selection and cancellation control.
    const errorMessage = await shell.openPath(copy.filePath);
    if (errorMessage) throw new Error(errorMessage);
    scheduleSystemViewerCleanup(copy);
    return { ok: true };
  } catch (error) {
    if (copy) await cleanupSystemViewerCopy(copy);
    return { ok: false, error: error.message || 'The system PDF viewer could not be opened.' };
  }
});

// ---------------------------------------------------------------------------
// Phase 4: safe file writes. Originals are protected: a save only replaces an
// existing file after an explicit confirmation, and writes go to a temporary
// file first so an interrupted save cannot leave a half-written PDF behind.

const MAX_SAVE_FILES = 200;

function samePath(a, b) {
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function safeFileName(name) {
  const cleaned = path
    .basename(String(name || ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 200);
  const base = cleaned || 'document.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function validatePdfForSave(rawBytes) {
  const buffer = asPdfBuffer(rawBytes);
  if (buffer.length < 5 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('The data to save is not a valid PDF file.');
  }
  return buffer;
}

async function writeFileAtomically(targetPath, buffer) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, buffer, { flag: 'wx' });
    await fs.promises.rename(tempPath, targetPath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function confirmOverwrite(targetPath, originalPath) {
  const isOriginal = Boolean(originalPath) && samePath(targetPath, originalPath);
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', isOriginal ? 'Overwrite original' : 'Replace file'],
    defaultId: 0,
    cancelId: 0,
    title: isOriginal ? 'Overwrite the original PDF?' : 'Replace existing file?',
    message: isOriginal
      ? 'Overwrite the original PDF?'
      : `"${path.basename(targetPath)}" already exists. Replace it?`,
    detail: isOriginal
      ? 'This replaces the file you opened. To keep the original, use Save As with a new name.'
      : 'The existing file will be replaced.',
  });
  return response.response === 1;
}

// Print-ready export is separate from opening/printing. It writes the exact
// bytes previewed by PDF.js and never treats a successful write as proof that a
// physical printer will render them correctly.
ipcMain.handle('save-print-ready-pdf', async (_event, rawBytes, rawOptions = {}) => {
  try {
    const buffer = validatePdfForSave(rawBytes);
    const suggested = safeFileName(rawOptions?.suggestedName || 'document-print-ready.pdf');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save print-ready PDF',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    let targetPath = path.resolve(result.filePath);
    if (!/\.pdf$/i.test(targetPath)) targetPath += '.pdf';
    if (fs.existsSync(targetPath)) {
      const confirmed = await confirmOverwrite(targetPath, '');
      if (!confirmed) return { ok: false, canceled: true };
    }
    await writeFileAtomically(targetPath, buffer);
    return { ok: true, path: targetPath, name: path.basename(targetPath) };
  } catch (error) {
    return { ok: false, error: error.message || 'The print-ready PDF could not be saved.' };
  }
});

// Save As / Duplicate: the user picks the destination in a native dialog.
ipcMain.handle('save-pdf', async (_event, rawBytes, rawOptions = {}) => {
  try {
    const buffer = validatePdfForSave(rawBytes);
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const originalPath = typeof options.originalPath === 'string' && options.originalPath
      ? path.resolve(options.originalPath)
      : '';
    const suggested = safeFileName(options.suggestedName);
    const defaultDirectory = originalPath ? path.dirname(originalPath) : app.getPath('documents');

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: path.join(defaultDirectory, suggested),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    let targetPath = path.resolve(result.filePath);
    if (!/\.pdf$/i.test(targetPath)) targetPath += '.pdf';

    const exists = fs.existsSync(targetPath);
    const isOriginal = Boolean(originalPath) && samePath(targetPath, originalPath);
    if (exists || isOriginal) {
      const confirmed = await confirmOverwrite(targetPath, originalPath);
      if (!confirmed) return { ok: false, canceled: true };
    }

    await writeFileAtomically(targetPath, buffer);
    return { ok: true, path: targetPath, name: path.basename(targetPath), overwroteOriginal: isOriginal };
  } catch (err) {
    return { ok: false, error: err.message || 'The PDF could not be saved.' };
  }
});

// Split: the user picks one folder; every part is written there.
ipcMain.handle('save-pdf-files', async (_event, rawFiles, rawOptions = {}) => {
  try {
    if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > MAX_SAVE_FILES) {
      throw new Error(`Between 1 and ${MAX_SAVE_FILES} files can be saved at once.`);
    }
    const files = rawFiles.map((file) => ({
      name: safeFileName(file && file.name),
      buffer: validatePdfForSave(file && file.bytes),
    }));
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const originalPath = typeof options.originalPath === 'string' && options.originalPath
      ? path.resolve(options.originalPath)
      : '';

    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the split PDFs',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    const directory = picked.filePaths[0];

    const targets = files.map((file) => path.join(directory, file.name));
    const conflicts = targets.filter((target) => fs.existsSync(target));
    const touchesOriginal = originalPath && targets.some((target) => samePath(target, originalPath));
    if (conflicts.length > 0 || touchesOriginal) {
      const response = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', touchesOriginal ? 'Overwrite original' : 'Replace files'],
        defaultId: 0,
        cancelId: 0,
        title: touchesOriginal ? 'Overwrite the original PDF?' : 'Replace existing files?',
        message: touchesOriginal
          ? 'One of the split files would overwrite the original PDF.'
          : `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} already exist in this folder. Replace them?`,
        detail: 'Choose a different folder to keep existing files.',
      });
      if (response.response !== 1) return { ok: false, canceled: true };
    }

    const written = [];
    for (let index = 0; index < files.length; index += 1) {
      await writeFileAtomically(targets[index], files[index].buffer);
      written.push(path.basename(targets[index]));
    }
    return { ok: true, directory, files: written };
  } catch (err) {
    return { ok: false, error: err.message || 'The files could not be saved.' };
  }
});

// ---------------------------------------------------------------------------
// Phase 9: opening PDFs from the operating system.
//
// Double-click, "Open with Cambuz", and launching with a file path all end up
// here: Windows/Linux deliver the path as a command-line argument (at startup
// or through `second-instance`), macOS through the `open-file` event. The path
// is passed to the renderer over `open-file-path` (or returned from the
// `renderer-ready` handshake when it arrives before the renderer exists) and
// read through the same sandboxed `read-file` channel as the Open dialog, so
// paths with spaces or non-ASCII characters need no special handling and a
// missing file surfaces the same clear in-app error.

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function deliverOsFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return;
  const resolved = path.resolve(filePath);
  const viewerCopy = activeSystemViewerCopies.get(resolved);
  if (viewerCopy) {
    // Cambuz is currently the registered PDF application. Do not replace the
    // user's open document with the temporary handoff copy.
    cleanupSystemViewerCopy(viewerCopy);
    if (rendererIsReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system-viewer-unavailable', {
        message: 'Cambuz is registered as the system PDF viewer, so it cannot hand this file to a different app automatically. Download the print-ready PDF and use “Open with” to choose another viewer.',
      });
    }
    return;
  }
  if (rendererIsReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-file-path', filePath);
  } else {
    pendingOsFile = filePath;
  }
}

// The renderer calls this once it has registered its `open-file-path`
// listener. Any file that arrived earlier is returned so the renderer can
// open it instead of its default startup document.
ipcMain.handle('renderer-ready', () => {
  rendererIsReady = true;
  const file = pendingOsFile;
  pendingOsFile = null;
  return { file };
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // A second launch while Cambuz runs: focus the window and open its PDF.
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    deliverOsFile(pdfPathFromArgv(argv));
  });
}

app.on('open-file', (event, filePath) => {
  // macOS: may arrive before the app is ready, in which case the file waits
  // in pendingOsFile until the `renderer-ready` handshake collects it.
  event.preventDefault();
  deliverOsFile(filePath);
});

app.whenReady().then(() => {
  const startupPdf = pdfPathFromArgv(process.argv);
  if (startupPdf) pendingOsFile = startupPdf;
  // Best-effort cleanup only. A locked Windows file is retained and retried on
  // a later launch; certificate/TLS settings and file permissions are untouched.
  cleanupStaleViewerCopies({ tempRoot: app.getPath('temp') }).catch(() => {});
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
