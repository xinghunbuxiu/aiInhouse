import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} 执行失败`);
  }

  return result.stdout.trim();
}

function getFileSize(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return 0;
  }

  return fs.statSync(filePath).size;
}

function getImageMeta(filePath) {
  const output = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
  const widthMatch = output.match(/pixelWidth:\s+(\d+)/);
  const heightMatch = output.match(/pixelHeight:\s+(\d+)/);

  return {
    width: widthMatch ? Number(widthMatch[1]) : 0,
    height: heightMatch ? Number(heightMatch[1]) : 0
  };
}

function buildPreprocessedImage(sourcePath, outputDir) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      preprocessedImagePath: '',
      operations: ['missing-source']
    };
  }

  const targetFile = path.join(outputDir, 'recognition-input.jpg');
  const beforeSize = getFileSize(sourcePath);
  const metaBefore = getImageMeta(sourcePath);

  run('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '60',
    '-Z', '960',
    sourcePath,
    '--out', targetFile
  ]);

  const afterSize = getFileSize(targetFile);
  const metaAfter = getImageMeta(targetFile);

  return {
    preprocessedImagePath: targetFile,
    operations: ['resize-max-960', 'convert-jpeg', 'jpeg-quality-60'],
    beforeSizeBytes: beforeSize,
    afterSizeBytes: afterSize,
    beforeWidth: metaBefore.width,
    beforeHeight: metaBefore.height,
    afterWidth: metaAfter.width,
    afterHeight: metaAfter.height
  };
}

async function main() {
  const jobFile = getArgValue('--job');
  const outputDir = getArgValue('--output');

  if (!jobFile || !outputDir) {
    throw new Error('用法: node scripts/mock-recognition-preprocess.mjs --job <job.json> --output <dir>');
  }

  ensureDir(path.resolve(outputDir));

  const job = JSON.parse(fs.readFileSync(path.resolve(jobFile), 'utf8'));
  const sourcePath = job?.assets?.local_source_file || '';
  const processed = buildPreprocessedImage(sourcePath, path.resolve(outputDir));
  const payload = {
    status: processed.preprocessedImagePath ? 'completed' : 'skipped',
    message: processed.preprocessedImagePath
      ? '轻量预处理已完成，已缩图并转换为 JPEG，适合直接发给 AI 识别。'
      : '未找到源图，跳过预处理。',
    sourcePath,
    preprocessedImagePath: processed.preprocessedImagePath,
    operations: processed.operations,
    beforeSizeBytes: processed.beforeSizeBytes || 0,
    afterSizeBytes: processed.afterSizeBytes || 0,
    beforeWidth: processed.beforeWidth || 0,
    beforeHeight: processed.beforeHeight || 0,
    afterWidth: processed.afterWidth || 0,
    afterHeight: processed.afterHeight || 0,
    generatedAt: new Date().toISOString()
  };

  const targetFile = path.join(path.resolve(outputDir), 'recognition-preprocess.json');
  fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
