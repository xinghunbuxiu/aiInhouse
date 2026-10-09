const path = require('path');
const fs = require('fs');
const { readJob } = require('./job-reader');
const { executeJob } = require('./worker');
const { workerMode } = require('./config');

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

async function main() {
  const jobFile = getArgValue('--job');
  const outputDir = getArgValue('--output');

  if (!jobFile || !outputDir) {
    throw new Error('用法: node src/index.js --job <job.json> --output <output-dir>');
  }

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const resolvedJobFile = path.resolve(jobFile);
  const job = readJob(resolvedJobFile);
  const result = await executeJob(job, resolvedOutputDir, {
    jobFile: resolvedJobFile,
    mode: workerMode
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
