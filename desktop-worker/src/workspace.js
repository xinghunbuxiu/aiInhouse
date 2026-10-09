const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeName(value) {
  return String(value || 'job').replace(/[^\w.-]/g, '_');
}

function prepareWorkspace(jobPackage) {
  const jobNo = sanitizeName(jobPackage?.job?.job_no || `job-${Date.now()}`);
  const jobDir = path.join(config.workspaceDir, 'jobs', jobNo);
  const inputDir = path.join(jobDir, 'input');
  const outputDir = path.join(jobDir, 'output');
  const logDir = path.join(jobDir, 'logs');

  ensureDir(inputDir);
  ensureDir(outputDir);
  ensureDir(logDir);

  const paths = {
    jobDir,
    inputDir,
    outputDir,
    logDir,
    jobFile: path.join(jobDir, 'job.json'),
    sourceFile: path.join(inputDir, 'source-plan'),
    logFile: path.join(logDir, 'worker.log')
  };

  fs.writeFileSync(paths.jobFile, JSON.stringify(jobPackage, null, 2), 'utf8');

  return paths;
}

function appendWorkspaceLog(paths, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(paths.logFile, line, 'utf8');
}

module.exports = {
  ensureDir,
  prepareWorkspace,
  appendWorkspaceLog
};
