import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'backend', 'data', 'design-assets.json');
const textureDir = path.join(root, 'backend', 'uploads', 'design-assets', 'textures', 'procedural');

const STYLE_ALIASES = {
  '现代简约': ['现代简约', '现代自然', '极简', 'modern', 'modern-natural'],
  '奶油风': ['奶油风', '法式奶油', '暖白', '米色', 'cream'],
  '新中式': ['新中式', '中式', '胡桃木'],
  '现代轻奢': ['现代轻奢', '轻奢', '香槟金', 'luxury'],
  '北欧原木': ['北欧', '原木风', '橡木', 'oak', 'nordic'],
  '日式原木': ['日式原木', '日式', '原木风', '侘寂', 'japanese', 'wabi'],
  '工业风': ['工业风', '水泥', '黑色金属', 'industrial']
};

const CATEGORY_STYLE_DEFAULTS = {
  wall_finish: ['现代简约', '奶油风', '北欧原木'],
  floor_finish: ['现代简约', '北欧原木', '日式原木'],
  ceiling_finish: ['现代简约', '奶油风', '现代轻奢'],
  lighting: ['现代简约', '现代轻奢', '奶油风'],
  cabinet: ['现代简约', '北欧原木', '奶油风'],
  appliance: ['现代简约', '奶油风', '现代轻奢'],
  furniture: ['现代简约', '北欧原木'],
  soft_decor: ['现代简约', '奶油风', '北欧原木'],
  sanitary: ['现代简约', '现代轻奢'],
  opening: ['现代简约', '北欧原木', '新中式']
};

const DOMESTIC_TAGS = ['国内户型', '商品房', '精装改造', '全屋定制', '小户型友好'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hexToRgb(hex, fallback = [190, 190, 190]) {
  const raw = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return fallback;
  }
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16)
  ];
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const index = y * (1 + width * 3) + 1 + x * 3;
      raw[index] = clamp(r);
      raw[index + 1] = clamp(g);
      raw[index + 2] = clamp(b);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function writeTexture(filePath, asset, kind) {
  const size = 128;
  const base = hexToRgb(asset.properties?.color);
  const secondary = hexToRgb(asset.properties?.secondaryColor, base.map((v) => v * 0.8));
  const material = asset.properties?.material || asset.properties?.texture || asset.category || '';
  const seed = [...asset.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);

  const pixel = (x, y) => {
    if (kind === 'roughness') {
      const value = material.includes('glass') ? 45 : material.includes('ceramic') ? 105 : 155;
      const noise = ((x * 13 + y * 7 + seed) % 23) - 11;
      return [value + noise, value + noise, value + noise];
    }
    if (kind === 'normal') {
      const line = ((x + seed) % 32 === 0 || (y + seed) % 32 === 0) ? 142 : 128;
      return [128, line, 255];
    }
    if (material.includes('wood') || material.includes('oak') || asset.name.includes('木') || asset.name.includes('橡木')) {
      const stripe = Math.sin((x + seed) / 7) * 18 + Math.sin((x + y) / 19) * 8;
      return [
        base[0] + stripe,
        base[1] + stripe * 0.65,
        base[2] + stripe * 0.35
      ];
    }
    if (asset.category === 'floor_finish' || asset.name.includes('瓷砖') || asset.name.includes('地砖')) {
      const grout = x % 32 < 2 || y % 32 < 2;
      const noise = ((x * 17 + y * 11 + seed) % 19) - 9;
      return grout
        ? secondary.map((v) => v * 0.78)
        : base.map((v) => v + noise);
    }
    if (material.includes('fabric') || asset.name.includes('布') || asset.name.includes('亚麻')) {
      const weave = ((x % 8) < 2 ? -10 : 8) + ((y % 8) < 2 ? -8 : 6);
      return base.map((v, index) => v * 0.86 + secondary[index] * 0.14 + weave);
    }
    const noise = ((x * 5 + y * 3 + seed) % 17) - 8;
    return base.map((v) => v + noise);
  };

  fs.writeFileSync(filePath, png(size, size, pixel));
}

