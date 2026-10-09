import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeBaseUrl(value) {
  const raw = String(value || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (raw === 'https://api.openai.com') {
    return 'https://api.openai.com/v1';
  }
  return raw;
}

function getApiKey() {
  return process.env.OPENAI_API_KEY
    || process.env.CODEX_RENDER_API_KEY
    || process.env.CODEX_PANORAMA_API_KEY
    || '';
}

function getRequestTimeoutMs(purpose = '') {
  const purposeTimeout = purpose === 'vr-panorama'
    ? (process.env.OPENAI_PANORAMA_IMAGE_REQUEST_TIMEOUT_MS || process.env.CODEX_PANORAMA_IMAGE_REQUEST_TIMEOUT_MS)
    : (process.env.OPENAI_EFFECT_IMAGE_REQUEST_TIMEOUT_MS || process.env.CODEX_EFFECT_IMAGE_REQUEST_TIMEOUT_MS);

  return Number(purposeTimeout || process.env.OPENAI_IMAGE_REQUEST_TIMEOUT_MS || process.env.CODEX_IMAGE_REQUEST_TIMEOUT_MS || 120000);
}

function getRequestMaxRetries() {
  return Math.max(0, Number(process.env.OPENAI_IMAGE_MAX_RETRIES || process.env.CODEX_IMAGE_MAX_RETRIES || 1));
}

function getRetryDelayMs() {
  return Math.max(0, Number(process.env.OPENAI_IMAGE_RETRY_DELAY_MS || process.env.CODEX_IMAGE_RETRY_DELAY_MS || 2500));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  const message = String(error?.message || '');
  const statusMatch = message.match(/HTTP\s+(\d+)/);
  if (!statusMatch) {
    return true;
  }

  const status = Number(statusMatch[1]);
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function withRetry(fn) {
  const maxRetries = getRequestMaxRetries();
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await fn(attempt);
      return {
        result,
        retryAttempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }
      await sleep(getRetryDelayMs() * (attempt + 1));
    }
  }

  throw lastError;
}

function parseSize(size) {
  const match = String(size || '').match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function commandExists(command) {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    encoding: 'utf8'
  });
  return result.status === 0 && result.stdout.trim();
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) {
      return null;
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return null;
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }

  return null;
}

function readImageDimensions(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return readPngDimensions(buffer)
    || readJpegDimensions(buffer)
    || readWebpDimensions(buffer)
    || null;
}

function resizeImageIfNeeded(filePath, targetSize) {
  if (process.env.OPENAI_IMAGE_POSTPROCESS_RESIZE === 'false') {
    return { resized: false, reason: 'disabled' };
  }

  const target = parseSize(targetSize);
  const current = readImageDimensions(filePath);
  if (!target || !current) {
    return { resized: false, dimensions: current };
  }

  if (current.width >= target.width && current.height >= target.height) {
    return { resized: false, dimensions: current };
  }

  const tempFile = `${filePath}.resize-tmp${path.extname(filePath) || '.png'}`;
  if (commandExists('ffmpeg')) {
    const result = spawnSync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-vf', `scale=${target.width}:${target.height}:flags=lanczos`,
      tempFile
    ], {
      encoding: 'utf8'
    });

    if (result.status !== 0 || !fs.existsSync(tempFile)) {
      fs.rmSync(tempFile, { force: true });
      throw new Error(result.stderr || result.stdout || 'ffmpeg 图片尺寸后处理失败');
    }

    fs.renameSync(tempFile, filePath);
    return {
      resized: true,
      from: current,
      to: readImageDimensions(filePath) || target,
      method: 'ffmpeg'
    };
  }

  if (commandExists('sips')) {
    const result = spawnSync('sips', ['-z', String(target.height), String(target.width), filePath], {
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'sips 图片尺寸后处理失败');
    }

    return {
      resized: true,
      from: current,
      to: readImageDimensions(filePath) || target,
      method: 'sips'
    };
  }

  return {
    resized: false,
    dimensions: current,
    reason: 'missing ffmpeg/sips'
  };
}

