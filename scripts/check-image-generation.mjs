import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'tmp', 'imagegen-check');

fs.mkdirSync(outputDir, { recursive: true });

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index === -1) {
      continue;
    }
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const workerEnv = loadEnvFile(path.join(root, 'codex-worker', '.env'));

const scene = {
  style: 'modern',
  rooms: [
    { id: 'living', name: '客厅', type: 'living', bounds: { x: 0, y: 0, width: 420, height: 300 } },
    { id: 'bedroom', name: '卧室', type: 'bedroom', bounds: { x: 420, y: 0, width: 320, height: 280 } }
  ],
  materials: {
    floor: { texture: 'warm wood' },
    wall: { texture: 'warm matte paint' },
    ceiling: { texture: 'matte white' }
  }
};
const panorama = {
  description: '测试 VR 全景图',
  cameraPositions: [{ id: 'cam-1', name: '客厅机位' }],
  hotspots: [{ id: 'hotspot-1', text: '前往卧室' }]
};

fs.writeFileSync(path.join(outputDir, '3d-config.json'), JSON.stringify(scene, null, 2), 'utf8');
fs.writeFileSync(path.join(outputDir, 'scene-assembly-plan.json'), JSON.stringify({ roomPlans: scene.rooms }, null, 2), 'utf8');
fs.writeFileSync(path.join(outputDir, 'panorama-config.json'), JSON.stringify(panorama, null, 2), 'utf8');
fs.writeFileSync(path.join(outputDir, 'effect-render.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#f1ece5"/><text x="800" y="500" text-anchor="middle" font-size="72" fill="#0f172a">AIInHouse Effect</text></svg>', 'utf8');
fs.writeFileSync(path.join(outputDir, 'panorama-equirectangular.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><rect width="2048" height="1024" fill="#dbeafe"/><text x="1024" y="512" text-anchor="middle" font-size="80" fill="#0f172a">AIInHouse Panorama</text></svg>', 'utf8');

function run(args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'aiinhouse-auto-renderer.mjs'), ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...workerEnv,
      OPENAI_IMAGE_MODE: workerEnv.OPENAI_IMAGE_MODE || process.env.OPENAI_IMAGE_MODE || 'images',
      OPENAI_IMAGE_BASE_URL: workerEnv.OPENAI_IMAGE_BASE_URL || process.env.OPENAI_IMAGE_BASE_URL || 'https://api.openai.com/v1',
      CODEX_IMAGE_MODEL: workerEnv.CODEX_IMAGE_MODEL || process.env.CODEX_IMAGE_MODEL || 'gpt-image-2',
      CODEX_REQUIRE_OFFICIAL_OPENAI: workerEnv.CODEX_REQUIRE_OFFICIAL_OPENAI || process.env.CODEX_REQUIRE_OFFICIAL_OPENAI || 'true',
      CODEX_IMAGE_USE_REFERENCE: workerEnv.CODEX_IMAGE_USE_REFERENCE || process.env.CODEX_IMAGE_USE_REFERENCE || 'true'
    },
    encoding: 'utf8',
    timeout: 180000
  });
}

const effect = run([
  '--output', outputDir,
  '--scene', path.join(outputDir, '3d-config.json'),
  '--assembly-plan', path.join(outputDir, 'scene-assembly-plan.json')
]);
const pano = run([
  '--output', outputDir,
  '--panorama', path.join(outputDir, 'panorama-config.json')
]);

const result = {
  outputDir,
  effect: {
    status: effect.status,
    stdout: effect.stdout.trim(),
    stderr: effect.stderr.trim(),
    generated: fs.readdirSync(outputDir).filter((file) => /^effect-.*\.(png|jpg|jpeg|webp)$/i.test(file))
  },
  panorama: {
    status: pano.status,
    stdout: pano.stdout.trim(),
    stderr: pano.stderr.trim(),
    generated: fs.readdirSync(outputDir).filter((file) => /^panorama-.*\.(png|jpg|jpeg|webp)$/i.test(file))
  }
};

console.log(JSON.stringify(result, null, 2));
process.exit(effect.status || pano.status || 0);
