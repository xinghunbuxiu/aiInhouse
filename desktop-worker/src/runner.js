const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

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

function extractJsonFromStdout(stdout) {
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

  const matches = normalized.match(/\{[\s\S]*\}/g) || [];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(matches[index]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function readResultFile(outputDir) {
  const resultFile = path.join(outputDir, 'codex-result.json');
  if (!fs.existsSync(resultFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } catch (error) {
    return null;
  }
}

async function runCodexWorker(paths) {
  const [command, ...args] = splitCommand(config.codexCommand);

  if (!command) {
    throw new Error('未配置 AIH_CODEX_COMMAND');
  }

  const resolvedArgs = args.map((arg) => {
    if (arg.startsWith('../') || arg.startsWith('./')) {
      return path.resolve(config.projectRoot, arg);
    }
    return arg;
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...resolvedArgs, '--job', paths.jobFile, '--output', paths.outputDir], {
      cwd: config.projectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let settled = false;
    let timedOut = false;

    let stdout = '';
    let stderr = '';

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
    }, Math.max(config.codexTimeoutMs, 10000));

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

      const summary = extractJsonFromStdout(stdout) || readResultFile(paths.outputDir);

      if (code !== 0 && !summary) {
        const error = new Error(
          timedOut
            ? `本地处理器执行超时，${Math.round(config.codexTimeoutMs / 1000)} 秒内未拿到结果`
            : (stderr || stdout || `本地处理器执行失败，退出码 ${code}`)
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({
        stdout,
        stderr,
        summary: summary || { raw: stdout.trim() },
        meta: {
          exitCode: code,
          timedOut
        }
      });
    });
  });
}

module.exports = {
  runCodexWorker
};
