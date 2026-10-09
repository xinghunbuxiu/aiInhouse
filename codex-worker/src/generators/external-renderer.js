const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

function splitCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"(.*)"$/, '$1'));
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function normalizeOutput(value, outputDir) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, filePath]) => {
      if (!filePath || typeof filePath !== 'string') {
        return [key, filePath];
      }

      if (!path.isAbsolute(filePath)) {
        return [key, filePath];
      }

      const relativePath = path.relative(outputDir, filePath);
      if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return [key, relativePath.replace(/\\/g, '/')];
      }

      return [key, filePath];
    })
  );
}

function resolveCommandPart(part) {
  if (!part || typeof part !== 'string') {
    return part;
  }

  if (part.startsWith('../') || part.startsWith('./')) {
    return path.resolve(config.projectRoot, part);
  }

  return part;
}

function runExternalRenderer(commandLine, args, timeoutMs, outputDir, env = {}) {
  const [rawCommand, ...rawBaseArgs] = splitCommand(commandLine);
  const command = resolveCommandPart(rawCommand);
  const baseArgs = rawBaseArgs.map(resolveCommandPart);
  if (!command) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...baseArgs, ...args], {
      cwd: outputDir,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(timeoutMs, 10000));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(timedOut ? '外部渲染命令超时' : (stderr || stdout || `外部渲染命令失败: ${code}`)));
        return;
      }

      const inlineJson = stdout.trim() ? (() => {
        try {
          return JSON.parse(stdout.trim());
        } catch (error) {
          return null;
        }
      })() : null;

      resolve(
        inlineJson
        || readJson(path.join(outputDir, 'render-result.json'))
        || readJson(path.join(outputDir, 'aiinhouse-auto-render-result.json'))
        || readJson(path.join(outputDir, 'openai-image-render-result.json'))
        || readJson(path.join(outputDir, 'rasterize-render-result.json'))
        || {}
      );
    });
  });
}

module.exports = {
  normalizeOutput,
  runExternalRenderer
};
