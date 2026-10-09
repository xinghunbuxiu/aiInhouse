const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { buildCodexPrompt } = require('../prompt-builder');
const { realCommand, realArgsTemplate, resultFileName, projectRoot, cliTimeoutMs } = require('../config');
const { getResultSchema } = require('../result-schema');

function splitCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"(.*)"$/, '$1'));
}

function replacePlaceholders(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || '');
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

function readResultFromDisk(outputDir) {
  const targetFile = path.join(outputDir, resultFileName);
  if (!fs.existsSync(targetFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  } catch (error) {
    return null;
  }
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

function getDefaultArgsTemplate() {
  return 'exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C {{outputDir}} -';
}

function resolveSourceImage(job) {
  const candidates = [
    job?.assets?.local_source_file,
    job?.assets?.source_file,
    job?.floor_plan?.local_source_file
  ];
  return candidates
    .map((candidate) => String(candidate || '').trim())
    .find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function buildDirectVisualPrompt(job, outputDir) {
  const sourceImage = resolveSourceImage(job);
  const blenderBin = process.env.BLENDER_BIN || '/Applications/Blender.app/Contents/MacOS/Blender';
  const blenderRenderer = path.join(projectRoot, '..', 'scripts', 'aiinhouse-blender-renderer.mjs');
  const style = job?.job?.input_payload?.style || 'modern-natural';

  return `# 平面图直接生成 3D 俯瞰图与全景图

你已通过 Codex CLI 的 --image 收到原始平面图：${sourceImage}
工作目录和所有输出文件目录：${outputDir}

## 目标

直接观察原图并建立可渲染的近似 3D 户型，不运行项目的 OCR、OpenCV、本地识别器或 recognition-draft 流水线。采用 ${style} 装修风格。

1. 从原图判断房间轮廓、墙、门、阳台和窗户。图中应重点核对 5 块窗户，辅助线不能作为外墙或阳台边界。
2. 在当前目录生成 formal-plan.json、formal-plan.svg、formal-plan.dxf、3d-config.json、scene-assembly-plan.json、panorama-config.json、review.md 和 preview.svg。
3. 3d-config.json 至少包含 rooms、walls、openings；每个 room 使用原图像素坐标的 bounds={x,y,width,height}。openings 明确区分 door/window，窗户不得被辅助线替代。
4. 使用本机 Blender 真正渲染位图，不调用 curl、HTTP API、图片 API、中转站，也不要用 SVG/Canvas 栅格化冒充 3D 渲染：

\`\`\`bash
BLENDER_BIN="${blenderBin}" AIINHOUSE_BLENDER_SAMPLES=24 node "${blenderRenderer}" --output "${outputDir}" --scene "${path.join(outputDir, '3d-config.json')}" --assembly-plan "${path.join(outputDir, 'scene-assembly-plan.json')}"
BLENDER_BIN="${blenderBin}" AIINHOUSE_BLENDER_SAMPLES=24 node "${blenderRenderer}" --output "${outputDir}" --panorama "${path.join(outputDir, 'panorama-config.json')}" --assembly-plan "${path.join(outputDir, 'scene-assembly-plan.json')}"
\`\`\`

必须确认 effect-blender.png 和 panorama-blender.png 实际存在，且 panorama-blender.png 为 2048x1024 的 2:1 等距柱状全景。最后按 schema 返回 JSON；output.effectImage 填 effect-blender.png，output.panoramaImage 和 output.equirectangularImage 填 panorama-blender.png。summary 中说明这是 Codex CLI 直接看原图建模，recognitionSkipped=true。
`;
}

async function executeCodexCli(job, jobFile, outputDir, options = {}) {
  if (!realCommand) {
    throw new Error('CODEX_REAL_COMMAND 未配置，无法使用 codex_cli 模式');
  }

  const promptFile = path.join(outputDir, 'codex-brief.md');
  const contextFile = path.join(outputDir, 'job-context.json');
  const directVisualPreview = options.directVisualPreview === true;
  const prompt = directVisualPreview ? buildDirectVisualPrompt(job, outputDir) : `${buildCodexPrompt(job)}

## Codex CLI 图片生成要求

本次运行目录是 output 目录: ${outputDir}
项目根目录是: ${projectRoot}

如果当前 Codex CLI 环境可用 imagegen / image generation，请直接生成以下位图文件到 output 目录:

- \`effect-codex.png\`: 装修效果图，建议不低于 1600x1000。
- \`panorama-codex.png\`: VR 全景图，必须是 2:1 equirectangular，建议不低于 2048x1024。

生成图片后，请在最终 JSON 的 \`output.effectImage\` 和 \`output.panoramaImage\` 中返回对应文件名。

如果 imagegen 在 CLI 环境不可用，请先生成 \`3d-config.json\`、\`scene-assembly-plan.json\` 和 \`panorama-config.json\`，再运行本地兜底渲染器:

\`\`\`bash
node "${path.join(projectRoot, 'scripts', 'aiinhouse-auto-renderer.mjs')}" --output "${outputDir}" --scene "${path.join(outputDir, '3d-config.json')}" --assembly-plan "${path.join(outputDir, 'scene-assembly-plan.json')}"
node "${path.join(projectRoot, 'scripts', 'aiinhouse-auto-renderer.mjs')}" --output "${outputDir}" --panorama "${path.join(outputDir, 'panorama-config.json')}"
\`\`\`

兜底渲染器会输出 \`effect-raster.png\` 和 \`panorama-raster.png\`。如果使用兜底，请在最终 JSON 的 \`output.effectImage\` 和 \`output.panoramaImage\` 中返回这两个文件名。
`;
  fs.writeFileSync(promptFile, prompt, 'utf8');
  fs.writeFileSync(contextFile, JSON.stringify(job, null, 2), 'utf8');
  const schemaFile = path.join(outputDir, 'codex-result.schema.json');
  fs.writeFileSync(schemaFile, JSON.stringify(getResultSchema(), null, 2), 'utf8');

  const placeholderValues = {
    outputDir,
    jobFile,
    promptFile,
    contextFile,
    resultFile: path.join(outputDir, resultFileName),
    schemaFile
  };

  const [command, ...baseArgs] = splitCommand(realCommand);
  if (!command) {
    throw new Error('CODEX_REAL_COMMAND 不能为空');
  }

  const argsTemplate = realArgsTemplate || getDefaultArgsTemplate();
  const extraArgs = splitCommand(replacePlaceholders(argsTemplate, placeholderValues));

  const normalizedArgs = [...baseArgs, ...extraArgs].map((arg) => {
    if (arg.startsWith('./') || arg.startsWith('../')) {
      return path.resolve(projectRoot, arg);
    }
    return arg;
  });
  if (directVisualPreview && !normalizedArgs.includes('--ignore-user-config')) {
    const execIndex = normalizedArgs.indexOf('exec');
    normalizedArgs.splice(execIndex === -1 ? 0 : execIndex + 1, 0, '--ignore-user-config');
  }
  const sourceImage = resolveSourceImage(job);
  if (sourceImage && !normalizedArgs.includes('--image') && !normalizedArgs.includes('-i')) {
    const stdinIndex = normalizedArgs.lastIndexOf('-');
    const imageArgs = ['--image', sourceImage];
    if (stdinIndex === -1) {
      normalizedArgs.push(...imageArgs);
    } else {
      normalizedArgs.splice(stdinIndex, 0, ...imageArgs);
    }
  }

  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    if (directVisualPreview) {
      delete childEnv.OPENAI_API_KEY;
      delete childEnv.CODEX_API_KEY;
    }
    const child = spawn(command, normalizedArgs, {
      cwd: projectRoot,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
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

    if (extraArgs.includes('-')) {
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 3000);
    }, Math.max(cliTimeoutMs, 10000));

    function finalizeWithResult(code) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      let parsed = extractJsonFromStdout(stdout);

      if (!parsed) {
        parsed = readResultFromDisk(outputDir);
      }

      if (parsed) {
        resolve({
          ...parsed,
          summary: normalizeSummary(parsed),
          meta: {
            exitCode: code,
            timedOut,
            stderr: stderr.trim()
          }
        });
        return;
      }

      if (timedOut) {
        reject(new Error(`Codex CLI 执行超时，${Math.round(cliTimeoutMs / 1000)} 秒内未拿到有效结果`));
        return;
      }

      const failure = stderr || stdout || `Codex CLI 执行失败，退出码 ${code}`;
      if (/usage limit|hit your usage limit/i.test(failure)) {
        reject(new Error('Codex CLI 已直连官方服务，但当前 ChatGPT Codex 用量已耗尽；额度恢复后可直接重试。'));
        return;
      }
      reject(new Error(failure));
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !readResultFromDisk(outputDir)) {
        clearTimeout(timer);
        const failure = stderr || stdout || `Codex CLI 执行失败，退出码 ${code}`;
        if (/usage limit|hit your usage limit/i.test(failure)) {
          reject(new Error('Codex CLI 已直连官方服务，但当前 ChatGPT Codex 用量已耗尽；额度恢复后可直接重试。'));
          return;
        }
        reject(new Error(failure));
        return;
      }

      finalizeWithResult(code);
    });
  });
}

module.exports = {
  executeCodexCli,
  resolveSourceImage
};
