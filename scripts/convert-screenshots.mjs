#!/usr/bin/env node
/**
 * Converts the PNG masters captured by `scripts/capture-screenshots.mjs` into
 * the WebP files the README and the landing page use, and writes the manifest
 * next to them.
 *
 * Only three operations are allowed on a real capture — crop, resize and format
 * conversion — and this script does exactly those:
 *
 *   content shots (method `cdp-content`)  2880×1800 → 2048×1280 WebP, q82
 *   desktop shots (method `desktop-screen`) 16:10 crop → max width 2048 WebP, q82
 *
 * `sharp` is deliberately not a dependency of this project: pass the directory
 * that holds it (`--sharp /tmp/sharp`, or SHARP_DIR) and nothing is added to
 * package.json.
 *
 * Usage:
 *   node scripts/convert-screenshots.mjs --in <masters dir> --out assets/screenshots \
 *        [--sharp /tmp/sharp] [--ci-run-url <url>] [--commit <sha>] [--quality 82] [--prune]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const CONTENT_WIDTH = 2048;
const CONTENT_HEIGHT = 1280;
const DESKTOP_MAX_WIDTH = 2048;
const BYTE_BUDGET = 300 * 1024;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument "${token}"`);
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options[name] = 'true';
    } else {
      options[name] = next;
      i += 1;
    }
  }
  return options;
}

function loadSharp(directory) {
  const base = path.resolve(directory);
  const manifest = path.join(base, 'package.json');
  if (!fs.existsSync(manifest)) {
    throw new Error(`No package.json in "${base}"; install sharp there or pass --sharp <dir>`);
  }
  const requireFrom = createRequire(manifest);
  try {
    return requireFrom('sharp');
  } catch (error) {
    throw new Error(`Could not load sharp from "${base}": ${error.message}`);
  }
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function ciRunUrlFromEnv() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

async function convertContent(sharp, masterPath, targetPath, quality) {
  const image = sharp(masterPath, { failOn: 'error' });
  const meta = await image.metadata();
  if (meta.width !== 2880 || meta.height !== 1800) {
    throw new Error(`${path.basename(masterPath)} is ${meta.width}×${meta.height}; content masters must be 2880×1800`);
  }
  await image
    .resize(CONTENT_WIDTH, CONTENT_HEIGHT, { fit: 'fill' })
    .webp({ quality, effort: 6 })
    .toFile(targetPath);
  return { width: CONTENT_WIDTH, height: CONTENT_HEIGHT };
}

async function convertDesktop(sharp, masterPath, targetPath, quality) {
  const image = sharp(masterPath, { failOn: 'error' });
  const meta = await image.metadata();
  let pipeline = image;
  // Crop to 16:10 around the centre (no scaling artefacts, no retouching).
  const targetRatio = 16 / 10;
  const ratio = meta.width / meta.height;
  if (Math.abs(ratio - targetRatio) > 0.01) {
    const cropWidth = ratio > targetRatio ? Math.round(meta.height * targetRatio) : meta.width;
    const cropHeight = ratio > targetRatio ? meta.height : Math.round(meta.width / targetRatio);
    pipeline = pipeline.extract({
      left: Math.round((meta.width - cropWidth) / 2),
      top: Math.round((meta.height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    });
  }
  const width = Math.min(DESKTOP_MAX_WIDTH, meta.width);
  const height = Math.round((width * 10) / 16);
  await pipeline.resize(width, height, { fit: 'fill' }).webp({ quality, effort: 6 }).toFile(targetPath);
  return { width, height };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mastersDir = path.resolve(options.in ?? 'screenshots/win');
  const outDir = path.resolve(options.out ?? 'assets/screenshots');
  const quality = Number(options.quality ?? 82);
  if (!fs.existsSync(mastersDir)) throw new Error(`No masters directory at ${mastersDir}`);
  const reportPath = path.join(mastersDir, 'capture-report.json');
  if (!fs.existsSync(reportPath)) throw new Error(`No capture-report.json in ${mastersDir}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const sharp = loadSharp(options.sharp ?? process.env.SHARP_DIR ?? '/tmp/sharp');
  const commit = options.commit && options.commit !== 'true' ? options.commit : gitCommit();
  const ciRunUrl = options['ci-run-url'] && options['ci-run-url'] !== 'true' ? options['ci-run-url'] : ciRunUrlFromEnv();

  fs.mkdirSync(outDir, { recursive: true });

  const contentShots = (report.shots ?? []).filter((shot) => shot.method === 'cdp-content');
  const desktopShots = (report.desktop ?? []).filter((shot) => shot.method === 'desktop-screen');
  if (contentShots.length === 0 && desktopShots.length === 0) throw new Error('The capture report lists no shots to convert');

  const entries = [];
  const rows = [];
  const written = new Set();

  for (const shot of contentShots) {
    const masterPath = path.join(mastersDir, shot.file);
    if (!fs.existsSync(masterPath)) throw new Error(`Missing master ${shot.file} (the capture did not produce it)`);
    const target = `${path.parse(shot.file).name}.webp`;
    const targetPath = path.join(outDir, target);
    const size = await convertContent(sharp, masterPath, targetPath, quality);
    const bytes = fs.statSync(targetPath).size;
    written.add(target);
    entries.push({
      file: target,
      state: shot.state,
      sample: shot.sample ?? null,
      theme: shot.theme ?? null,
      width: size.width,
      height: size.height,
      bytes,
      commit,
      ciRunUrl,
      method: shot.method,
    });
    rows.push({ file: target, size: `${size.width}×${size.height}`, bytes, master: shot.bytes ?? null, state: shot.state, over: bytes > BYTE_BUDGET });
  }

  for (const shot of desktopShots) {
    const masterPath = path.join(mastersDir, shot.file);
    if (!fs.existsSync(masterPath)) throw new Error(`Missing desktop master ${shot.file}`);
    const target = `${path.parse(shot.file).name}.webp`;
    const targetPath = path.join(outDir, target);
    const size = await convertDesktop(sharp, masterPath, targetPath, quality);
    const bytes = fs.statSync(targetPath).size;
    written.add(target);
    entries.push({
      file: target,
      state: shot.state,
      sample: shot.sample ?? null,
      theme: shot.theme ?? null,
      width: size.width,
      height: size.height,
      bytes,
      commit,
      ciRunUrl,
      method: shot.method,
    });
    rows.push({ file: target, size: `${size.width}×${size.height}`, bytes, master: shot.bytes ?? null, state: shot.state, over: false });
  }

  if (options.prune === 'true') {
    for (const file of fs.readdirSync(outDir)) {
      if (file.endsWith('.webp') && !written.has(file)) {
        fs.rmSync(path.join(outDir, file));
        console.log(`pruned ${file}`);
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    capturedAt: report.startedAt ?? null,
    app: report.app ?? null,
    platform: report.platform ?? null,
    host: report.host ?? null,
    viewport: report.viewport ?? null,
    commit,
    ciRunUrl,
    note: 'Real captures of the packaged Windows build (scripts/capture-screenshots.mjs). Only crop, resize and WebP conversion were applied.',
    screenshots: entries,
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const missing = (report.manualCaptureNeeded ?? []).filter(Boolean);
  console.log('');
  console.log('file                          size        bytes    master bytes  over budget');
  for (const row of rows) {
    console.log(
      `${row.file.padEnd(30)}${row.size.padEnd(12)}${String(row.bytes).padStart(6)}   ${String(row.master ?? '—').padStart(8)}      ${row.over ? 'YES' : 'no'}`,
    );
  }
  console.log('');
  console.log(`${entries.length} WebP file(s) written to ${outDir}`);
  console.log(`manifest: ${manifestPath}`);
  if (commit) console.log(`commit: ${commit}`);
  if (ciRunUrl) console.log(`CI run: ${ciRunUrl}`);
  if (missing.length > 0) console.log(`manual capture still needed: ${missing.join('; ')}`);
  if (rows.some((row) => row.over)) {
    console.error('Some content shots are over the 300 KB budget; lower --quality and re-run.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