function validateImageSize(size, purpose) {
  if (size === 'auto') {
    return;
  }

  const parsed = parseSize(size);
  if (!parsed) {
    throw new Error(`图片尺寸格式无效: ${size}，应为 WIDTHxHEIGHT 或 auto`);
  }

  if (parsed.width % 16 !== 0 || parsed.height % 16 !== 0) {
    throw new Error(`图片尺寸必须能被 16 整除: ${size}`);
  }

  const ratio = parsed.width / parsed.height;
  if (ratio < 1 / 3 || ratio > 3) {
    throw new Error(`图片比例超出 GPT Image 支持范围 1:3 到 3:1: ${size}`);
  }

  if (purpose === 'vr-panorama' && Math.abs(ratio - 2) > 0.02) {
    throw new Error(`VR 全景图必须使用 2:1 尺寸，例如 2048x1024，当前为 ${size}`);
  }
}

function normalizeOutputFormat(value) {
  const normalized = String(value || 'png').toLowerCase();
  return normalized === 'jpg' ? 'jpeg' : normalized;
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  return 'image/png';
}

function findSourceImage(job = {}, outputDir = '') {
  const candidates = [
    job?.assets?.local_source_file,
    job?.floor_plan?.local_source_file,
    path.join(outputDir, 'recognition-input.jpg'),
    path.join(outputDir, 'source-plan.jpg')
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function findGeneratedBirdseyeImage(outputDir = '') {
  const candidates = [
    'effect-openai.png',
    'effect-openai.jpg',
    'effect-openai.webp',
    'birdseye-openai.png',
    'effect-blender.png',
    'effect-raster.png',
    'birdseye-raster.png'
  ].map((fileName) => path.join(outputDir, fileName));
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function outputExtension(format) {
  return normalizeOutputFormat(format) === 'jpeg' ? 'jpg' : normalizeOutputFormat(format);
}

function imageToDataUrl(filePath) {
  return `data:${mimeTypeForFile(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function extractBase64Image(value, depth = 0) {
  if (!value || depth > 8) {
    return '';
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      return value.split(',').pop() || '';
    }

    if (/^[A-Za-z0-9+/=\s_-]{200,}$/.test(value)) {
      return value.replace(/\s/g, '');
    }

    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractBase64Image(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return '';
  }

  if (typeof value === 'object') {
    for (const key of [
      'b64_json',
      'base64',
      'image_base64',
      'image',
      'result',
      'data',
      'content',
      'output'
    ]) {
      const found = extractBase64Image(value[key], depth + 1);
      if (found) {
        return found;
      }
    }

    for (const nested of Object.values(value)) {
      const found = extractBase64Image(nested, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return '';
}

function roomSummary(rooms = []) {
  return rooms.map((room) => {
    const bounds = room.bounds || room;
    return `${room.name || room.id}: ${room.type || 'space'} x=${bounds.x || 0}, y=${bounds.y || 0}, w=${bounds.width || 0}, h=${bounds.height || 0}`;
  }).join('; ');
}

function buildEffectPrompt(scene = {}, assemblyPlan = {}, job = {}) {
  const rooms = scene.rooms || assemblyPlan.roomPlans || [];
  const rendererPrompt = scene.renderer?.imageGenerationPrompt || '';
  const materials = scene.materials || {};
  const style = scene.style || assemblyPlan.style || job?.job?.input_payload?.style || 'modern';
  const describedSpaces = job?.house?.description || job?.house?.layout || '';
  const topologyConstraint = rooms.length
    ? `Rooms and validated topology: ${roomSummary(rooms)}.`
    : `Room hints from project description: ${describedSpaces || 'infer room functions only from the attached floor plan'}.`;

  return [
    rendererPrompt,
    'Use case: sketch-to-render',
    'Asset type: commercial apartment interior effect render',
    `Primary request: Generate one polished, market-ready furnished isometric top-down 3D render for this apartment. Style: ${style}.`,
    topologyConstraint,
    `Material direction: floor ${materials.floor?.texture || 'warm wood / tile by room'}, wall ${materials.wall?.texture || 'warm matte paint'}, ceiling ${materials.ceiling?.texture || 'matte white'}.`,
    'Composition/framing: whole-home cutaway apartment view, all rooms visible, realistic lighting, clean architectural visualization, no labels.',
    'Reference-image constraint: use the attached floor plan as the visual source of truth. Preserve its outer outline, room count, room adjacency, balcony, stairs, doors, windows, and circulation as closely as the image allows.',
    'Commercial constraints: layout fidelity is more important than decoration. Keep the exact room count and relative layout; do not swap kitchen, bathroom, bedroom, living, dining, entry, or balcony positions.',
    'Avoid: watermarks, text labels, extra rooms, impossible stairs, exterior facade, distorted walls, fantasy styling, cluttered showroom staging.'
  ].filter(Boolean).join('\n');
}

function buildPanoramaPrompt(panorama = {}, scene = {}, job = {}, referenceKind = 'floor-plan') {
  const cameras = panorama.cameraPositions || [];
  const hotspots = panorama.hotspots || [];
  const cameraNames = cameras.map((camera) => camera.name).join(', ');
  const hotspotNames = hotspots.map((hotspot) => hotspot.text).join(', ');
  const rooms = scene.rooms || [];
  const topologyLine = rooms.length
    ? `Rooms and topology: ${roomSummary(rooms)}.`
    : `Room hints from project description: ${job?.house?.description || job?.house?.layout || 'infer from the approved birdseye render'}.`;

  return [
    'Use case: photorealistic-natural',
    'Asset type: commercial VR equirectangular panorama',
    'Primary request: Generate one 2:1 equirectangular interior panorama for a modern furnished apartment VR tour.',
    `Scene coverage: camera positions include ${cameraNames || 'living room and adjacent rooms'}.`,
    `Navigation hotspots correspond to: ${hotspotNames || 'major rooms'}.`,
    topologyLine,
    'Composition/framing: immersive 360-degree interior, natural perspective, no black borders, no UI overlays, no text labels.',
    'Lighting/mood: bright residential daylight with warm practical lights, polished but believable commercial real-estate visualization.',
    referenceKind.startsWith('generated-birdseye')
      ? 'Reference-image constraint: the attached image is the approved whole-home furnished birdseye render. Reuse the same architecture, furniture language, materials, colors, window locations, daylight direction, and room adjacency. Place the panorama camera inside the living/dining core of that exact design; do not redesign the apartment.'
      : 'Reference-image constraint: use the attached floor plan as the layout source. The panorama should feel like it is located inside the living/dining core and connected to the real neighboring rooms from the plan.',
    'Commercial constraints: output must read as a complete 360 panorama, maintain apartment continuity, avoid impossible openings or duplicate rooms.',
    `Job context: ${job?.floor_plan?.name || job?.job?.job_no || 'AIInHouse floor plan'}.`
  ].join('\n');
}

function isEditCapableImageModel(model) {
  return [
    'gpt-image-2',
    'gpt-image-1.5',
    'gpt-image-1',
    'gpt-image-1-mini',
    'chatgpt-image-latest',
    'dall-e-2'
  ].includes(String(model || '').toLowerCase());
}

async function requestText({ url, apiKey, body, headers = {}, timeoutMs = getRequestTimeoutMs() }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    throw new Error(`请求失败: ${error.message}`);
  }

  const text = await response.text();
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status} ${text.slice(0, 800)}`);
  }

  return text;
}

async function generateImageViaResponsesTool({ prompt, size, outputFile, purpose, sourceImagePath, apiKey, baseUrl, outputFormat }) {
  const model = process.env.OPENAI_RESPONSES_MODEL
    || process.env.OPENAI_IMAGE_RESPONSES_MODEL
    || process.env.CODEX_RESPONSES_MODEL
    || process.env.OPENAI_MODEL
    || process.env.CODEX_IMAGE_MODEL
    || 'gpt-5.1';
  const content = [
    { type: 'input_text', text: prompt }
  ];

  const hasReferenceImage = Boolean(sourceImagePath && fs.existsSync(sourceImagePath)) && process.env.CODEX_IMAGE_USE_REFERENCE !== 'false';
  if (hasReferenceImage) {
    content.push({
      type: 'input_image',
      image_url: imageToDataUrl(sourceImagePath)
    });
  }

  const tool = {
    type: 'image_generation'
  };

  if (size && size !== 'auto') {
    tool.size = size;
  }
  if (outputFormat) {
    tool.output_format = outputFormat;
  }
  if (process.env.OPENAI_IMAGE_QUALITY) {
    tool.quality = process.env.OPENAI_IMAGE_QUALITY;
  }

  const body = {
    model,
    input: [
      {
        role: 'user',
        content
      }
    ],
    tools: [tool],
    tool_choice: { type: 'image_generation' }
  };

  const { result: text, retryAttempts } = await withRetry(() => requestText({
    url: `${baseUrl}/responses`,
    apiKey,
    body,
    timeoutMs: getRequestTimeoutMs(purpose)
  }));
  const payload = JSON.parse(text);
  const b64 = extractBase64Image(payload);
  if (!b64) {
    throw new Error(`${baseUrl}/responses 响应中没有找到图片 base64`);
  }

  fs.writeFileSync(outputFile, Buffer.from(b64, 'base64'));
  const postprocess = resizeImageIfNeeded(outputFile, size);
  return {
    fileName: path.basename(outputFile),
    model,
    outputFormat,
    size,
    purpose,
    endpoint: '/responses',
    usedReferenceImage: hasReferenceImage,
    referenceImage: hasReferenceImage ? sourceImagePath : '',
    responseId: payload.id || '',
    tool: 'image_generation',
    retryAttempts,
    postprocess
  };
}

async function generateImageViaImagesApi({ prompt, size, outputFile, purpose, sourceImagePath, apiKey, baseUrl, outputFormat }) {
  const hasReferenceImage = Boolean(sourceImagePath && fs.existsSync(sourceImagePath)) && process.env.CODEX_IMAGE_USE_REFERENCE !== 'false';
  const configuredModel = process.env.OPENAI_IMAGE_MODEL || process.env.CODEX_IMAGE_MODEL || '';
  const referenceModel = process.env.OPENAI_IMAGE_REFERENCE_MODEL || process.env.CODEX_IMAGE_REFERENCE_MODEL || 'gpt-image-2';
  const model = hasReferenceImage && !configuredModel
    ? referenceModel
    : (configuredModel || 'gpt-image-2');
  const quality = process.env.OPENAI_IMAGE_QUALITY || 'high';

  if (hasReferenceImage && !isEditCapableImageModel(model)) {
    throw new Error(`当前模型 ${model} 未配置为 /images/edits 可用模型。请设置 CODEX_IMAGE_REFERENCE_MODEL=gpt-image-1.5 或 CODEX_IMAGE_MODEL=chatgpt-image-latest，或设置 CODEX_IMAGE_USE_REFERENCE=false 回退到纯文字生成。`);
  }

  const generationBody = {
    model,
    prompt,
    size,
    quality,
    output_format: outputFormat,
    n: 1
  };
  const endpoint = hasReferenceImage ? '/images/edits' : '/images/generations';
  const requestBody = hasReferenceImage ? (() => {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('output_format', outputFormat);
    form.append('n', '1');
    if (model !== 'gpt-image-2') {
      form.append('input_fidelity', process.env.OPENAI_IMAGE_INPUT_FIDELITY || 'high');
    }
    form.append(
      'image[]',
      new Blob([fs.readFileSync(sourceImagePath)], { type: mimeTypeForFile(sourceImagePath) }),
      path.basename(sourceImagePath)
    );
    return form;
  })() : JSON.stringify(generationBody);

  let response;
  let text = '';
  const { retryAttempts } = await withRetry(async () => {
    const attemptController = new AbortController();
    const timer = setTimeout(() => attemptController.abort(), getRequestTimeoutMs(purpose));
    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(hasReferenceImage ? {} : { 'Content-Type': 'application/json' })
        },
        body: requestBody,
        signal: attemptController.signal
      });
    } catch (error) {
      throw new Error(`OpenAI 图片生成请求失败: ${error.message}。请检查 OPENAI_API_KEY、OPENAI_IMAGE_BASE_URL/CODEX_IMAGE_BASE_URL 和当前网络。`);
    } finally {
      clearTimeout(timer);
    }

    text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI 图片生成失败: ${baseUrl}${endpoint} HTTP ${response.status} ${text.slice(0, 800)}`);
    }

    return text;
  });

  const payload = JSON.parse(text);
  const image = payload.data?.[0];
  const b64 = extractBase64Image(image);
  if (!b64) {
    throw new Error('OpenAI 图片生成响应缺少 b64_json/base64');
  }

  fs.writeFileSync(outputFile, Buffer.from(b64, 'base64'));
  const postprocess = resizeImageIfNeeded(outputFile, size);
  return {
    fileName: path.basename(outputFile),
    model,
    quality,
    outputFormat,
    size,
    purpose,
    endpoint,
    usedReferenceImage: hasReferenceImage,
    referenceImage: hasReferenceImage ? sourceImagePath : '',
    revisedPrompt: image.revised_prompt || '',
    retryAttempts,
    postprocess
  };
}

async function generateImage({ prompt, size, outputFile, purpose, sourceImagePath = '' }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY / CODEX_RENDER_API_KEY / CODEX_PANORAMA_API_KEY，无法生成真实商用图片');
  }

  const baseUrl = normalizeBaseUrl(
    process.env.OPENAI_IMAGE_BASE_URL
    || process.env.CODEX_IMAGE_BASE_URL
    || process.env.OPENAI_BASE_URL
  );
  const requireOfficialOpenAi = !['false', '0', 'no', 'off'].includes(
    String(process.env.CODEX_REQUIRE_OFFICIAL_OPENAI || 'true').toLowerCase()
  );
  if (requireOfficialOpenAi) {
    let hostname = '';
    try {
      hostname = new URL(baseUrl).hostname.toLowerCase();
    } catch (_) {
      throw new Error(`OpenAI 图片服务地址无效: ${baseUrl}`);
    }
    if (hostname !== 'api.openai.com') {
      throw new Error(`已禁止非官方图片中转地址: ${baseUrl}。请使用 https://api.openai.com/v1`);
    }
  }
  const outputFormat = normalizeOutputFormat(process.env.OPENAI_IMAGE_OUTPUT_FORMAT || 'png');
  validateImageSize(size, purpose);

  const mode = String(process.env.OPENAI_IMAGE_MODE || process.env.CODEX_IMAGE_MODE || 'auto').toLowerCase();
  const attempts = [];
  const shouldTryResponses = !['images', 'images_api', 'image_api'].includes(mode);

  if (shouldTryResponses) {
    try {
      const result = await generateImageViaResponsesTool({
        prompt,
        size,
        outputFile,
        purpose,
        sourceImagePath,
        apiKey,
        baseUrl,
        outputFormat
      });
      return {
        ...result,
        attempts: [{ mode: 'responses_image_generation', ok: true }]
      };
    } catch (error) {
      attempts.push({
        mode: 'responses_image_generation',
        ok: false,
        error: error.message
      });
      if (mode === 'responses' || mode === 'responses_tool') {
        const wrapped = new Error(error.message);
        wrapped.attempts = attempts;
        throw wrapped;
      }
    }
  }

  try {
    const result = await generateImageViaImagesApi({
      prompt,
      size,
      outputFile,
      purpose,
      sourceImagePath,
      apiKey,
      baseUrl,
      outputFormat
    });
    return {
      ...result,
      attempts: [...attempts, { mode: 'images_api', ok: true }]
    };
  } catch (error) {
    attempts.push({
      mode: 'images_api',
      ok: false,
      error: error.message
    });
    const wrapped = new Error(attempts.map((attempt) => `${attempt.mode}: ${attempt.error}`).join('\n'));
    wrapped.attempts = attempts;
    throw wrapped;
  }
}

