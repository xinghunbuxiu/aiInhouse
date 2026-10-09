import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'backend', 'data', 'design-assets.json');
const modelDir = path.join(root, 'backend', 'uploads', 'design-assets', 'models', 'procedural');

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

function align4(buffer) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding)]) : buffer;
}

function makeCubeMesh({ name, size = [1, 1, 1], center = [0, 0, 0], color = [0.8, 0.8, 0.8, 1] }) {
  const [sx, sy, sz] = size;
  const [cx, cy, cz] = center;
  const x = sx / 2;
  const y = sy / 2;
  const z = sz / 2;
  const vertices = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]
  ].map(([vx, vy, vz]) => [vx + cx, vy + cy, vz + cz]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0
  ];
  return { name, vertices, indices, color };
}

function floatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function uint16Buffer(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function writeGlb(filePath, meshes) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  const gltfMeshes = [];
  const nodes = [];
  const materials = [];
  let byteOffset = 0;

  for (const mesh of meshes) {
    const vertexFlat = mesh.vertices.flat();
    const indexFlat = mesh.indices;
    const vertexBuffer = align4(floatBuffer(vertexFlat));
    const indexBuffer = align4(uint16Buffer(indexFlat));
    const vertexView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: vertexFlat.length * 4, target: 34962 });
    byteOffset += vertexBuffer.length;
    buffers.push(vertexBuffer);
    const indexView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: indexFlat.length * 2, target: 34963 });
    byteOffset += indexBuffer.length;
    buffers.push(indexBuffer);

    const positionAccessor = accessors.length;
    const xs = mesh.vertices.map((v) => v[0]);
    const ys = mesh.vertices.map((v) => v[1]);
    const zs = mesh.vertices.map((v) => v[2]);
    accessors.push({
      bufferView: vertexView,
      componentType: 5126,
      count: mesh.vertices.length,
      type: 'VEC3',
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)]
    });

    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: 5123,
      count: indexFlat.length,
      type: 'SCALAR',
      min: [Math.min(...indexFlat)],
      max: [Math.max(...indexFlat)]
    });

    const materialIndex = materials.length;
    materials.push({
      name: `${mesh.name}-mat`,
      pbrMetallicRoughness: {
        baseColorFactor: mesh.color,
        metallicFactor: 0,
        roughnessFactor: 0.65
      }
    });

    const meshIndex = gltfMeshes.length;
    gltfMeshes.push({
      name: mesh.name,
      primitives: [{
        attributes: { POSITION: positionAccessor },
        indices: indexAccessor,
        material: materialIndex
      }]
    });
    nodes.push({ mesh: meshIndex, name: mesh.name });
  }

  const bin = Buffer.concat(buffers);
  const json = {
    asset: { version: '2.0', generator: 'AIInHouse procedural asset generator' },
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    scene: 0,
    nodes,
    meshes: gltfMeshes,
    materials,
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors
  };
  const jsonChunk = align4(Buffer.from(JSON.stringify(json), 'utf8'));
  const binChunk = align4(bin);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(filePath, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
}

const assets = [
  {
    id: 'procedural-modern-sofa-glb',
    name: '自生成现代沙发 GLB',
    category: 'furniture',
    sceneTypes: ['living'],
    primitive: 'sofa',
    meshes: [
      makeCubeMesh({ name: 'seat', size: [2.2, 0.8, 0.32], center: [0, 0, 0.32], color: [0.16, 0.36, 0.30, 1] }),
      makeCubeMesh({ name: 'back', size: [2.2, 0.18, 0.75], center: [0, 0.42, 0.65], color: [0.10, 0.24, 0.22, 1] }),
      makeCubeMesh({ name: 'left-arm', size: [0.18, 0.8, 0.52], center: [-1.18, 0, 0.45], color: [0.12, 0.28, 0.25, 1] }),
      makeCubeMesh({ name: 'right-arm', size: [0.18, 0.8, 0.52], center: [1.18, 0, 0.45], color: [0.12, 0.28, 0.25, 1] })
    ]
  },
  {
    id: 'procedural-queen-bed-glb',
    name: '自生成双人床 GLB',
    category: 'furniture',
    sceneTypes: ['bedroom'],
    primitive: 'bed',
    meshes: [
      makeCubeMesh({ name: 'base', size: [1.8, 2.1, 0.28], center: [0, 0, 0.24], color: [0.55, 0.52, 0.58, 1] }),
      makeCubeMesh({ name: 'mattress', size: [1.72, 2.0, 0.22], center: [0, -0.02, 0.52], color: [0.86, 0.84, 0.80, 1] }),
      makeCubeMesh({ name: 'headboard', size: [1.9, 0.16, 0.88], center: [0, 1.12, 0.68], color: [0.42, 0.39, 0.46, 1] })
    ]
  },
  {
    id: 'procedural-dining-set-glb',
    name: '自生成餐桌椅 GLB',
    category: 'furniture',
    sceneTypes: ['dining', 'living'],
    primitive: 'dining-table',
    meshes: [
      makeCubeMesh({ name: 'table-top', size: [1.25, 1.25, 0.12], center: [0, 0, 0.76], color: [0.72, 0.46, 0.24, 1] }),
      makeCubeMesh({ name: 'table-leg', size: [0.18, 0.18, 0.72], center: [0, 0, 0.38], color: [0.42, 0.25, 0.12, 1] }),
      ...[[-0.92, 0], [0.92, 0], [0, -0.92], [0, 0.92]].flatMap(([x, y], index) => [
        makeCubeMesh({ name: `chair-seat-${index}`, size: [0.36, 0.36, 0.16], center: [x, y, 0.42], color: [0.76, 0.70, 0.62, 1] }),
        makeCubeMesh({ name: `chair-back-${index}`, size: [0.36, 0.08, 0.52], center: [x, y + 0.18, 0.70], color: [0.52, 0.48, 0.42, 1] })
      ])
    ]
  }
];

function upsertAssets(generatedAssets) {
  const existing = readJson(dataFile, []);
  const byId = new Map(existing.map((asset) => [asset.id, asset]));
  for (const asset of generatedAssets) {
    const previous = byId.get(asset.id) || {};
    byId.set(asset.id, {
      ...previous,
      id: asset.id,
      name: asset.name,
      category: asset.category,
      usage: previous.usage || '项目自生成 GLB 模型，用于 Blender 真实模型加载和早期商用验证。',
      sceneTypes: asset.sceneTypes,
      placement: previous.placement || 'place_as_model_asset',
      aiDescription: previous.aiDescription || `${asset.name}, generated by AIInHouse as project-owned GLB placeholder.`,
      tags: previous.tags || ['GLB', '自生成', '程序化模型'],
      properties: {
        ...(previous.properties || {}),
        blenderPrimitive: asset.primitive,
        priority: previous.properties?.priority || 92
      },
      assetUrl: '',
      modelUrl: `/uploads/design-assets/models/procedural/${asset.id}.glb`,
      textureUrl: previous.textureUrl || '',
      previewUrl: previous.previewUrl || '',
      sourceType: 'procedural_glb',
      sourceUrl: '',
      license: 'Project-owned procedural GLB generated by AIInHouse; no external model source.',
      createdAt: previous.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  writeJson(dataFile, [...byId.values()]);
}

function main() {
  ensureDir(modelDir);
  for (const asset of assets) {
    writeGlb(path.join(modelDir, `${asset.id}.glb`), asset.meshes);
  }
  upsertAssets(assets);
  console.log(JSON.stringify({
    generated: assets.length,
    files: assets.map((asset) => path.join(modelDir, `${asset.id}.glb`))
  }, null, 2));
}

main();
