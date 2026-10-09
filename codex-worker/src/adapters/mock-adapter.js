const { generateFormalPlan } = require('../generators/formal-plan');
const { generateThreeDConfig } = require('../generators/config-3d');
const { generatePanoramaConfig } = require('../generators/panorama');
const { generateReviewFiles } = require('../generators/review');
const { generateDeliveryManifest } = require('../generators/delivery-manifest');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function generateRecognitionDiagnostics(outputDir) {
  const script = path.resolve(__dirname, '..', '..', '..', 'scripts', 'generate-recognition-diagnostics.mjs');
  const result = spawnSync(process.execPath, [script, '--output', outputDir], {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    encoding: 'utf8'
  });

  return result.status === 0 && fs.existsSync(path.join(outputDir, 'recognition-diagnostics.html'));
}

async function executeMockJob(job, outputDir) {
  const jobType = job?.job?.job_type;
  const result = {
    output: {},
    summary: {}
  };

  let rooms = [];
  let formalResult = null;

  fs.writeFileSync(path.join(outputDir, 'job-context.json'), JSON.stringify(job, null, 2), 'utf8');

  if (jobType === 'parse_floor_plan' || jobType === 'full_pipeline' || !jobType) {
    formalResult = generateFormalPlan(job, outputDir);
    rooms = formalResult.rooms;
    result.output.formalPlanSvg = 'formal-plan.svg';
    result.output.cadFile = 'formal-plan.dxf';
    result.output.formalPlanJson = 'formal-plan.json';
  }

  if (!rooms.length && formalResult?.rooms) {
    rooms = formalResult.rooms;
  }

  if (jobType === 'generate_3d' || jobType === 'full_pipeline') {
    result.output.threeDConfig = '3d-config.json';
    result.output.sceneAssemblyPlan = 'scene-assembly-plan.json';
    await generateThreeDConfig(job, outputDir, rooms);
  }

  if (jobType === 'generate_panorama' || jobType === 'full_pipeline') {
    result.output.panoramaConfig = 'panorama-config.json';
    await generatePanoramaConfig(job, outputDir, rooms);
  }

  if (jobType === 'generate_3d' && !result.output.formalPlanJson) {
    const fallback = generateFormalPlan(job, outputDir);
    rooms = fallback.rooms;
    result.output.formalPlanSvg = 'formal-plan.svg';
    result.output.cadFile = 'formal-plan.dxf';
    result.output.formalPlanJson = 'formal-plan.json';
    result.output.sceneAssemblyPlan = 'scene-assembly-plan.json';
    await generateThreeDConfig(job, outputDir, rooms);
  }

  if (jobType === 'generate_panorama' && !result.output.formalPlanJson) {
    const fallback = generateFormalPlan(job, outputDir);
    rooms = fallback.rooms;
    result.output.formalPlanSvg = 'formal-plan.svg';
    result.output.cadFile = 'formal-plan.dxf';
    result.output.formalPlanJson = 'formal-plan.json';
    await generatePanoramaConfig(job, outputDir, rooms);
  }

  const summary = {
    commercialReadiness: job?.runtimeHints?.recognitionDraft?.quality?.commercialReadiness || null,
    threeDReadiness: job?.runtimeHints?.recognitionDraft?.quality?.threeDReadiness || null,
    roomCount: rooms.length,
    hasFormalPlan: Boolean(result.output.formalPlanSvg),
    hasCad: Boolean(result.output.cadFile),
    hasThreeD: Boolean(result.output.threeDConfig),
    hasPanorama: Boolean(result.output.panoramaConfig),
    recognitionGeometryConfidence: job?.runtimeHints?.recognitionDraft?.confidence?.geometry || 0,
    recognitionSemanticsConfidence: job?.runtimeHints?.recognitionDraft?.confidence?.semantics || 0,
    recognitionIssueCount: job?.runtimeHints?.recognitionDraft?.issues?.length || 0
  };

  const hasDiagnostics = generateRecognitionDiagnostics(outputDir);
  if (hasDiagnostics) {
    result.output.recognitionDiagnostics = 'recognition-diagnostics.html';
    result.output.recognitionOverlay = 'recognition-overlay.svg';
    result.output.recognitionEdges = 'vision-edges.png';
    result.output.recognitionBinary = 'vision-binary.png';
    result.output.recognitionWallBands = 'vision-wall-bands.png';
    result.output.recognitionStructuralWalls = 'vision-structural-wall-vectors.png';
    result.output.recognitionBalconyCandidates = 'vision-balcony-candidates.png';
    result.output.recognitionRoomInteriors = 'vision-room-interiors.png';
    result.output.recognitionWindowCandidates = 'vision-window-candidates.png';
    result.output.recognitionDoorCandidates = 'vision-door-candidates.png';
    result.output.recognitionSymbolCandidates = 'vision-symbol-candidates.png';
  }
  const manifest = generateDeliveryManifest(job, outputDir, result, summary, rooms);
  result.output.deliveryManifest = 'delivery-manifest.json';
  result.output.deliveryApproval = 'delivery-approval.json';
  summary.deliveryStatus = manifest.deliveryStatus;
  summary.commercialReady = manifest.commercialReady;
  summary.hasBirdseyeRender = Boolean(manifest.summary?.hasRasterBirdseye);
  summary.hasInteriorRender = Boolean(manifest.summary?.hasRasterInterior);
  summary.interiorRenderCount = (manifest.files?.effectImages || []).filter((file) => (
    /interior-.+-raster\.(png|jpg|jpeg|webp)$/i.test(String(file.file || ''))
  )).length;
  summary.hasPanoramaRaster = Boolean(manifest.summary?.hasRasterPanorama);
  summary.hasVrTour = fs.existsSync(path.join(outputDir, 'vr-tour.html'));
  summary.recognitionIssueCount = (job?.runtimeHints?.recognitionDraft?.issues || []).filter((issue) => (
    manifest.summary?.commercialReadiness?.status !== 'commercial_ready'
    || !String(issue).includes('稳定的结构化解析结果')
  )).length;

  const review = generateReviewFiles(job, outputDir, summary, rooms);
  result.output.reviewFile = 'review.md';
  result.output.previewImage = review.previewPath.split('/').pop();
  result.summary = summary;

  return result;
}

module.exports = {
  executeMockJob
};
