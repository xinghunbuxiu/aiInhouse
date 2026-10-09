const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const {
  recognitionApiBaseUrl,
  recognitionApiKey,
  recognitionApiModel,
  recognitionAiCommand,
  recognitionAiArgsTemplate,
  recognitionTimeoutMs,
  projectRoot
} = require('../config');
const { getRecognitionDraftFile } = require('./external-command');
const { buildRecognitionPrompt } = require('./prompt-builder');
const { getRecognitionDraftSchema } = require('./schema');

function splitCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"(.*)"$/, '$1'));
}

function replacePlaceholders(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || '');
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

function summarizeCommandError(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return 'AI 识别命令未返回有效结果';
  }

  if (raw.includes('"type":"proxy_error"') || raw.includes('"type": "proxy_error"')) {
    return 'AI 服务返回 proxy_error，请稍后重试或检查当前代理/服务状态';
  }

  if (raw.includes('migration 23 was previously applied but is missing')) {
    return '本机 codex 状态库异常，请检查 ~/.codex/state_5.sqlite 的迁移状态';
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('202') || !line.includes('WARN codex_'))
    .filter((line) => !line.startsWith('OpenAI Codex v'))
    .filter((line) => line !== '--------')
    .filter((line) => line !== 'user');

  return lines.slice(-3).join(' | ') || 'AI 识别命令执行失败';
}

function getDefaultArgsTemplate() {
  return 'exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C {{outputDir}} --output-schema {{schemaFile}} -';
}

function buildDataUrlFromImage(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  const mimeType = mimeTypeMap[ext] || 'image/png';
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function resolveRecognitionImagePath(options = {}) {
  return options.preprocessing?.preprocessedImagePath || options.sourceAsset?.path || '';
}

function buildRecognitionCacheKey(prompt, imagePath) {
  const hash = crypto.createHash('sha1');
  hash.update(prompt || '');
  hash.update('::');
  hash.update(imagePath || '');

  if (imagePath && fs.existsSync(imagePath)) {
    const stat = fs.statSync(imagePath);
    hash.update('::');
    hash.update(String(stat.size));
    hash.update('::');
    hash.update(String(stat.mtimeMs));
  }

  return hash.digest('hex');
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    return payload.output
      .flatMap((item) => item.content || [])
      .map((content) => content.text || content.output_text || '')
      .filter(Boolean)
      .join('');
  }

  return payload.choices?.[0]?.message?.content || '';
}

function parseJsonText(text) {
  const direct = tryParseJson(text);
  if (direct) {
    return direct;
  }

  const match = String(text || '').match(/\{[\s\S]*\}/);
  return match ? tryParseJson(match[0]) : null;
}

function extractJsonFromSse(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let finalText = '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) {
      continue;
    }

    const payload = tryParseJson(line.slice(6));
    if (!payload) {
      continue;
    }

    if (payload.type === 'response.output_text.delta') {
      finalText += payload.delta || '';
    }

    if (payload.type === 'response.output_text.done' && payload.text) {
      finalText = payload.text;
    }

    if (payload.type === 'response.failed' || payload.type === 'error') {
      return null;
    }
  }

  return tryParseJson(finalText) || null;
}

function extractJsonFromApiResponse(text) {
  const parsed = tryParseJson(text);
  if (parsed?.error) {
    throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  }

  if (parsed) {
    return parseJsonText(extractOutputText(parsed)) || parsed;
  }

  return extractJsonFromSse(text) || parseJsonText(text);
}

