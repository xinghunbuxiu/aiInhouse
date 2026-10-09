const path = require('path');
const { workerMode } = require('./config');
const { executeMockJob } = require('./adapters/mock-adapter');
const { executeExternalCommand } = require('./adapters/external-command');
const { executeCodexCli } = require('./adapters/codex-cli-adapter');
const { prepareRecognitionDraft } = require('./recognizers/local-draft');
const { executeDirectVisualPreview } = require('./adapters/direct-visual-preview');

async function executeJob(job, outputDir, options = {}) {
  const resolvedJobFile = options.jobFile ? path.resolve(options.jobFile) : '';
  if (job?.job?.job_type === 'direct_visual_preview') {
    return executeDirectVisualPreview(job, outputDir, {
      jobFile: resolvedJobFile
    });
  }
  const preparedJob = await prepareRecognitionDraft(job, outputDir, {
    jobFile: resolvedJobFile
  });

  if (workerMode === 'codex_cli') {
    return executeCodexCli(preparedJob, resolvedJobFile, outputDir);
  }

  if (workerMode === 'external_command') {
    return executeExternalCommand(resolvedJobFile, outputDir);
  }

  return executeMockJob(preparedJob, outputDir);
}

module.exports = {
  executeJob
};
