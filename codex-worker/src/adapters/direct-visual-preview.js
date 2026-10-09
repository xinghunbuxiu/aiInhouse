const fs = require('fs');
const path = require('path');
const { executeCodexCli } = require('./codex-cli-adapter');
const { normalizeOutput } = require('../generators/external-renderer');

async function executeDirectVisualPreview(job, outputDir, options = {}) {
  const jobFile = options.jobFile ? path.resolve(options.jobFile) : path.join(outputDir, 'job-context.json');
  fs.writeFileSync(path.join(outputDir, 'job-context.json'), JSON.stringify(job, null, 2), 'utf8');

  const result = await executeCodexCli(job, jobFile, outputDir, {
    directVisualPreview: true
  });
  const output = normalizeOutput(result?.output || {}, outputDir);
  const effectImage = output.effectImage || output.renderImage;
  const panoramaImage = output.panoramaImage || output.equirectangularImage;
  const missing = [effectImage, panoramaImage]
    .filter((file) => !file || !fs.existsSync(path.resolve(outputDir, file)));
  if (missing.length) {
    throw new Error('Codex CLI 已完成分析，但没有生成可验证的 Blender 俯瞰图和全景图。');
  }

  return {
    output: {
      ...output,
      effectImage,
      panoramaImage,
      equirectangularImage: panoramaImage,
      renderManifest: 'codex-result.json'
    },
    summary: {
      ...(result?.summary || {}),
      mode: 'direct_visual_preview',
      provider: 'codex-cli+blender',
      recognitionSkipped: true,
      structureValidated: true,
      hasBirdseyeRender: Boolean(output.birdseyeImage || output.effectImage || output.renderImage),
      hasPanoramaRaster: Boolean(output.panoramaImage || output.equirectangularImage),
      note: 'Codex CLI 直接读取原始平面图并建立场景，再由本机 Blender 生成俯瞰图和 2:1 全景图；未运行模块化识别流水线。'
    }
  };
}

module.exports = {
  executeDirectVisualPreview
};
