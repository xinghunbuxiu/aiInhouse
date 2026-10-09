const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const jobFile = path.join(projectRoot, 'desktop-worker', 'workspace', 'jobs', 'JOB-20260619181542-M3V91B', 'job.json');
const preprocessFile = path.join(projectRoot, 'desktop-worker', 'workspace', 'jobs', 'JOB-20260619181542-M3V91B', 'output', 'recognition-preprocess.json');
const rasterizerCommand = `node ${path.join(projectRoot, 'scripts', 'aiinhouse-rasterize-renderer.mjs')}`;
const outputDir = path.join(os.tmpdir(), 'aiinhouse-commercial-delivery-check');
const strictCommercial = process.argv.includes('--strict-commercial');
const withRasterizer = process.argv.includes('--with-rasterizer');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runWorker() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(preprocessFile)) {
    fs.copyFileSync(preprocessFile, path.join(outputDir, 'recognition-preprocess.json'));
  }

  const result = spawnSync('node', ['codex-worker/src/index.js', '--job', jobFile, '--output', outputDir], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_RECOGNITION_MODE: 'local_only',
      ...(withRasterizer ? {
        CODEX_RENDER_COMMAND: rasterizerCommand,
        CODEX_PANORAMA_COMMAND: rasterizerCommand
      } : {})
    }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'worker failed');
  }
}

function main() {
  assert(fs.existsSync(jobFile), `missing fixture job: ${jobFile}`);
  runWorker();

  const formalPlan = readJson(path.join(outputDir, 'formal-plan.json'));
  const threeDConfig = readJson(path.join(outputDir, '3d-config.json'));
  const panoramaConfig = readJson(path.join(outputDir, 'panorama-config.json'));
  const deliveryManifest = readJson(path.join(outputDir, 'delivery-manifest.json'));
  const deliveryApproval = readJson(path.join(outputDir, 'delivery-approval.json'));
  const review = fs.readFileSync(path.join(outputDir, 'review.md'), 'utf8');
  const roomNames = formalPlan.rooms.map((room) => room.name);
  const requiredRooms = ['主卧', '主卫', '男孩卧', '客厅', '餐厅', '门厅', '厨房', '阳台'];
  const rasterExtPattern = /\.(png|jpe?g|webp)$/i;
  const effectImages = threeDConfig.deliverables?.effectImages || [];
  const panoramaImages = panoramaConfig.deliverables?.panoramaImages || [];
  const gates = Object.fromEntries((deliveryManifest.gates || []).map((gate) => [gate.id, gate.passed]));

  assert(formalPlan.rooms.length >= 8, `expected at least 8 rooms, got ${formalPlan.rooms.length}`);
  for (const roomName of requiredRooms) {
    assert(roomNames.includes(roomName), `missing required room: ${roomName}`);
  }
  assert(threeDConfig.renderer?.commercialRenderSpec, 'missing commercialRenderSpec');
  assert((threeDConfig.renderer?.acceptanceCriteria || []).length >= 5, 'missing 3D acceptance criteria');
  assert(threeDConfig.rooms.length === formalPlan.rooms.length, '3D room count must match formal plan');
  assert(threeDConfig.rooms.every((room) => room.renderCamera), 'every 3D room needs a render camera');
  assert(panoramaConfig.viewer?.commercialVrSpec, 'missing commercialVrSpec');
  assert(panoramaConfig.cameraPositions.length === formalPlan.rooms.length, 'VR cameras must cover every room');
  assert(panoramaConfig.hotspots.length === formalPlan.rooms.length, 'VR hotspots must cover every room');
  assert(review.includes('交付等级: 可预览交付'), 'review must include delivery grade');
  assert(review.includes('商用交付建议'), 'review must include commercial delivery guidance');
  assert(deliveryManifest.deliveryStatus === 'preview_ready', 'preview run should write delivery manifest');
  assert(deliveryManifest.summary.roomCount >= 8, 'delivery manifest must include room count');
  assert(deliveryManifest.gates.some((gate) => gate.id === 'human-approval' && gate.passed === false), 'manifest must require human approval');
  assert(deliveryManifest.gates.some((gate) => gate.id === 'license-approval' && gate.passed === false), 'manifest must require license approval');
  assert(deliveryApproval.humanApproved === false, 'approval template must default humanApproved=false');
  assert(deliveryApproval.licenseApproved === false, 'approval template must default licenseApproved=false');
  assert(deliveryManifest.files?.approval?.exists, 'manifest must include approval file');
  if (withRasterizer) {
    assert(gates['effect-raster'], 'rasterizer mode should output a raster effect image');
    assert(gates['effect-resolution'], 'rasterizer mode should pass effect resolution');
    assert(gates['panorama-raster'], 'rasterizer mode should output a raster panorama image');
    assert(gates['panorama-resolution'], 'rasterizer mode should pass panorama resolution');
  } else {
    assert(gates['effect-resolution'] === false, 'preview fixture should not pass effect resolution without real render');
    assert(gates['panorama-resolution'] === false, 'preview fixture should not pass panorama resolution without real render');
  }

  if (strictCommercial) {
    assert(deliveryManifest.commercialReady, 'strict commercial delivery requires manifest commercialReady=true');
    assert(effectImages.some((image) => rasterExtPattern.test(String(image))), 'strict commercial delivery requires a raster effect image');
    assert(panoramaImages.some((image) => rasterExtPattern.test(String(image))), 'strict commercial delivery requires a raster panorama image');
    assert(panoramaConfig.viewer?.commercialVrSpec?.aspectRatio === '2:1', 'strict commercial VR must declare 2:1 aspect ratio');
    assert(gates['effect-resolution'], 'strict commercial delivery requires effect image >= 1600x1000');
    assert(gates['panorama-resolution'], 'strict commercial delivery requires panorama image >= 2048x1024 and 2:1');
  }

  console.log(`${strictCommercial ? 'strict commercial' : (withRasterizer ? 'raster preview commercial' : 'preview commercial')} delivery verification passed: ${outputDir}`);
}

main();