function callJsonApi(endpoint, payload, { timeoutMs, apiKey }) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const client = url.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: Math.max(timeoutMs, 10000)
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        text += chunk;
      });
      response.on('end', () => {
        if (response.statusCode >= 400) {
          reject(new Error(summarizeCommandError(text) || `AI API 请求失败: ${response.statusCode}`));
          return;
        }

        resolve(text);
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`AI API 请求超时，${Math.round(timeoutMs / 1000)} 秒内未返回结果`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRoom(room = {}, index = 0) {
  const position = room.position || {};
  const width = toNumber(room.width, toNumber(room.bounds?.width, 100));
  const height = toNumber(room.height, toNumber(room.length, toNumber(room.bounds?.height, 80)));

  return {
    id: room.id || `room-${index + 1}`,
    name: room.name || `空间 ${index + 1}`,
    type: room.type || 'space',
    area: toNumber(room.area, Math.max(4, Math.round((width * height) / 900))),
    x: toNumber(room.x, toNumber(position.x, toNumber(room.bounds?.x, 40 + index * 30))),
    y: toNumber(room.y, toNumber(position.y, toNumber(room.bounds?.y, 40 + index * 20))),
    width,
    height,
    confidence: toNumber(room.confidence, 0.72)
  };
}

function normalizeWall(wall = {}, index = 0) {
  return {
    id: wall.id || `wall-${index + 1}`,
    start: wall.start || { x: toNumber(wall.from?.[0], 0), y: toNumber(wall.from?.[1], 0) },
    end: wall.end || { x: toNumber(wall.to?.[0], 100), y: toNumber(wall.to?.[1], 0) },
    thickness: toNumber(wall.thickness, 12),
    confidence: toNumber(wall.confidence, 0.72)
  };
}

function normalizeOpening(opening = {}, type, index = 0) {
  return {
    id: opening.id || `${type}-${index + 1}`,
    type: opening.type || type,
    x: toNumber(opening.x, toNumber(opening.position?.x, 0)),
    y: toNumber(opening.y, toNumber(opening.position?.y, 0)),
    width: toNumber(opening.width, type === 'door' ? 12 : 18),
    height: toNumber(opening.height, 8),
    confidence: toNumber(opening.confidence, 0.7)
  };
}

function scoreRecognitionQuality(draft) {
  const rooms = draft.rooms || [];
  const walls = draft.walls || [];
  const openings = [...(draft.doors || []), ...(draft.windows || [])];
  const roomScore = Math.min(1, rooms.length / 4) * 0.35;
  const wallScore = Math.min(1, walls.length / Math.max(4, rooms.length * 3)) * 0.3;
  const openingScore = Math.min(1, openings.length / Math.max(2, rooms.length)) * 0.15;
  const confidenceScore = Math.min(1, ((draft.confidence?.geometry || 0) + (draft.confidence?.semantics || 0)) / 2) * 0.2;
  return Number((roomScore + wallScore + openingScore + confidenceScore).toFixed(2));
}

function buildRecoveryPrompt(basePrompt, firstDraft) {
  return `${basePrompt}\n\n第一次识别结果需要复核。请重新检查原图和几何证据，重点修正以下初稿中的错误，而不是简单重复初稿。\n复核要求：\n- 先核对墙线、房间边界和门窗位置，再判断空间用途。\n- OCR 标签只能分配给标签中心点实际位于其内部的空间。\n- 不得把电梯井、管道井、设备平台或入户玄关误判成卫生间/卧室。\n- 不得为了满足常见户型模板而新增无证据房间。\n- 如果证据不足，保留“未确认空间”，并降低置信度、说明 issues。\n- 输出完整且符合指定 JSON Schema 的 recognition-draft，不要输出解释。\n\n初次识别结果：\n${JSON.stringify(firstDraft, null, 2)}`;
}

function normalizeRecognitionDraft(result, fallbackDraft = {}, probe = null) {
  const base = result && typeof result === 'object' ? result : {};
  const normalized = {
    version: base.version || '0.1.0',
    sourceType: base.sourceType || fallbackDraft.sourceType || probe?.sourceType || 'digital',
    generatedAt: base.generatedAt || new Date().toISOString(),
    strategy: {
      localGeometry: base.strategy?.localGeometry || 'ai_image_recognition',
      semanticReview: base.strategy?.semanticReview || 'gpt_post_review',
      targetOutput: base.strategy?.targetOutput || 'cad_ready_floor_plan'
    },
    confidence: {
      geometry: Number(base.confidence?.geometry ?? probe?.confidence ?? fallbackDraft.confidence?.geometry ?? 0.7),
      semantics: Number(base.confidence?.semantics ?? probe?.confidence ?? fallbackDraft.confidence?.semantics ?? 0.7)
    },
    rooms: (Array.isArray(base.rooms) && base.rooms.length ? base.rooms : (fallbackDraft.rooms || [])).map(normalizeRoom),
    walls: (Array.isArray(base.walls) && base.walls.length ? base.walls : (fallbackDraft.walls || [])).map(normalizeWall),
    doors: (Array.isArray(base.doors) ? base.doors : (fallbackDraft.doors || [])).map((item, index) => normalizeOpening(item, 'door', index)),
    windows: (Array.isArray(base.windows) ? base.windows : (fallbackDraft.windows || [])).map((item, index) => normalizeOpening(item, 'window', index)),
    issues: Array.isArray(base.issues) ? base.issues : [],
    nextActions: Array.isArray(base.nextActions) ? base.nextActions : [
      '人工复核房间名称与边界',
      '确认后输出 CAD/正式图',
      '继续生成全屋 3D 与全景配置'
    ]
  };

  normalized.quality = {
    score: scoreRecognitionQuality(normalized),
    roomCount: normalized.rooms.length,
    wallCount: normalized.walls.length,
    openingCount: normalized.doors.length + normalized.windows.length,
    needsReview: normalized.rooms.length < 2 || normalized.walls.length < 4 || normalized.confidence.geometry < 0.65
  };

  return normalized;
}

async function runApiRecognition(prompt, schema, outputDir, options = {}) {
  if (!recognitionApiBaseUrl || !recognitionApiKey) {
    return null;
  }

  const endpoint = `${recognitionApiBaseUrl.replace(/\/+$/, '')}/responses`;
  const primaryPayloadFile = path.join(outputDir, 'recognition-api-request.json');
  const fallbackPayloadFile = path.join(outputDir, 'recognition-api-request-fallback.json');
  const imagePath = resolveRecognitionImagePath(options);
  const cacheKey = buildRecognitionCacheKey(prompt, imagePath);
  const cacheFile = path.join(outputDir, `recognition-cache-${cacheKey}.json`);

  if (fs.existsSync(cacheFile)) {
    const cached = tryParseJson(fs.readFileSync(cacheFile, 'utf8'));
    if (cached) {
      return cached;
    }
  }

  const payload = {
    model: recognitionApiModel,
    stream: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'floor_plan_recognition_draft',
        schema,
        strict: false
      }
    },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `${prompt}\n\n请只输出合法 JSON，不要输出 markdown、解释或代码块。JSON 结构必须满足上面的字段要求。`
          },
          ...(imagePath ? [{
            type: 'input_image',
            image_url: buildDataUrlFromImage(imagePath)
          }] : [])
        ]
      }
    ]
  };

  fs.writeFileSync(primaryPayloadFile, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(fallbackPayloadFile, JSON.stringify(payload, null, 2), 'utf8');

  const text = await callJsonApi(endpoint, payload, {
    timeoutMs: recognitionTimeoutMs,
    apiKey: recognitionApiKey
  });
  const parsed = extractJsonFromApiResponse(text);
  if (parsed) {
    fs.writeFileSync(cacheFile, JSON.stringify(parsed, null, 2), 'utf8');
    return parsed;
  }

  throw new Error('AI API 已返回，但没有得到合法的 recognition-draft JSON');
}

