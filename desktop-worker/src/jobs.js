const { apiJson } = require('./api');
const config = require('./config');

async function claimJob(token) {
  const response = await apiJson('/ai-jobs/claim', {
    method: 'POST',
    token,
    body: {
      device_code: config.deviceCode
    }
  });

  return response?.data || null;
}

async function startJob(token, jobId) {
  return apiJson(`/ai-jobs/${jobId}/start`, {
    method: 'POST',
    token
  });
}

async function appendJobLog(token, jobId, payload) {
  return apiJson(`/ai-jobs/${jobId}/logs`, {
    method: 'POST',
    token,
    body: payload
  });
}

async function submitJobResult(token, jobId, resultPayload) {
  return apiJson(`/ai-jobs/${jobId}/result`, {
    method: 'POST',
    token,
    body: {
      result_payload: resultPayload
    }
  });
}

async function submitJobFailure(token, jobId, errorMessage) {
  return apiJson(`/ai-jobs/${jobId}/fail`, {
    method: 'POST',
    token,
    body: {
      error_message: errorMessage
    }
  });
}

module.exports = {
  claimJob,
  startJob,
  appendJobLog,
  submitJobResult,
  submitJobFailure
};
