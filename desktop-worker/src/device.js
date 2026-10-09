const os = require('os');
const { apiJson } = require('./api');
const config = require('./config');

async function registerDevice(token) {
  return apiJson('/ai-devices/register', {
    method: 'POST',
    token,
    body: {
      device_code: config.deviceCode,
      device_name: config.deviceName,
      device_type: config.deviceType,
      processor_type: config.processorType,
      os_name: os.platform(),
      os_version: os.release(),
      app_version: config.appVersion,
      capabilities_json: {
        cpu_count: os.cpus()?.length || 0,
        total_memory_gb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
        codex_command: config.codexCommand
      }
    }
  });
}

async function heartbeat(token, status = 'online') {
  return apiJson('/ai-devices/heartbeat', {
    method: 'POST',
    token,
    body: {
      device_code: config.deviceCode,
      status
    }
  });
}

module.exports = {
  registerDevice,
  heartbeat
};
