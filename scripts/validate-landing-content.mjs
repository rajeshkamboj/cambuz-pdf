#!/usr/bin/env node
// Cambuz PDF Reader — validate docs/landing-content.json.
//
// Ensures the reviewed feature manifest consumed by rajeshkamboj/cambuz-landing
// conforms to the schema contract before any release or landing-site sync runs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'landing-content.json');

export const SUPPORTED_SCHEMA_VERSION = 1;
export const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const ICON_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
export const MIN_BULLETS = 1;
export const MAX_BULLETS = 8;

export const VALID_SCREENSHOT_IDS = Object.freeze([
  'reading',
  'search',
  'selection',
  'print',
  'languages',
  'desktop',
]);

export const REQUIRED_STRING_FIELDS = Object.freeze([
  'id',
  'headline',
  'description',
  'screenshotAlt',
  'screenshotCaption',
  'icon',
  'screenshotId',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a parsed landing-content manifest object.
 *
 * @param {unknown} manifest
 * @param {{ repoRoot?: string, validScreenshotIds?: Iterable<string> }} [options]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLandingContent(manifest, options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : REPO_ROOT;
  const validScreenshotIds = new Set(options.validScreenshotIds ?? VALID_SCREENSHOT_IDS);
  const errors = [];

  if (!isPlainObject(manifest)) {
    return { valid: false, errors: ['Manifest root must be a JSON object'] };
  }

  if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(
      `Invalid or missing schemaVersion: expected ${SUPPORTED_SCHEMA_VERSION}, got ${JSON.stringify(manifest.schemaVersion)}`,
    );
  }

  if (typeof manifest.releaseNotesPath !== 'string' || manifest.releaseNotesPath.trim().length === 0) {
    errors.push('Invalid releaseNotesPath: must be a non-empty string');
  } else {
    const relPath = manifest.releaseNotesPath.trim();
    if (
      relPath !== manifest.releaseNotesPath ||
      relPath.startsWith('/') ||
      relPath.includes('\\') ||
      relPath.split('/').includes('..') ||
      !/^docs\/[A-Za-z0-9._-]+\.md$/.test(relPath)
    ) {
      errors.push(
        `Invalid releaseNotesPath "${manifest.releaseNotesPath}": must be a relative Markdown path under docs/`,
      );
    } else {
      const resolvedNotes = path.resolve(repoRoot, relPath);
      const relativeToRoot = path.relative(repoRoot, resolvedNotes);
      if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
        errors.push(`Invalid releaseNotesPath "${manifest.releaseNotesPath}": resolves outside repository root`);
      } else if (!fs.existsSync(resolvedNotes)) {
        errors.push(`Invalid releaseNotesPath "${manifest.releaseNotesPath}": file does not exist`);
      } else {
        const stat = fs.statSync(resolvedNotes);
        if (!stat.isFile() || stat.size === 0) {
          errors.push(`Invalid releaseNotesPath "${manifest.releaseNotesPath}": must be a non-empty file`);
        }
      }
    }
  }

  if (!Array.isArray(manifest.features) || manifest.features.length === 0) {
    errors.push('Invalid features: must be a non-empty array of feature entries');
    return { valid: errors.length === 0, errors };
  }

  const seenIds = new Set();

  manifest.features.forEach((feature, index) => {
    const label = isPlainObject(feature) && typeof feature.id === 'string' && feature.id.trim()
      ? `features[${index}] ("${feature.id}")`
      : `features[${index}]`;

    if (!isPlainObject(feature)) {
      errors.push(`${label}: must be an object`);
      return;
    }

    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof feature[field] !== 'string' || feature[field].trim().length === 0) {
        errors.push(`${label}: missing or non-string required field "${field}"`);
      }
    }

    if (typeof feature.id === 'string' && feature.id.trim().length > 0) {
      if (feature.id !== feature.id.trim() || !KEBAB_CASE_RE.test(feature.id)) {
        errors.push(
          `${label}: invalid feature id "${feature.id}" (must be lowercase kebab-case matching ${KEBAB_CASE_RE})`,
        );
      }
      if (seenIds.has(feature.id)) {
        errors.push(`${label}: duplicate feature id "${feature.id}"`);
      }
      seenIds.add(feature.id);
    }

    if (typeof feature.icon === 'string' && feature.icon.trim().length > 0) {
      if (!ICON_NAME_RE.test(feature.icon)) {
        errors.push(`${label}: invalid icon "${feature.icon}" (must be a PascalCase icon name)`);
      }
    }

    if (typeof feature.screenshotId === 'string' && feature.screenshotId.trim().length > 0) {
      if (!KEBAB_CASE_RE.test(feature.screenshotId) || !validScreenshotIds.has(feature.screenshotId)) {
        errors.push(
          `${label}: invalid screenshotId "${feature.screenshotId}" (expected one of: ${[...validScreenshotIds].join(', ')})`,
        );
      }
    }

    if (!Array.isArray(feature.bullets)) {
      errors.push(`${label}: missing or invalid "bullets" array`);
    } else {
      if (feature.bullets.length < MIN_BULLETS || feature.bullets.length > MAX_BULLETS) {
        errors.push(
          `${label}: "bullets" must have between ${MIN_BULLETS} and ${MAX_BULLETS} items (found ${feature.bullets.length})`,
        );
      }
      feature.bullets.forEach((bullet, bulletIndex) => {
        if (typeof bullet !== 'string' || bullet.trim().length === 0) {
          errors.push(`${label}: bullets[${bulletIndex}] must be a non-empty string`);
        }
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Read and validate a landing-content JSON file from disk.
 *
 * @param {string} [manifestPath]
 * @param {{ repoRoot?: string, validScreenshotIds?: Iterable<string> }} [options]
 */
export function validateLandingContentFile(manifestPath = DEFAULT_MANIFEST_PATH, options = {}) {
  const resolvedPath = path.resolve(manifestPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Landing content manifest not found: ${resolvedPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${resolvedPath}: ${err.message}`);
  }
  const result = validateLandingContent(parsed, options);
  if (!result.valid) {
    throw new Error(
      `Landing content validation failed for ${path.relative(REPO_ROOT, resolvedPath) || resolvedPath}:\n  - ${result.errors.join('\n  - ')}`,
    );
  }
  return parsed;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_MANIFEST_PATH;
  try {
    const manifest = validateLandingContentFile(targetPath);
    const ids = manifest.features.map((f) => f.id).join(', ');
    console.log(
      `Validated ${path.relative(REPO_ROOT, targetPath)} (schemaVersion=${manifest.schemaVersion}, ${manifest.features.length} features: ${ids}).`,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
