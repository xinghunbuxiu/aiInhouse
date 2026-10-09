import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerEntry = path.join(root, 'codex-worker', 'src', 'index.js');
const verifyRecognition = path.join(root, 'scripts', 'verify-commercial-recognition-target.mjs');

function parseArgs(argv) {
  const args = {
    jobs: [],
    outputRoot: path.join(root, 'tmp', 'commercial-pipeline-batch'),
    requireCommercialReady: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--job') {
      args.jobs.push(path.resolve(next || ''));
      i += 1;
    } else if (arg === '--output-root') {
      args.outputRoot = path.resolve(next || args.outputRoot);
      i += 1;
    } else if (arg === '--allow-human-review') {
      args.requireCommercialReady = false;
    }
  }

  return args;
}

function discoverJobs(explicitJobs) {
  if (explicitJobs.length) {
    return explicitJobs;
  }

  const candidates = [
    path.join(root, 'tmp', 'pipeline-commercial-v20', 'job.json'),
    path.join(root, 'tmp', 'pipeline-smoke-v19', 'job.json')
  ];

  const bundled = path.join(
    root,
    'src-tauri/target/debug/bundle/macos/AIInHouse.app/Contents/Resources/_up_/desktop-worker/workspace/jobs'
  );

  if (fs.existsSync(bundled)) {
    for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const jobFile = path.join(bundled, entry.name, 'job.json');
      if (fs.existsSync(jobFile)) {
        candidates.push(jobFile);
      }
    }
  }

  return [...new Set(candidates.filter((jobFile) => fs.existsSync(jobFile)))];
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function runPipeline(jobFile, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const result = spawnSync(process.execPath, [workerEntry, '--job', jobFile, '--output', outputDir], {
    cwd: path.join(root, 'codex-worker'),
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `pipeline failed: ${jobFile}`);
  }

  return readJson(path.join(outputDir, 'delivery-manifest.json'), {});
}

function verifyOutput(outputDir, requireCommercialReady) {
  const args = [verifyRecognition, '--output', outputDir];
  if (requireCommercialReady) {
    args.push('--require-commercial-ready');
  }

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `verify failed: ${outputDir}`);
  }

  return JSON.parse(result.stdout || '{}');
}

function summarizeManifest(manifest = {}) {
  const gates = manifest.gates || [];
  return {
    deliveryStatus: manifest.deliveryStatus || 'unknown',
    commercialReady: Boolean(manifest.commercialReady),
    recognitionScore: manifest.summary?.commercialReadiness?.score ?? manifest.gates?.find((gate) => gate.id === 'recognition-commercial-readiness')?.details?.score ?? null,
    passedGates: gates.filter((gate) => gate.passed).map((gate) => gate.id),
    failedGates: gates.filter((gate) => !gate.passed).map((gate) => gate.id),
    effectRaster: gates.find((gate) => gate.id === 'effect-raster')?.passed ?? false,
    birdseyeRaster: gates.find((gate) => gate.id === 'birdseye-raster')?.passed ?? false,
    interiorRaster: gates.find((gate) => gate.id === 'interior-raster')?.passed ?? false,
    panoramaRaster: gates.find((gate) => gate.id === 'panorama-raster')?.passed ?? false
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = discoverJobs(args.jobs);
  if (!jobs.length) {
    throw new Error('未找到可运行的 job.json，请通过 --job 指定。');
  }

  fs.mkdirSync(args.outputRoot, { recursive: true });
  const reports = [];

  for (const jobFile of jobs) {
    const job = readJson(jobFile, {});
    const jobNo = job?.job?.job_no || path.basename(path.dirname(jobFile));
    const outputDir = path.join(args.outputRoot, jobNo);
    const startedAt = Date.now();

    try {
      const manifest = runPipeline(jobFile, outputDir);
      const verification = verifyOutput(outputDir, args.requireCommercialReady);
      reports.push({
        ok: true,
        jobFile,
        outputDir,
        jobNo,
        durationMs: Date.now() - startedAt,
        ...summarizeManifest(manifest),
        roomCount: verification.rooms?.length || 0,
        openingCount: verification.openingCount || 0,
        attachedOpeningRatio: verification.attachedOpeningRatio || 0,
        readinessStatus: verification.readiness?.status || null
      });
    } catch (error) {
      reports.push({
        ok: false,
        jobFile,
        outputDir,
        jobNo,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
    }
  }

  const summary = {
    ok: reports.every((report) => report.ok),
    total: reports.length,
    passed: reports.filter((report) => report.ok).length,
    failed: reports.filter((report) => !report.ok).length,
    outputRoot: args.outputRoot,
    reports
  };

  const reportPath = path.join(args.outputRoot, 'batch-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (!summary.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