async function main() {
  const outputDir = path.resolve(getArg('--output') || process.cwd());
  const jobPath = getArg('--job');
  const scenePath = getArg('--scene');
  const assemblyPath = getArg('--assembly-plan');
  const panoramaPath = getArg('--panorama');
  const directFloorplan = hasArg('--direct-floorplan');
  const promptOnly = hasArg('--prompt-only');
  ensureDir(outputDir);

  const job = readJson(jobPath, {});
  const sourceImagePath = findSourceImage(job, outputDir);
  const previousManifest = readJson(path.join(outputDir, 'openai-image-render-result.json'), {});
  const manifest = {
    provider: 'openai-image-api',
    mode: directFloorplan ? 'direct-floorplan-preview' : 'model-assisted-render',
    recognitionSkipped: directFloorplan,
    structureValidated: !directFloorplan,
    generatedAt: new Date().toISOString(),
    sourceImage: sourceImagePath || null,
    output: { ...(previousManifest.output || {}) },
    summary: { ...(previousManifest.summary || {}) },
    lineage: { ...(previousManifest.lineage || {}) }
  };

  if (directFloorplan && !sourceImagePath) {
    throw new Error('直接生成模式缺少原始平面图，无法生成俯瞰图和全景图');
  }

  if (scenePath || directFloorplan) {
    const scene = readJson(scenePath, {});
    const assemblyPlan = readJson(assemblyPath, {});
    const prompt = buildEffectPrompt(scene, assemblyPlan, job);
    fs.writeFileSync(path.join(outputDir, 'openai-effect-prompt.txt'), prompt, 'utf8');
    if (promptOnly) {
      manifest.summary.effectImage = { status: 'prompt_only', promptFile: 'openai-effect-prompt.txt' };
    } else {
      const image = await generateImage({
        prompt,
        size: process.env.OPENAI_EFFECT_SIZE || '1600x1024',
        outputFile: path.join(outputDir, `effect-openai.${outputExtension(process.env.OPENAI_IMAGE_OUTPUT_FORMAT || 'png')}`),
        purpose: 'effect-render',
        sourceImagePath
      });
      manifest.output.effectImage = image.fileName;
      manifest.output.renderImage = image.fileName;
      manifest.output.birdseyeImage = image.fileName;
      manifest.summary.effectImage = image;
    }
    manifest.lineage.birdseye = {
      source: sourceImagePath ? path.basename(sourceImagePath) : '',
      referenceType: sourceImagePath ? 'floor-plan' : 'text-only'
    };
    fs.writeFileSync(path.join(outputDir, 'openai-image-render-result.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  if (panoramaPath || directFloorplan) {
    const panorama = readJson(panoramaPath, {});
    const scene = readJson(scenePath || path.join(outputDir, '3d-config.json'), {});
    const generatedBirdseyePath = findGeneratedBirdseyeImage(outputDir);
    const panoramaReferencePath = generatedBirdseyePath || sourceImagePath;
    const plannedBirdseyeFile = `effect-openai.${outputExtension(process.env.OPENAI_IMAGE_OUTPUT_FORMAT || 'png')}`;
    const plannedBirdseyeReference = directFloorplan && promptOnly;
    const referenceKind = generatedBirdseyePath
      ? 'generated-birdseye'
      : (plannedBirdseyeReference ? 'generated-birdseye-planned' : 'floor-plan');
    const prompt = buildPanoramaPrompt(panorama, scene, job, referenceKind);
    fs.writeFileSync(path.join(outputDir, 'openai-panorama-prompt.txt'), prompt, 'utf8');
    if (promptOnly) {
      manifest.summary.panoramaImage = { status: 'prompt_only', promptFile: 'openai-panorama-prompt.txt' };
    } else {
      const image = await generateImage({
        prompt,
        size: process.env.OPENAI_PANORAMA_SIZE || '2048x1024',
        outputFile: path.join(outputDir, `panorama-openai.${outputExtension(process.env.OPENAI_IMAGE_OUTPUT_FORMAT || 'png')}`),
        purpose: 'vr-panorama',
        sourceImagePath: panoramaReferencePath
      });
      manifest.output.panoramaImage = image.fileName;
      manifest.output.equirectangularImage = image.fileName;
      manifest.summary.panoramaImage = image;
    }
    manifest.lineage.panorama = {
      source: generatedBirdseyePath
        ? path.basename(generatedBirdseyePath)
        : (plannedBirdseyeReference ? plannedBirdseyeFile : (panoramaReferencePath ? path.basename(panoramaReferencePath) : '')),
      referenceType: panoramaReferencePath || plannedBirdseyeReference ? referenceKind : 'text-only',
      derivedFromBirdseye: Boolean(generatedBirdseyePath || plannedBirdseyeReference)
    };
  }

  fs.writeFileSync(path.join(outputDir, 'openai-image-render-result.json'), JSON.stringify(manifest, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
