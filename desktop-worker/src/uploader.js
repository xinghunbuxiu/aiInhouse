const fs = require('fs');
const path = require('path');
const { apiRequest } = require('./api');

function exists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

async function appendFile(formData, fieldName, filePath, fallbackName) {
  if (!exists(filePath)) {
    return;
  }

  const buffer = await fs.promises.readFile(filePath);
  const blob = new Blob([buffer]);
  formData.append(fieldName, blob, path.basename(filePath || fallbackName));
}

async function uploadArtifacts(token, jobId, output) {
  const form = new FormData();

  await appendFile(form, 'formal_plan_svg', output.formalPlanSvg, 'formal-plan.svg');
  await appendFile(form, 'cad_file', output.cadFile, 'formal-plan.dxf');
  await appendFile(form, 'formal_plan_json', output.formalPlanJson, 'formal-plan.json');
  await appendFile(form, 'recognition_diagnostics', output.recognitionDiagnostics, 'recognition-diagnostics.html');
  await appendFile(form, 'recognition_overlay', output.recognitionOverlay, 'recognition-overlay.svg');
  await appendFile(form, 'recognition_edges', output.recognitionEdges, 'vision-edges.png');
  await appendFile(form, 'recognition_binary', output.recognitionBinary, 'vision-binary.png');
  await appendFile(form, 'recognition_wall_bands', output.recognitionWallBands, 'vision-wall-bands.png');
  await appendFile(form, 'recognition_structural_walls', output.recognitionStructuralWalls, 'vision-structural-wall-vectors.png');
  await appendFile(form, 'recognition_balcony_candidates', output.recognitionBalconyCandidates, 'vision-balcony-candidates.png');
  await appendFile(form, 'recognition_room_interiors', output.recognitionRoomInteriors, 'vision-room-interiors.png');
  await appendFile(form, 'recognition_window_candidates', output.recognitionWindowCandidates, 'vision-window-candidates.png');
  await appendFile(form, 'recognition_door_candidates', output.recognitionDoorCandidates, 'vision-door-candidates.png');
  await appendFile(form, 'recognition_symbol_candidates', output.recognitionSymbolCandidates, 'vision-symbol-candidates.png');
  await appendFile(form, 'three_d_config', output.threeDConfig, '3d-config.json');
  await appendFile(form, 'panorama_config', output.panoramaConfig, 'panorama-config.json');
  await appendFile(form, 'delivery_manifest', output.deliveryManifest, 'delivery-manifest.json');
  await appendFile(form, 'delivery_approval', output.deliveryApproval, 'delivery-approval.json');
  await appendFile(form, 'review_file', output.reviewFile, 'review.md');
  await appendFile(form, 'preview_image', output.previewImage, 'preview.png');
  await appendFile(form, 'effect_image', output.effectImage, 'effect.png');
  await appendFile(form, 'birdseye_image', output.birdseyeImage, 'birdseye.png');
  for (const interiorImage of output.interiorImages || []) {
    await appendFile(form, 'interior_image', interiorImage, path.basename(interiorImage));
  }
  await appendFile(form, 'panorama_image', output.panoramaImage, 'panorama.png');

  const response = await apiRequest(`/ai-jobs/${jobId}/artifacts`, {
    method: 'POST',
    token,
    body: form
  });

  return response?.data || {};
}

module.exports = {
  uploadArtifacts
};