async function runApiProbe(prompt, outputDir, options = {}) {
  if (!recognitionApiBaseUrl || !recognitionApiKey) {
    return null;
  }

  const endpoint = `${recognitionApiBaseUrl.replace(/\/+$/, '')}/responses`;
  const imagePath = resolveRecognitionImagePath(options);
  const probeFile = path.join(outputDir, 'recognition-probe-request.json');

  const payload = {
    model: recognitionApiModel,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `${prompt}\n\n请只输出合法 JSON，不要输出 markdown、解释或代码块。`
          },
          ...(imagePath ? [{
            type: 'input_image',
            image_url: buildDataUrlFromImage(imagePath)
          }] : [])
        ]
      }
    ]
  };

  fs.writeFileSync(probeFile, JSON.stringify(payload, null, 2), 'utf8');

  const text = await callJsonApi(endpoint, payload, {
    timeoutMs: 20000,
    apiKey: recognitionApiKey
  });

  return extractJsonFromApiResponse(text);
}

async function runAiRecognition(job, outputDir, options = {}) {
  if (!recognitionAiCommand && !(recognitionApiBaseUrl && recognitionApiKey)) {
    return null;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const prompt = buildRecognitionPrompt({
    job: {
      id: job?.job?.id,
      jobNo: job?.job?.job_no,
      jobType: job?.job?.job_type,
      sourceType: job?.job?.source_type,
      inputPayload: job?.job?.input_payload || {}
    },
    floorPlan: {
      id: job?.floor_plan?.id,
      name: job?.floor_plan?.name,
      imageUrl: job?.floor_plan?.image_url || '',
      parseResultExists: Boolean(job?.floor_plan?.parse_result)
    },
    sourceAsset: options.sourceAsset || {},
    preprocessing: options.preprocessing || null,
    fallbackDraft: options.fallbackDraft || {}
  });

  const promptFile = path.join(outputDir, 'recognition-prompt.md');
  const contextFile = path.join(outputDir, 'recognition-context.json');
  const schemaFile = path.join(outputDir, 'recognition-draft.schema.json');
  const draftFile = getRecognitionDraftFile(outputDir);
  const schema = getRecognitionDraftSchema();

  fs.writeFileSync(promptFile, prompt, 'utf8');
  fs.writeFileSync(contextFile, JSON.stringify({
    job: job?.job || {},
    floorPlan: job?.floor_plan || {},
    sourceAsset: options.sourceAsset || {},
    preprocessing: options.preprocessing || null,
    fallbackDraft: options.fallbackDraft || {}
  }, null, 2), 'utf8');
  fs.writeFileSync(schemaFile, JSON.stringify(schema, null, 2), 'utf8');

  if (recognitionApiBaseUrl && recognitionApiKey) {
    const apiResult = await runApiRecognition(prompt, schema, outputDir, options);
    let normalized = normalizeRecognitionDraft(apiResult, options.fallbackDraft || {}, null);

    // Normal-quality results use one model call. Only weak results enter a
    // schema-constrained repair pass that receives the first draft as evidence.
    if (normalized.quality?.needsReview) {
      normalized.quality = {
        ...(normalized.quality || {}),
        recoveryAttempted: true,
        recoveryAccepted: false
      };
      try {
        const recoveryPrompt = buildRecoveryPrompt(prompt, normalized);
        const recoveryResult = await runApiRecognition(recoveryPrompt, schema, outputDir, options);
        if (recoveryResult) {
          const recovered = normalizeRecognitionDraft(recoveryResult, options.fallbackDraft || {}, null);
          const hasUsableStructure = recovered.rooms.length >= 2 && recovered.walls.length >= 4;
          const notMateriallyWorse = recovered.quality.score >= normalized.quality.score - 0.05;
          if (hasUsableStructure && notMateriallyWorse) {
            normalized = {
              ...recovered,
              quality: {
                ...(recovered.quality || {}),
                recoveryAttempted: true,
                recoveryAccepted: true
              }
            };
          } else {
            normalized.quality = {
              ...(normalized.quality || {}),
              recoveryAttempted: true,
              recoveryAccepted: false,
              recoveryRejectedReason: !hasUsableStructure ? 'incomplete-geometry' : 'quality-regressed'
            };
          }
        }
      } catch (error) {
        normalized.quality = {
          ...(normalized.quality || {}),
          recoveryAttempted: true,
          recoveryAccepted: false,
          recoveryError: String(error.message || error).slice(0, 240)
        };
      }
    } else {
      normalized.quality = {
        ...(normalized.quality || {}),
        recoveryAttempted: false,
        recoveryAccepted: false
      };
    }

    fs.writeFileSync(draftFile, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  const placeholderValues = {
    outputDir,
    promptFile,
    contextFile,
    schemaFile,
    draftFile,
    imagePath: options.sourceAsset?.path || ''
  };

  const [command, ...baseArgs] = splitCommand(recognitionAiCommand);
  if (!command) {
    return null;
  }

  const argsTemplate = recognitionAiArgsTemplate || getDefaultArgsTemplate();
  const extraArgs = splitCommand(replacePlaceholders(argsTemplate, placeholderValues));
  const normalizedArgs = [...baseArgs, ...extraArgs].map((arg) => {
    if (arg.startsWith('./') || arg.startsWith('../')) {
      return path.resolve(projectRoot, arg);
    }
    return arg;
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, normalizedArgs, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
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

    if (extraArgs.includes('-')) {
      child.stdin.write(prompt);
    }
    child.stdin.end();

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

      let parsed = extractJsonFromStdout(stdout);
      if (!parsed && fs.existsSync(draftFile)) {
        parsed = tryParseJson(fs.readFileSync(draftFile, 'utf8'));
      }

      if (parsed) {
        resolve(parsed);
        return;
      }

      if (timedOut) {
        reject(new Error(`AI 识别执行超时，${Math.round(recognitionTimeoutMs / 1000)} 秒内未拿到有效结果`));
        return;
      }

      reject(new Error(summarizeCommandError(stderr || stdout || `AI 识别执行失败，退出码 ${code}`)));
    });
  });
}

module.exports = {
  runAiRecognition,
  buildRecoveryPrompt,
  normalizeRecognitionDraft
};
