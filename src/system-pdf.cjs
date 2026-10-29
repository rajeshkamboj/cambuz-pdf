'use strict';

// Temporary-file lifecycle for the explicit “Open PDF in system viewer” action.
// The default viewer may keep reading the file after shell.openPath resolves, so
// copies are retained for a bounded period and stale copies are removed on the
// next app start (and by a delayed cleanup while the app remains open).

const fs = require('fs');
const path = require('path');

const VIEWER_ROOT_NAME = 'cambuz-pdf-system-viewer';
const VIEWER_DIRECTORY_PREFIX = 'document-';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safePdfName(name) {
  const cleaned = path
    .basename(String(name || 'document-print-ready.pdf'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 180);
  const base = cleaned || 'document-print-ready.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function viewerRoot(tempRoot) {
  if (typeof tempRoot !== 'string' || !tempRoot) throw new Error('A temporary directory is required.');
  return path.join(path.resolve(tempRoot), VIEWER_ROOT_NAME);
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function createViewerCopy({ tempRoot, pdfBuffer, suggestedName }) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 5 ||
      !pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('The data to open is not a valid PDF file.');
  }

  const root = viewerRoot(tempRoot);
  await fs.promises.mkdir(root, { recursive: true });
  const directory = await fs.promises.mkdtemp(path.join(root, VIEWER_DIRECTORY_PREFIX));
  const filePath = path.join(directory, safePdfName(suggestedName));
  try {
    // Exclusive creation prevents an accidental overwrite even if a future
    // filename change makes two paths collide.
    await fs.promises.writeFile(filePath, pdfBuffer, { flag: 'wx' });
    return { root, directory, filePath };
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function removeViewerCopy(copy) {
  if (!copy || typeof copy.root !== 'string' || typeof copy.directory !== 'string') return false;
  const root = path.resolve(copy.root);
  const directory = path.resolve(copy.directory);
  if (!isInside(root, directory) || directory === root || !path.basename(directory).startsWith(VIEWER_DIRECTORY_PREFIX)) {
    throw new Error('Refusing to remove a path outside the system-viewer temporary directory.');
  }
  await fs.promises.rm(directory, { recursive: true, force: true });
  return true;
}

async function cleanupStaleViewerCopies({
  tempRoot,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const root = viewerRoot(tempRoot);
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: 0, failed: 0 };
    throw error;
  }

  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(VIEWER_DIRECTORY_PREFIX)) continue;
    const directory = path.join(root, entry.name);
    try {
      const stat = await fs.promises.stat(directory);
      if (Number(now) - stat.mtimeMs < Number(maxAgeMs)) continue;
      await fs.promises.rm(directory, { recursive: true, force: true });
      removed += 1;
    } catch (_) {
      // A Windows PDF viewer can hold the file open. Leave it for the next
      // cleanup pass rather than weakening file permissions or forcing it shut.
      failed += 1;
    }
  }
  return { removed, failed };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  VIEWER_ROOT_NAME,
  cleanupStaleViewerCopies,
  createViewerCopy,
  isInside,
  removeViewerCopy,
  safePdfName,
  viewerRoot,
};
