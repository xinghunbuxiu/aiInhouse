import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function hasImageApiKey() {
  return Boolean(
    process.env.OPENAI_API_KEY
    || process.env.CODEX_RENDER_API_KEY
    || process.env.CODEX_PANORAMA_API_KEY
  );
}

function isBlenderOnlyMode() {
  const provider = String(process.env.CODEX_RENDER_PROVIDER || process.env.AIINHOUSE_RENDER_PROVIDER || '').toLowerCase();
  const only = String(process.env.AIINHOUSE_RENDER_ONLY_BLENDER || process.env.CODEX_RENDER_ONLY_BLENDER || '').toLowerCase();
  return provider === 'blender' || ['true', '1', 'yes', 'on'].includes(only);
}

function isAiDirectMode() {
  const providers = [
    process.env.CODEX_RENDER_PROVIDER,
    process.env.CODEX_PANORAMA_PROVIDER,
    process.env.AIINHOUSE_RENDER_PROVIDER
  ].map((value) => String(value || '').toLowerCase());
  return providers.some((provider) => ['ai_direct', 'openai_image', 'openai-image', 'image_api'].includes(provider));
}

function allowsAiDirectRasterFallback() {
  const configured = String(process.env.CODEX_AI_DIRECT_ALLOW_RASTER_FALLBACK || '').toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(configured);
}

function shouldTryBlender() {
  if (isAiDirectMode()) {
    return false;
  }
  const configured = process.env.AIINHOUSE_RENDER_TRY_BLENDER || process.env.CODEX_RENDER_TRY_BLENDER || '';
  const normalized = String(configured).toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  return checkHeadlessBlender().ok;
}

function checkHeadlessBlender() {
  const scriptPath = path.join(scriptDir, 'aiinhouse-blender-renderer.mjs');
  const result = spawnSync(process.execPath, [scriptPath, '--check-headless'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8'
  });

  return {
    ok: result.status === 0,
    error: result.status === 0 ? '' : (result.stderr || result.stdout || '').trim()
  };
}

function runRenderer(scriptName) {
  const scriptPath = path.join(scriptDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8'
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status
  };
}

function parseRendererResult(run) {
  const text = String(run.stdout || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch (_) {
        // Keep looking for the final JSON line.
      }
    }
  }

  return null;
}

function writeAutoResult(outputDir, payload) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'aiinhouse-auto-render-result.json'),
    JSON.stringify(payload, null, 2),
    'utf8'
  );
}

function main() {
  const outputDir = path.resolve(getArg('--output') || process.cwd());
  const attempts = [];
  const headlessBlender = checkHeadlessBlender();

  if (shouldTryBlender()) {
    const blenderRun = runRenderer('aiinhouse-blender-renderer.mjs');
    attempts.push({
      provider: 'aiinhouse-blender-renderer',
      ok: blenderRun.ok,
      status: blenderRun.status,
      error: blenderRun.ok ? '' : (blenderRun.stderr || blenderRun.stdout).trim()
    });

    if (blenderRun.ok) {
      const result = parseRendererResult(blenderRun) || {};
      result.summary = {
        ...(result.summary || {}),
        autoRenderer: {
          provider: 'aiinhouse-blender-renderer',
          attempts
        }
      };
      writeAutoResult(outputDir, result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (isBlenderOnlyMode()) {
      const payload = {
        output: {},
        summary: {
          provider: 'aiinhouse-auto-renderer',
          blenderOnly: true,
          attempts
        }
      };
      writeAutoResult(outputDir, payload);
      throw new Error(`Blender-only 渲染失败，已停止，不再打开或尝试其它渲染链路：${attempts[0]?.error || 'unknown error'}`);
    }
  } else if (isBlenderOnlyMode()) {
    const payload = {
      output: {},
      summary: {
        provider: 'aiinhouse-auto-renderer',
        blenderOnly: true,
        attempts: [{
          provider: 'aiinhouse-blender-renderer',
          ok: false,
          error: headlessBlender.error || '未找到 headless Blender CLI。'
        }]
      }
    };
    writeAutoResult(outputDir, payload);
    throw new Error(`Blender-only 渲染要求 headless Blender CLI 可用，但当前不可用，已停止且不会打开桌面客户端：${headlessBlender.error || '未找到 headless Blender CLI。'}`);
  }

  if (hasImageApiKey()) {
    const openaiRun = runRenderer('openai-image-renderer.mjs');
    attempts.push({
      provider: 'openai-image-api',
      ok: openaiRun.ok,
      status: openaiRun.status,
      error: openaiRun.ok ? '' : (openaiRun.stderr || openaiRun.stdout).trim()
    });

    if (openaiRun.ok) {
      const result = parseRendererResult(openaiRun) || {};
      result.summary = {
        ...(result.summary || {}),
        autoRenderer: {
          provider: 'openai-image-api',
          attempts
        }
      };
      writeAutoResult(outputDir, result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
  } else {
    attempts.push({
      provider: 'openai-image-api',
      ok: false,
      error: 'OPENAI_API_KEY / CODEX_RENDER_API_KEY / CODEX_PANORAMA_API_KEY 未配置，跳过 AI 图片生成。'
    });
  }

  if (isAiDirectMode() && !allowsAiDirectRasterFallback()) {
    const payload = {
      output: {},
      summary: {
        provider: 'aiinhouse-auto-renderer',
        aiDirectRequired: true,
        previewFallbackUsed: false,
        attempts
      }
    };
    writeAutoResult(outputDir, payload);
    throw new Error(`AI 直连渲染失败，已停止，不使用本地栅格图冒充 AI 结果：${attempts.at(-1)?.error || 'unknown error'}`);
  }

  const rasterRun = runRenderer('aiinhouse-rasterize-renderer.mjs');
  attempts.push({
    provider: 'aiinhouse-rasterize-renderer',
    ok: rasterRun.ok,
    status: rasterRun.status,
    error: rasterRun.ok ? '' : (rasterRun.stderr || rasterRun.stdout).trim()
  });

  if (!rasterRun.ok) {
    const payload = {
      output: {},
      summary: {
        provider: 'aiinhouse-auto-renderer',
        attempts
      }
    };
    writeAutoResult(outputDir, payload);
    throw new Error(attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).filter(Boolean).join('\n'));
  }

  const result = parseRendererResult(rasterRun) || {};
  result.summary = {
    ...(result.summary || {}),
    previewFallbackUsed: true,
    autoRenderer: {
      provider: 'aiinhouse-rasterize-renderer',
      attempts
    }
  };
  writeAutoResult(outputDir, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
