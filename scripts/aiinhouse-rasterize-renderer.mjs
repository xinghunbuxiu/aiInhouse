import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function commandExists(command) {
  const result = spawnSync('which', [command], {
    encoding: 'utf8'
  });
  return result.status === 0 && result.stdout.trim();
}

function convertSvg({ input, output, width, height }) {
  if (!fs.existsSync(input)) {
    throw new Error(`SVG 源文件不存在: ${input}`);
  }

  if (commandExists('rsvg-convert')) {
    const result = spawnSync('rsvg-convert', ['-w', String(width), '-h', String(height), '-f', 'png', '-o', output, input], {
      encoding: 'utf8'
    });
    if (result.status === 0 && fs.existsSync(output)) {
      return;
    }
    throw new Error(result.stderr || result.stdout || `rsvg-convert 转换失败: ${input}`);
  }

  if (commandExists('qlmanage')) {
    const tempDir = path.join(path.dirname(output), '.ql-rasterize');
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const result = spawnSync('qlmanage', ['-t', '-s', String(Math.max(width, height)), '-o', tempDir, input], {
      encoding: 'utf8'
    });
    const generated = fs.readdirSync(tempDir).find((file) => file.endsWith('.png'));
    if (result.status === 0 && generated) {
      fs.copyFileSync(path.join(tempDir, generated), output);
      fs.rmSync(tempDir, { recursive: true, force: true });
      return;
    }
    throw new Error(result.stderr || result.stdout || `qlmanage 转换失败: ${input}`);
  }

  throw new Error('缺少 SVG 转 PNG 工具，请安装 rsvg-convert 或配置真实渲染器。');
}

function main() {
  const outputDir = path.resolve(getArg('--output') || process.cwd());
  const scenePath = getArg('--scene');
  const panoramaPath = getArg('--panorama');
  ensureDir(outputDir);
  const resultPath = path.join(outputDir, 'rasterize-render-result.json');
  const previous = readJson(resultPath, {});

  const result = {
    output: {
      ...(previous.output || {})
    },
    summary: {
      ...(previous.summary || {}),
      provider: 'aiinhouse-rasterize-renderer',
      note: '由本地 SVG 预览转换为 PNG；适合链路验收，不等同照片级渲染。'
    }
  };

  if (scenePath) {
    const effectSource = path.join(outputDir, 'effect-render.svg');
    const birdseyeSource = fs.existsSync(path.join(outputDir, 'birdseye-render.svg'))
      ? path.join(outputDir, 'birdseye-render.svg')
      : effectSource;
    const effectTarget = path.join(outputDir, 'effect-raster.png');
    const birdseyeTarget = path.join(outputDir, 'birdseye-raster.png');
    convertSvg({ input: effectSource, output: effectTarget, width: 1600, height: 1000 });
    convertSvg({ input: birdseyeSource, output: birdseyeTarget, width: 1600, height: 1000 });
    const interiorSvgs = fs.readdirSync(outputDir).filter((file) => /^interior-.+\.svg$/i.test(file)).sort();
    const interiorImages = interiorSvgs.map((fileName) => {
      const pngName = fileName.replace(/\.svg$/i, '-raster.png');
      convertSvg({
        input: path.join(outputDir, fileName),
        output: path.join(outputDir, pngName),
        width: 1600,
        height: 1000
      });
      return pngName;
    });
    result.output.effectImage = 'effect-raster.png';
    result.output.renderImage = 'effect-raster.png';
    result.output.birdseyeImage = 'birdseye-raster.png';
    result.output.interiorImages = interiorImages;
    result.summary.effectImage = {
      source: 'effect-render.svg',
      output: 'effect-raster.png',
      width: 1600,
      height: 1000
    };
    result.summary.birdseyeImage = {
      source: path.basename(birdseyeSource),
      output: 'birdseye-raster.png',
      width: 1600,
      height: 1000
    };
    result.summary.interiorImages = interiorImages.map((fileName) => ({
      output: fileName,
      width: 1600,
      height: 1000
    }));
  }

  if (panoramaPath) {
    const source = path.join(outputDir, 'panorama-equirectangular.svg');
    const target = path.join(outputDir, 'panorama-raster.png');
    convertSvg({ input: source, output: target, width: 2048, height: 1024 });
    result.output.panoramaImage = 'panorama-raster.png';
    result.output.equirectangularImage = 'panorama-raster.png';
    result.summary.panoramaImage = {
      source: 'panorama-equirectangular.svg',
      output: 'panorama-raster.png',
      width: 2048,
      height: 1024
    };
  }

  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
