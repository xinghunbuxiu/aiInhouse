const path = require('path');
const fs = require('fs');

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

const backendUrl = (process.env.AIH_BACKEND_URL || 'http://127.0.0.1:3002/api').replace(/\/+$/, '');
const backendOrigin = backendUrl.replace(/\/api$/, '');

module.exports = {
  projectRoot,
  backendUrl,
  backendOrigin,
  deviceCode: process.env.AIH_DEVICE_CODE || 'DESKTOP-LOCAL-001',
  deviceName: process.env.AIH_DEVICE_NAME || '本地 Codex 工作站',
  deviceType: process.env.AIH_DEVICE_TYPE || 'desktop',
  processorType: process.env.AIH_PROCESSOR_TYPE || 'codex',
  appVersion: process.env.AIH_APP_VERSION || '0.1.0',
  username: process.env.AIH_USERNAME || '',
  password: process.env.AIH_PASSWORD || '',
  token: process.env.AIH_TOKEN || '',
  authMode: process.env.AIH_AUTH_MODE || 'auto',
  codexCommand: process.env.AIH_CODEX_COMMAND || 'node ../codex-worker/src/index.js',
  codexTimeoutMs: Number(process.env.AIH_CODEX_TIMEOUT_MS || 15 * 60 * 1000),
  apiTimeoutMs: Number(process.env.AIH_API_TIMEOUT_MS || 8000),
  pollIntervalMs: Number(process.env.AIH_POLL_INTERVAL_MS || 8000),
  heartbeatIntervalMs: Number(process.env.AIH_HEARTBEAT_INTERVAL_MS || 30000),
  workspaceDir: path.resolve(projectRoot, process.env.AIH_WORKSPACE_DIR || './workspace')
};
