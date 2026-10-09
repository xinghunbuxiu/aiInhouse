import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'backend', 'data', 'design-assets.json');
const uploadRoot = path.join(root, 'backend', 'uploads', 'design-assets');

const defaultAssets = [
  { id: 'Sofa_01', type: 'models', category: 'furniture', sceneTypes: ['living'], primitive: 'sofa', role: 'primary_seating' },
  { id: 'WoodenTable_01', type: 'models', category: 'furniture', sceneTypes: ['dining', 'living'], primitive: 'dining-table', role: 'dining_table' },
  { id: 'WoodenChair_01', type: 'models', category: 'furniture', sceneTypes: ['dining', 'living'], primitive: 'dining-chair', role: 'dining_chair' },
  { id: 'ClassicNightstand_01', type: 'models', category: 'furniture', sceneTypes: ['bedroom'], primitive: 'coffee-table', role: 'nightstand' },
  { id: 'ClassicConsole_01', type: 'models', category: 'furniture', sceneTypes: ['living', 'entry'], primitive: 'tv-console', role: 'console' },
  { id: 'GreenChair_01', type: 'models', category: 'furniture', sceneTypes: ['living', 'bedroom'], primitive: 'dining-chair', role: 'accent_chair' },
  { id: 'Ottoman_01', type: 'models', category: 'soft_decor', sceneTypes: ['living', 'bedroom'], primitive: 'coffee-table', role: 'ottoman' },
  { id: 'wood_table_001', type: 'textures', category: 'floor_finish', sceneTypes: ['living', 'bedroom', 'dining', 'space'], primitive: 'material-floor' }
];

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function sanitize(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pickResolution(files, preferred, type = 'textures') {
  if (files[preferred]) {
    return preferred;
  }
  const order = type === 'models'
    ? ['raw', '1k', '2k', '4k', '8k']
    : ['1k', '2k', '4k', '8k'];
  return order.find((key) => files[key]) || Object.keys(files)[0];
}

function pickFormat(files, type) {
  const preferred = type === 'models'
    ? ['gltf', 'blend', 'fbx']
    : ['gltf', 'Diffuse', 'diffuse', 'jpg'];
  return preferred.find((key) => files[key]) || Object.keys(files)[0];
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}`);
  }
  return response.json();
}

async function downloadFile(url, targetPath, { dryRun = false } = {}) {
  if (dryRun) {
    return;
  }
  ensureDir(path.dirname(targetPath));
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, buffer);
}

function collectDownloadEntries(fileMeta) {
  const entries = [{ name: path.basename(new URL(fileMeta.url).pathname), url: fileMeta.url }];
  for (const [includeName, includeMeta] of Object.entries(fileMeta.include || {})) {
    entries.push({ name: includeName, url: includeMeta.url });
  }
  return entries;
}

function primaryAssetUrl(assetDir, entries, type) {
  const preferred = type === 'models'
    ? entries.find((entry) => /\.(gltf|glb|fbx|blend)$/i.test(entry.name))
    : entries.find((entry) => /diff|basecolor|color/i.test(entry.name) && /\.(jpg|jpeg|png|webp)$/i.test(entry.name))
      || entries.find((entry) => /\.(jpg|jpeg|png|webp)$/i.test(entry.name));
  if (!preferred) {
    return '';
  }
  return `/uploads/design-assets/polyhaven/${assetDir}/${preferred.name}`;
}

function upsertAsset(asset, primaryUrl) {
  const assets = readJson(dataFile, []);
  const byId = new Map(assets.map((item) => [item.id, item]));
  const id = `polyhaven-${asset.id.toLowerCase().replace(/_/g, '-')}`;
  const previous = byId.get(id) || {};
  byId.set(id, {
    ...previous,
    id,
    name: previous.name || `Poly Haven ${asset.id}`,
    category: previous.category || asset.category,
    usage: previous.usage || 'Poly Haven CC0 素材，供 Blender 渲染器优先加载。',
    sceneTypes: previous.sceneTypes?.length ? previous.sceneTypes : asset.sceneTypes,
    placement: previous.placement || (asset.type === 'models' ? 'place_as_model_asset' : 'apply_as_texture_material'),
    aiDescription: previous.aiDescription || `CC0 ${asset.type === 'models' ? '3D model' : 'PBR texture'} from Poly Haven.`,
    tags: previous.tags?.length ? previous.tags : ['Poly Haven', 'CC0', asset.type === 'models' ? '模型' : 'PBR材质'],
    properties: {
      ...(previous.properties || {}),
      blenderPrimitive: previous.properties?.blenderPrimitive || asset.primitive,
      role: previous.properties?.role || asset.role || '',
      priority: previous.properties?.priority || 96
    },
    assetUrl: '',
    modelUrl: asset.type === 'models' ? primaryUrl : (previous.modelUrl || ''),
    textureUrl: asset.type === 'textures' ? primaryUrl : (previous.textureUrl || ''),
    previewUrl: previous.previewUrl || '',
    sourceType: 'polyhaven_cc0',
    sourceUrl: `https://polyhaven.com/a/${asset.id}`,
    license: 'CC0 via Poly Haven. Source URL recorded; verify downloaded files before commercial approval.',
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  writeJson(dataFile, [...byId.values()]);
}

async function downloadAsset(asset, options) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${asset.id}`);
  const format = pickFormat(files, asset.type);
  const resolution = pickResolution(files[format] || {}, options.resolution, asset.type);
  const rawFileMeta = files[format]?.[resolution];
  const fileMeta = rawFileMeta?.url ? rawFileMeta : (rawFileMeta?.[format] || rawFileMeta?.[Object.keys(rawFileMeta || {})[0]]);
  if (!fileMeta?.url) {
    throw new Error(`未找到 ${asset.id} ${format}/${resolution} 下载项`);
  }

  const assetDir = sanitize(asset.id);
  const targetDir = path.join(uploadRoot, 'polyhaven', assetDir);
  const entries = collectDownloadEntries(fileMeta);
  for (const entry of entries) {
    await downloadFile(entry.url, path.join(targetDir, entry.name), options);
  }
  const primaryUrl = primaryAssetUrl(assetDir, entries, asset.type);
  if (!options.dryRun) {
    upsertAsset(asset, primaryUrl);
  }

  return {
    id: asset.id,
    format,
    resolution,
    files: entries.length,
    primaryUrl
  };
}

async function main() {
  const ids = getArg('--ids', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const dryRun = hasFlag('--dry-run');
  const resolution = getArg('--resolution', '1k');
  const selected = ids.length
    ? defaultAssets.filter((asset) => ids.includes(asset.id))
    : defaultAssets;

  const downloaded = [];
  for (const asset of selected) {
    downloaded.push(await downloadAsset(asset, { dryRun, resolution }));
  }

  console.log(JSON.stringify({
    dryRun,
    resolution,
    downloaded
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
