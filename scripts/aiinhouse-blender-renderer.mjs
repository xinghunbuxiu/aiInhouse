import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blenderScript = path.join(root, 'scripts', 'blender', 'aiinhouse_render.py');

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function commandExists(command) {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    encoding: 'utf8'
  });
  return result.status === 0 && result.stdout.trim();
}

function resolveExecutable(command) {
  if (!command) {
    return '';
  }

  if (command.includes('/') || command.startsWith('.')) {
    return path.resolve(command);
  }

  return commandExists(command);
}

function assertHeadlessBlenderBin(candidate, source = 'blender') {
  const resolved = resolveExecutable(candidate);
  if (!resolved) {
    return '';
  }

  const normalized = path.resolve(resolved);
  const basename = path.basename(normalized).toLowerCase();
  if (basename === 'open') {
    throw new Error(`${source} 不能配置为 open；自动化渲染必须使用真正的 headless Blender CLI 可执行文件。`);
  }

  const isMacOsAppBinary = /\.app\/Contents\/MacOS\/Blender$/i.test(normalized);
  if (normalized.endsWith('.app') || (normalized.includes('.app/') && !isMacOsAppBinary)) {
    throw new Error(`${source} 指向 macOS .app 目录而不是真实 Blender 二进制：${normalized}。请把 BLENDER_BIN 设置为 Contents/MacOS/Blender。`);
  }

  if (!fs.existsSync(normalized)) {
    throw new Error(`${source} 不存在：${normalized}。请把 BLENDER_BIN 设置为真实可执行文件。`);
  }

  let stat;
  try {
    stat = fs.statSync(normalized);
  } catch (error) {
    throw new Error(`无法读取 ${source}：${normalized}。${error.message}`);
  }

  if (!stat.isFile()) {
    throw new Error(`${source} 不是可执行文件：${normalized}。请不要配置 .app、目录或包装器。`);
  }

  const descriptor = fs.openSync(normalized, 'r');
  const buffer = Buffer.alloc(4096);
  const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
  fs.closeSync(descriptor);
  const sample = buffer.subarray(0, bytesRead).toString('utf8');
  if (sample.startsWith('#!')) {
    const appHint = sample.includes('.app') ? '，且脚本内容会调用 macOS .app 桌面客户端' : '';
    throw new Error(`${source} 是脚本包装器：${normalized}${appHint}。自动化渲染已拒绝启动；请安装服务器/headless Blender CLI，或把 BLENDER_BIN 设置为真实二进制可执行文件。`);
  }

  return normalized;
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
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

function normalizeRoom(room = {}, index = 0) {
  const bounds = room.bounds || room;
  return {
    id: room.id || `room-${index + 1}`,
    name: room.name || room.text || `空间 ${index + 1}`,
    type: room.type || room.roomType || 'space',
    bounds: {
      x: Number(bounds.x || room.x || 0),
      y: Number(bounds.y || room.y || 0),
      width: Number(bounds.width || room.width || 280),
      height: Number(bounds.height || room.height || 220)
    }
  };
}

function attachAssemblyPlan(plan, assemblyPath, outputDir) {
  const assemblyPlan = readJson(assemblyPath || path.join(outputDir, 'scene-assembly-plan.json'), {});
  if (!assemblyPlan.roomPlans?.length && !assemblyPlan.rendererAssets?.length) {
    return plan;
  }

  const roomPlanById = new Map((assemblyPlan.roomPlans || []).map((roomPlan) => [roomPlan.roomId, roomPlan]));
  return {
    ...plan,
    assemblyPlan,
    rendererAssets: assemblyPlan.rendererAssets || [],
    rooms: (plan.rooms || []).map((room) => ({
      ...room,
      assembly: roomPlanById.get(room.id) || null
    }))
  };
}

function attachFormalPlanGeometry(plan, outputDir, sourceDir = '', preferFormalRooms = false) {
  const formalPlan = readJson(path.join(outputDir, 'formal-plan.json'), null)
    || readJson(sourceDir ? path.join(sourceDir, 'formal-plan.json') : '', {});
  if (!formalPlan.rooms?.length && !formalPlan.openings?.length && !formalPlan.walls?.length) {
    return plan;
  }

  return {
    ...plan,
    walls: plan.walls?.length ? plan.walls : formalPlan.walls || [],
    openings: plan.openings?.length ? plan.openings : formalPlan.openings || [],
    rooms: (
      preferFormalRooms && formalPlan.rooms?.length
        ? formalPlan.rooms
        : (plan.rooms?.length ? plan.rooms : formalPlan.rooms || [])
    ).map(normalizeRoom),
    formalPlanMeta: formalPlan.meta || {}
  };
}

function buildPlan({ scenePath, panoramaPath, assemblyPath, outputDir }) {
  if (scenePath) {
    const scene = readJson(scenePath, {});
    return attachAssemblyPlan(attachFormalPlanGeometry({
      ...scene,
      rooms: (scene.rooms || []).map(normalizeRoom)
    }, outputDir, path.dirname(path.resolve(scenePath))), assemblyPath, outputDir);
  }

  const formalPlan = readJson(path.join(outputDir, 'formal-plan.json'), {});
  if (formalPlan.rooms?.length) {
    return attachAssemblyPlan({
      ...formalPlan,
      rooms: formalPlan.rooms.map(normalizeRoom)
    }, assemblyPath, outputDir);
  }

  const panorama = readJson(panoramaPath, {});
  const rooms = (panorama.cameraPositions || []).map((camera, index) => normalizeRoom({
    id: camera.roomId || camera.id,
    name: camera.name || `空间 ${index + 1}`,
    type: camera.roomType || 'space',
    x: index * 300,
    y: Math.floor(index / 3) * 240,
    width: 280,
    height: 220
  }, index));

  return attachAssemblyPlan(attachFormalPlanGeometry({
    rooms
  }, outputDir, panoramaPath ? path.dirname(path.resolve(panoramaPath)) : '', true), assemblyPath, outputDir);
}

function getBlenderBin() {
  const configured = process.env.BLENDER_BIN || process.env.AIINHOUSE_BLENDER_BIN || '';
  if (configured) {
    return assertHeadlessBlenderBin(configured, 'BLENDER_BIN');
  }

  const discovered = commandExists('blender');
  if (!discovered) {
    return '';
  }

  return assertHeadlessBlenderBin(discovered, 'PATH 中的 blender');
}

function runBlender({ mode, planFile, outputDir }) {
  const blenderBin = getBlenderBin();
  if (!blenderBin) {
    throw new Error('未找到 headless Blender CLI。请安装服务器/headless Blender 二进制，或设置 BLENDER_BIN；不要使用 .app、open 或包装器。');
  }

  const result = spawnSync(blenderBin, [
    '--background',
    '--python', blenderScript,
    '--',
    '--mode', mode,
    '--plan', planFile,
    '--output', outputDir
  ], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: Number(process.env.AIINHOUSE_BLENDER_TIMEOUT_MS || 10 * 60 * 1000)
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Blender 渲染失败: ${result.status}`);
  }

  return readJson(path.join(outputDir, 'blender-render-result.json'), {});
}

function main() {
  if (process.argv.includes('--check-headless')) {
    const blenderBin = getBlenderBin();
    if (!blenderBin) {
      throw new Error('未找到 headless Blender CLI。请安装服务器/headless Blender 二进制，或设置 BLENDER_BIN；不要使用 .app、open 或包装器。');
    }
    process.stdout.write(`${JSON.stringify({ ok: true, blenderBin })}\n`);
    return;
  }

  const outputDir = path.resolve(getArg('--output') || process.cwd());
  const scenePath = getArg('--scene');
  const panoramaPath = getArg('--panorama');
  const assemblyPath = getArg('--assembly-plan');
  const mode = scenePath ? 'effect' : 'panorama';
  const plan = buildPlan({ scenePath, panoramaPath, assemblyPath, outputDir });
  const planFile = path.join(outputDir, `blender-${mode}-plan.json`);

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(planFile, plan);

  const result = runBlender({ mode, planFile, outputDir });
  const payload = {
    output: result.output || {},
    summary: {
      provider: 'aiinhouse-blender-renderer',
      ...(result.summary || {}),
      mode,
      planFile: path.basename(planFile)
    }
  };

  writeJson(path.join(outputDir, mode === 'effect' ? 'blender-effect-result.json' : 'blender-panorama-result.json'), payload);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
