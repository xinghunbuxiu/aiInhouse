import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
  return stat.size;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function collectTmpKeepDirs(keepLatest) {
  if (!keepLatest) {
    return new Set();
  }

  const tmpDir = path.join(root, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    return new Set();
  }

  const candidates = fs.readdirSync(tmpDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /closed-loop-output-v\d+$|regression-output-v\d+$/.test(name))
    .sort((a, b) => {
      const versionA = Number(a.match(/v(\d+)$/)?.[1] || 0);
      const versionB = Number(b.match(/v(\d+)$/)?.[1] || 0);
      return versionB - versionA;
    });

  return new Set(candidates.slice(0, 1));
}

function cleanDirectory(dirPath, { keep = new Set() } = {}) {
  if (!fs.existsSync(dirPath)) {
    return { removed: 0, bytes: 0, kept: [] };
  }

  let bytes = 0;
  let removed = 0;
  const kept = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (keep.has(entry.name)) {
      kept.push(entry.name);
      continue;
    }

    const stat = fs.statSync(entryPath);
    bytes += stat.isDirectory() ? dirSize(entryPath) : stat.size;
    removePath(entryPath);
    removed += 1;
  }

  return { removed, bytes, kept };
}

function dirSize(dirPath) {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    const stat = fs.statSync(entryPath);
    total += stat.isDirectory() ? dirSize(entryPath) : stat.size;
  }
  return total;
}

function main() {
  const keepLatest = !hasFlag('--all-tmp');
  const includeTauriTarget = hasFlag('--with-tauri-target');
  const keepDirs = collectTmpKeepDirs(keepLatest);
  const keepArg = getArg('--keep-tmp');
  if (keepArg) {
    keepDirs.add(keepArg);
  }

  let totalBytes = 0;
  const actions = [];

  const tmpResult = cleanDirectory(path.join(root, 'tmp'), { keep: keepDirs });
  totalBytes += tmpResult.bytes;
  actions.push(`tmp/: 删除 ${tmpResult.removed} 项目${tmpResult.kept.length ? `，保留 ${tmpResult.kept.join(', ')}` : ''}`);

  for (const relativePath of [
    'codex-worker/test-output',
    'codex-worker/verify-output',
    'node_modules/.vite',
    'node_modules/.cache',
    '.vite'
  ]) {
    const target = path.join(root, relativePath);
    if (!fs.existsSync(target)) {
      continue;
    }
    const bytes = dirSize(target);
    removePath(target);
    totalBytes += bytes;
    actions.push(`${relativePath}: 已清理 (${formatBytes(bytes)})`);
  }

  if (includeTauriTarget) {
    const target = path.join(root, 'src-tauri/target');
    if (fs.existsSync(target)) {
      const bytes = dirSize(target);
      removePath(target);
      totalBytes += bytes;
      actions.push(`src-tauri/target: 已清理 (${formatBytes(bytes)})`);
    }
  }

  const summary = {
    ok: true,
    freedBytes: totalBytes,
    freed: formatBytes(totalBytes),
    actions
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
