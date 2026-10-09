#!/usr/bin/env node
/**
 * 从 recognition-assets.json 同步图例 SVG 到 uploads 目录。
 * 用法: node scripts/sync-recognition-glyphs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'backend/data/recognition-assets.json');
const glyphDir = path.join(root, 'backend/uploads/recognition-assets/glyphs');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
fs.mkdirSync(glyphDir, { recursive: true });

let written = 0;
for (const symbol of catalog.symbols || []) {
  if (!symbol.id || !symbol.glyphSvg) continue;
  fs.writeFileSync(path.join(glyphDir, `${symbol.id}.svg`), symbol.glyphSvg, 'utf8');
  written += 1;
}

console.log(JSON.stringify({
  version: catalog.version,
  symbols: catalog.symbols?.length || 0,
  glyphsWritten: written,
  glyphDir
}, null, 2));
