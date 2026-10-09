const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  recognitionPreprocessCommand,
  recognitionPreprocessTimeoutMs,
  projectRoot
} = require('../config');

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

function getPreprocessFile(outputDir) {
  return path.join(outputDir, 'recognition-preprocess.json');
}

async function runRecognitionPreprocess(jobFile, outputDir) {
  const existingPreprocessFile = getPreprocessFile(outputDir);
  if (fs.existsSync(existingPreprocessFile)) {
    const existing = tryParseJson(fs.readFileSync(existingPreprocessFile, 'utf8'));
    if (existing) {
      return existing;
    }
  }

  if (!recognitionPreprocessCommand) {
    return null;
  }

  const [command, ...args] = splitCommand(recognitionPreprocessCommand);
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
    }, Math.max(recognitionPreprocessTimeoutMs, 10000));

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

      const preprocessFile = getPreprocessFile(outputDir);
      const parsed = tryParseJson(stdout) || (fs.existsSync(preprocessFile) ? tryParseJson(fs.readFileSync(preprocessFile, 'utf8')) : null);
      if (code !== 0 && !parsed) {
        reject(new Error(
          timedOut
            ? `预处理执行超时，${Math.round(recognitionPreprocessTimeoutMs / 1000)} 秒内未返回结果`
            : (stderr || stdout || `预处理执行失败，退出码 ${code}`)
        ));
        return;
      }

      resolve(parsed || null);
    });
  });
}

module.exports = {
  runRecognitionPreprocess,
  getPreprocessFile
};
