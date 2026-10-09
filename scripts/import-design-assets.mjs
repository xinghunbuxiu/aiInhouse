import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'backend', 'data', 'design-assets.json');
const uploadRoot = path.join(root, 'backend', 'uploads', 'design-assets');

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...walk(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

function copyIfNeeded(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (path.resolve(source) !== path.resolve(target)) {
    fs.copyFileSync(source, target);
  }
}

function inferCategory(filePath, explicitCategory) {
  if (explicitCategory) {
    return explicitCategory;
  }
  const text = filePath.toLowerCase();
  if (/sofa|chair|table|bed|wardrobe|cabinet|toilet|plant|lamp/.test(text)) {
    return /cabinet|wardrobe/.test(text) ? 'cabinet' : 'furniture';
  }
  if (/wood|tile|stone|floor|wall|fabric|material|texture/.test(text)) {
    return /wall/.test(text) ? 'wall_finish' : 'floor_finish';
  }
  return 'furniture';
}

function inferSceneTypes(filePath, explicitSceneTypes) {
  if (explicitSceneTypes.length) {
    return explicitSceneTypes;
  }
  const text = filePath.toLowerCase();
  if (/bath|toilet|shower|vanity/.test(text)) {
    return ['bathroom'];
  }
  if (/kitchen/.test(text)) {
    return ['kitchen'];
  }
  if (/bed|wardrobe/.test(text)) {
    return ['bedroom'];
  }
  if (/dining/.test(text)) {
    return ['dining', 'living'];
  }
  return ['living', 'bedroom', 'dining', 'space'];
}

function inferPrimitive(filePath, category) {
  const text = filePath.toLowerCase();
  if (/sofa/.test(text)) return 'sofa';
  if (/coffee/.test(text)) return 'coffee-table';
  if (/dining.*table|table/.test(text)) return 'dining-table';
  if (/chair/.test(text)) return 'dining-chair';
  if (/bed/.test(text)) return 'bed';
  if (/wardrobe/.test(text)) return 'wardrobe';
  if (/kitchen|cabinet/.test(text)) return 'kitchen-cabinet';
  if (/vanity/.test(text)) return 'bathroom-vanity';
  if (/toilet/.test(text)) return 'toilet';
  if (/plant/.test(text)) return 'plant-set';
  if (category === 'floor_finish') return 'material-floor';
  if (category === 'wall_finish') return 'material-wall';
  return 'generic-model';
}

function main() {
  const sourceDir = path.resolve(getArg('--source', ''));
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    throw new Error('请提供素材目录: node scripts/import-design-assets.mjs --source /path/to/assets');
  }

  const category = getArg('--category', '');
  const sceneTypes = getArg('--scene-types', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const license = getArg('--license', 'CC0 or project-owned; verify source before commercial delivery.');
  const sourceUrl = getArg('--source-url', '');
  const dryRun = hasFlag('--dry-run');

  const modelExtensions = new Set(['.glb', '.gltf', '.obj', '.fbx', '.blend']);
  const textureExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.hdr', '.exr']);
  const files = walk(sourceDir);
  const assets = readJson(dataFile, []);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const imported = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!modelExtensions.has(ext) && !textureExtensions.has(ext)) {
      continue;
    }

    const id = slug(path.basename(file));
    const targetSubdir = modelExtensions.has(ext) ? 'models' : 'textures';
    const targetPath = path.join(uploadRoot, targetSubdir, `${id}${ext}`);
    const url = `/uploads/design-assets/${targetSubdir}/${id}${ext}`;
    const inferredCategory = inferCategory(file, category);
    const previous = byId.get(id) || {};
    const next = {
      ...previous,
      id,
      name: previous.name || path.basename(file, ext).replace(/[-_]+/g, ' '),
      category: previous.category || inferredCategory,
      usage: previous.usage || '导入的真实素材，供 Blender 渲染器优先加载。',
      sceneTypes: previous.sceneTypes?.length ? previous.sceneTypes : inferSceneTypes(file, sceneTypes),
      placement: previous.placement || (modelExtensions.has(ext) ? 'place_as_model_asset' : 'apply_as_texture_material'),
      aiDescription: previous.aiDescription || `Imported ${modelExtensions.has(ext) ? '3D model' : 'texture'} asset for AIInHouse rendering.`,
      tags: previous.tags?.length ? previous.tags : ['导入素材', modelExtensions.has(ext) ? '模型' : '贴图'],
      properties: {
        ...(previous.properties || {}),
        blenderPrimitive: previous.properties?.blenderPrimitive || inferPrimitive(file, inferredCategory)
      },
      modelUrl: modelExtensions.has(ext) ? url : (previous.modelUrl || ''),
      textureUrl: textureExtensions.has(ext) ? url : (previous.textureUrl || ''),
      previewUrl: previous.previewUrl || '',
      sourceType: 'imported',
      sourceUrl: previous.sourceUrl || sourceUrl,
      license: previous.license || license,
      updatedAt: new Date().toISOString(),
      createdAt: previous.createdAt || new Date().toISOString()
    };

    byId.set(id, next);
    imported.push({ id, file, url, category: next.category });
    if (!dryRun) {
      copyIfNeeded(file, targetPath);
    }
  }

  if (!dryRun) {
    writeJson(dataFile, [...byId.values()]);
  }

  console.log(JSON.stringify({
    sourceDir,
    dryRun,
    imported: imported.length,
    assets: imported
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
