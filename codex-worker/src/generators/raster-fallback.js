const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../config');
const { normalizeOutput } = require('./external-renderer');

function runRasterFallback(outputDir, { scene = false, panorama = false } = {}) {
  const script = path.resolve(config.projectRoot, '..', 'scripts', 'aiinhouse-rasterize-renderer.mjs');
  const args = [];
  if (scene) {
    args.push('--scene');
  }
  if (panorama) {
    args.push('--panorama');
  }
  args.push('--output', outputDir);

  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: outputDir,
    env: process.env,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'SVG 转 PNG 兜底渲染失败');
  }

  const inlineJson = (() => {
    const text = String(result.stdout || '').trim();
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
          // Keep scanning for trailing JSON payload.
        }
      }
      return null;
    }
  })();

  const payload = inlineJson
    || readJson(path.join(outputDir, 'rasterize-render-result.json'), {});

  return {
    output: normalizeOutput(payload.output || {}, outputDir),
    summary: {
      ...(payload.summary || {}),
      provider: 'aiinhouse-rasterize-renderer',
      fallback: true
    }
  };
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  runRasterFallback
};
