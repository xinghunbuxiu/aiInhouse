const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const projectRoot = path.resolve(__dirname, '..');
parseEnvFile(path.join(projectRoot, '.env'));

const defaultAutoRendererCommand = `node ${path.resolve(projectRoot, '..', 'scripts', 'aiinhouse-auto-renderer.mjs')}`;
const defaultBlenderRendererCommand = `node ${path.resolve(projectRoot, '..', 'scripts', 'aiinhouse-blender-renderer.mjs')}`;
const renderProvider = process.env.CODEX_RENDER_PROVIDER || 'local_threejs';
const panoramaProvider = process.env.CODEX_PANORAMA_PROVIDER || 'pannellum';

module.exports = {
  projectRoot,
  workerMode: process.env.CODEX_WORKER_MODE === 'local_pipeline' ? 'mock' : (process.env.CODEX_WORKER_MODE || 'mock'),
  realCommand: process.env.CODEX_REAL_COMMAND || '',
  realArgsTemplate: process.env.CODEX_REAL_ARGS_TEMPLATE || '',
  resultFileName: process.env.CODEX_RESULT_FILENAME || 'codex-result.json',
  cliTimeoutMs: Number(process.env.CODEX_CLI_TIMEOUT_MS || 12 * 60 * 1000),
  recognitionMode: process.env.CODEX_RECOGNITION_MODE || 'ai_first',
  recognitionApiBaseUrl: process.env.CODEX_RECOGNITION_API_BASE_URL || '',
  recognitionApiKey: process.env.CODEX_RECOGNITION_API_KEY || '',
  recognitionApiModel: process.env.CODEX_RECOGNITION_API_MODEL || 'gpt-5.3-codex',
  recognitionAiCommand: process.env.CODEX_RECOGNITION_AI_COMMAND || '',
  recognitionAiArgsTemplate: process.env.CODEX_RECOGNITION_AI_ARGS_TEMPLATE || '',
  recognitionPreprocessCommand: process.env.CODEX_RECOGNITION_PREPROCESS_COMMAND || '',
  recognitionPreprocessTimeoutMs: Number(process.env.CODEX_RECOGNITION_PREPROCESS_TIMEOUT_MS || 90 * 1000),
  recognitionCommand: process.env.CODEX_RECOGNITION_COMMAND || '',
  recognitionTimeoutMs: Number(process.env.CODEX_RECOGNITION_TIMEOUT_MS || 90 * 1000),
  renderProvider,
  renderEndpoint: process.env.CODEX_RENDER_ENDPOINT || '',
  renderApiKey: process.env.CODEX_RENDER_API_KEY || '',
  renderCommand: process.env.CODEX_RENDER_COMMAND || (renderProvider === 'blender' ? defaultBlenderRendererCommand : defaultAutoRendererCommand),
  renderTimeoutMs: Number(process.env.CODEX_RENDER_TIMEOUT_MS || 10 * 60 * 1000),
  panoramaProvider,
  panoramaEndpoint: process.env.CODEX_PANORAMA_ENDPOINT || '',
  panoramaApiKey: process.env.CODEX_PANORAMA_API_KEY || '',
  panoramaCommand: process.env.CODEX_PANORAMA_COMMAND || (panoramaProvider === 'blender' ? defaultBlenderRendererCommand : defaultAutoRendererCommand),
  panoramaTimeoutMs: Number(process.env.CODEX_PANORAMA_TIMEOUT_MS || 10 * 60 * 1000)
};
