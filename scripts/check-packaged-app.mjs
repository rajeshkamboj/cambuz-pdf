#!/usr/bin/env node
// Cambuz PDF Reader — packaged-contents check.
//
// Reads the header of a packaged app.asar (no extraction) and verifies that the
// files the desktop renderer loads are present and that development-only or
// unused payloads were not packaged. Exits non-zero when a check fails.
//
// Usage: node scripts/check-packaged-app.mjs <path/to/app.asar>

import fs from 'node:fs';
import { BUNDLED_SAMPLES } from '../src/bundled-samples.cjs';

const REQUIRED_FILES = [
  'main.js',
  'preload.js',
  'package.json',
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'assets/icon.png',
  'src/index.html',
  'src/about.html',
  'src/renderer.js',
  'src/bundled-samples.cjs',
  'src/context-menu.cjs',
  'src/file-open.cjs',
  'src/text-selection.js',
  'node_modules/pdfjs-dist/build/pdf.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.mjs',
  'node_modules/pdf-lib/dist/pdf-lib.esm.js',
  ...BUNDLED_SAMPLES.map((sample) => `samples/${sample}`),
];
const REQUIRED_DIRECTORIES = ['node_modules/pdfjs-dist/standard_fonts'];

// Paths that must never ship: tests/tooling, the Electron toolchain itself,
// the Node-only canvas binding that the renderer never loads, the dev-only
// preview server, and source maps.
const FORBIDDEN = [
  (p) => p.startsWith('scripts/'),
  (p) => p.startsWith('.github/'),
  (p) => p.startsWith('node_modules/electron/') || p.startsWith('node_modules/electron-builder/'),
  (p) => p.startsWith('node_modules/jsdom/'),
  (p) => p.startsWith('node_modules/express/'),
  (p) => p.includes('/@napi-rs/'),
  (p) => p.includes('pdfjs-dist/legacy/'),
  (p) => p.endsWith('.map'),
  // Pruned by scripts/stage-app.mjs (allowlist): PDF.js assets the app never
  // fetches and pdf-lib's module trees (the app loads only its ESM bundle).
  (p) => /^node_modules\/pdfjs-dist\/(cmaps|image_decoders|web|types)\//.test(p),
  (p) => /^node_modules\/pdf-lib\/(cjs|es|src|ts3\.4)\//.test(p),
  (p) => /\.min\.m?js$/.test(p),
  (p) => p.endsWith('.d.ts') || /(^|\/)README(\.md)?$/i.test(p),
];

// Size budget for the app payload (file data inside app.asar). The staged
// payload is about 5.7 MiB; the budget leaves headroom for features while
// catching a dependency or staging change that would re-bloat the package.
const MAX_PAYLOAD_MIB = 8;

function readAsarHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const prefix = Buffer.alloc(8);
    if (fs.readSync(fd, prefix, 0, 8, 0) !== 8) throw new Error('asar is too small to contain a header');
    const headerPickleSize = prefix.readUInt32LE(4);
    const headerBuffer = Buffer.alloc(headerPickleSize);
    if (fs.readSync(fd, headerBuffer, 0, headerPickleSize, 8) !== headerPickleSize) {
      throw new Error('asar header is truncated');
    }
    const jsonLength = headerBuffer.readUInt32LE(4);
    const header = JSON.parse(headerBuffer.subarray(8, 8 + jsonLength).toString('utf8'));
    return { fd, header, dataOffset: 8 + headerPickleSize };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function* walk(node, prefix = '') {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const entryPath = prefix ? `${prefix}/${name}` : name;
    if (entry.files) {
      yield { path: entryPath, directory: true };
      yield* walk(entry, entryPath);
    } else {
      yield { path: entryPath, size: entry.size ?? 0, offset: entry.offset, unpacked: Boolean(entry.unpacked) };
    }
  }
}

function main() {
  const archive = process.argv[2];
  if (!archive) {
    console.error('Usage: node scripts/check-packaged-app.mjs <path/to/app.asar>');
    process.exit(2);
  }

  const { fd, header, dataOffset } = readAsarHeader(archive);
  try {
    const entries = [...walk(header)];
    const files = new Map(entries.filter((e) => !e.directory).map((e) => [e.path, e]));
    const directories = new Set(entries.filter((e) => e.directory).map((e) => e.path));
    const hasDirectory = (dir) => directories.has(dir) || [...files.keys()].some((f) => f.startsWith(`${dir}/`));
    const totalBytes = [...files.values()].reduce((sum, e) => sum + e.size, 0);

    let failures = 0;
    const report = (ok, label, detail = '') => {
      if (!ok) failures += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    };

    console.log(`Packaged app: ${archive}`);
    console.log(`Entries: ${files.size} files, ${directories.size} directories, ${(totalBytes / 1048576).toFixed(1)} MiB of file data`);

    for (const file of REQUIRED_FILES) report(files.has(file), `required file ${file}`);
    for (const dir of REQUIRED_DIRECTORIES) report(hasDirectory(dir), `required directory ${dir}`);

    report(
      totalBytes <= MAX_PAYLOAD_MIB * 1048576,
      `app payload within the ${MAX_PAYLOAD_MIB} MiB budget`,
      `${(totalBytes / 1048576).toFixed(1)} MiB`,
    );

    const forbidden = [...files.keys()].filter((p) => FORBIDDEN.some((test) => test(p)));
    report(forbidden.length === 0, 'no development-only or unused payloads', forbidden.length ? `found ${forbidden.length}, e.g. ${forbidden.slice(0, 3).join(', ')}` : '');

    const packageEntry = files.get('package.json');
    if (packageEntry) {
      const buffer = Buffer.alloc(packageEntry.size);
      fs.readSync(fd, buffer, 0, packageEntry.size, dataOffset + Number(packageEntry.offset));
      const manifest = JSON.parse(buffer.toString('utf8'));
      report(manifest.productName === 'Cambuz PDF Reader', 'packaged package.json productName', String(manifest.productName));
      report(typeof manifest.main === 'string' && files.has(manifest.main), 'packaged package.json main entry exists', String(manifest.main));
    }

    console.log(failures === 0 ? 'All packaged-contents checks passed.' : `${failures} packaged-contents check(s) failed.`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    fs.closeSync(fd);
  }
}

main();
