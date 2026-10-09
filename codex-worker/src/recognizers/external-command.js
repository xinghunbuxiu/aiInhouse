const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { recognitionCommand, recognitionTimeoutMs, projectRoot } = require('../config');

function splitCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"(.*)"$/, '$1'));
}

function tryParseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractJson(stdout) {
  const normalized = String(stdout || '').trim();
  if (!normalized) {
    return null;
  }

  const direct = tryParseJson(normalized);
  if (direct) {
    return direct;
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(lines[index]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function getRecognitionDraftFile(outputDir) {
  return path.join(outputDir, 'recognition-draft.json');
}

function readRecognitionDraftFile(outputDir) {
  const draftFile = getRecognitionDraftFile(outputDir);
  if (!fs.existsSync(draftFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(draftFile, 'utf8'));
  } catch (error) {
    return null;
  }
}

async function runExternalRecognition(jobFile, outputDir) {
  if (!recognitionCommand) {
    return null;
  }

  const [command, ...args] = splitCommand(recognitionCommand);
  if (!command) {
    return null;
  }

  const normalizedArgs = args.map((arg) => {
    if (arg.startsWith('./') || arg.startsWith('../')) {
      return path.resolve(projectRoot, arg);
    }
    return arg;
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...normalizedArgs, '--job', jobFile, '--output', outputDir], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
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
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 3000);
    }, Math.max(recognitionTimeoutMs, 10000));

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const parsed = extractJson(stdout) || readRecognitionDraftFile(outputDir);
      if (code !== 0 && !parsed) {
        reject(new Error(
          timedOut
            ? `本地识别器执行超时，${Math.round(recognitionTimeoutMs / 1000)} 秒内未返回结果`
            : (stderr || stdout || `本地识别器执行失败，退出码 ${code}`)
        ));
        return;
      }

      if (!parsed) {
        resolve(null);
        return;
      }

      resolve(parsed);
    });
  });
}

module.exports = {
  runExternalRecognition,
  getRecognitionDraftFile
};
