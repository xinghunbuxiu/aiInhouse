const path = require('path');
const { spawn } = require('child_process');
const { realCommand, projectRoot } = require('../config');

function splitCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"(.*)"$/, '$1'));
}

function normalizeSummary(result) {
  const output = result?.output || {};
  return {
    roomCount: Number(result?.summary?.roomCount || 0),
    hasFormalPlan: Boolean(output.formalPlanSvg || output.formalPlanJson),
    hasCad: Boolean(output.cadFile),
    hasThreeD: Boolean(output.threeDConfig),
    hasPanorama: Boolean(output.panoramaConfig),
    ...(result?.summary || {})
  };
}

async function executeExternalCommand(jobFile, outputDir) {
  if (!realCommand) {
    throw new Error('CODEX_REAL_COMMAND 未配置，无法使用 external_command 模式');
  }

  const [command, ...args] = splitCommand(realCommand);
  if (!command) {
    throw new Error('CODEX_REAL_COMMAND 不能为空');
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

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `真实 Codex 命令执行失败，退出码 ${code}`));
        return;
      }

      const normalizedStdout = stdout.trim();
      if (!normalizedStdout) {
        reject(new Error('真实 Codex 命令没有返回 JSON 结果'));
        return;
      }

      try {
        const parsed = JSON.parse(normalizedStdout);
        resolve({
          ...parsed,
          summary: normalizeSummary(parsed)
        });
      } catch (error) {
        reject(new Error('真实 Codex 命令输出不是合法 JSON'));
      }
    });
  });
}

module.exports = {
  executeExternalCommand
};