function inferStyles(asset) {
  const text = [
    asset.id,
    asset.name,
    asset.category,
    asset.usage,
    asset.aiDescription,
    ...(asset.tags || [])
  ].join(' ').toLowerCase();
  const styles = new Set();

  for (const [style, aliases] of Object.entries(STYLE_ALIASES)) {
    if (aliases.some((alias) => text.includes(String(alias).toLowerCase()))) {
      styles.add(style);
    }
  }

  if (!styles.size) {
    for (const style of CATEGORY_STYLE_DEFAULTS[asset.category] || []) {
      styles.add(style);
    }
    if (asset.name?.includes('墨绿') || asset.name?.includes('灰') || asset.name?.includes('白')) {
      styles.add('现代简约');
    }
    if (asset.name?.includes('暖') || asset.name?.includes('米')) {
      styles.add('奶油风');
    }
    if (asset.name?.includes('木') || asset.name?.includes('橡木')) {
      styles.add('北欧原木');
      styles.add('日式原木');
    }
  }
  return [...styles];
}

function domesticTags(asset) {
  const tags = new Set(asset.domesticTags || []);
  for (const tag of DOMESTIC_TAGS) {
    tags.add(tag);
  }
  if (asset.category === 'cabinet') {
    tags.add('定制柜');
  }
  if (asset.sceneTypes?.includes('balcony')) {
    tags.add('生活阳台');
  }
  if (asset.category === 'sanitary' || asset.sceneTypes?.includes('bathroom')) {
    tags.add('干湿分离');
  }
  return [...tags];
}

function needsTexture(asset) {
  return ['wall_finish', 'floor_finish', 'ceiling_finish', 'furniture', 'cabinet', 'appliance', 'soft_decor', 'sanitary', 'opening'].includes(asset.category);
}

function shouldReplaceWithGeneratedPng(value) {
  return !value || String(value).includes('/uploads/design-assets/textures/procedural/');
}

function enrichAsset(asset) {
  const next = {
    ...asset,
    tags: [...new Set([...(asset.tags || []), ...inferStyles(asset)])],
    styleTags: inferStyles(asset),
    domesticTags: domesticTags(asset),
    styleProfile: {
      ...(asset.styleProfile || {}),
      market: 'cn-residential',
      recommendedFor: ['刚需住宅', '改善型住宅', '国内商品房'],
      avoidWith: asset.category === 'asset_source' ? ['直接用于渲染'] : []
    },
    pbrTextures: asset.pbrTextures || {}
  };

  if (needsTexture(next)) {
    const safeId = slug(next.id);
    const baseName = `${safeId}-basecolor.png`;
    const roughnessName = `${safeId}-roughness.png`;
    const normalName = `${safeId}-normal.png`;
    writeTexture(path.join(textureDir, baseName), next, 'baseColor');
    writeTexture(path.join(textureDir, roughnessName), next, 'roughness');
    writeTexture(path.join(textureDir, normalName), next, 'normal');
    if (shouldReplaceWithGeneratedPng(next.textureUrl)) {
      next.textureUrl = `/uploads/design-assets/textures/procedural/${baseName}`;
    }
    next.pbrTextures = {
      ...next.pbrTextures,
      baseColor: shouldReplaceWithGeneratedPng(next.pbrTextures.baseColor) ? `/uploads/design-assets/textures/procedural/${baseName}` : next.pbrTextures.baseColor,
      roughness: shouldReplaceWithGeneratedPng(next.pbrTextures.roughness) ? `/uploads/design-assets/textures/procedural/${roughnessName}` : next.pbrTextures.roughness,
      normal: shouldReplaceWithGeneratedPng(next.pbrTextures.normal) ? `/uploads/design-assets/textures/procedural/${normalName}` : next.pbrTextures.normal
    };
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function main() {
  ensureDir(textureDir);
  const assets = readJson(dataFile, []);
  const enriched = assets.map(enrichAsset);
  writeJson(dataFile, enriched);
  console.log(JSON.stringify({
    total: enriched.length,
    styled: enriched.filter((asset) => asset.styleTags?.length).length,
    withTexture: enriched.filter((asset) => asset.textureUrl).length,
    withPbr: enriched.filter((asset) => asset.pbrTextures?.baseColor).length,
    textureDir
  }, null, 2));
}

main();
