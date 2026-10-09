const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pickPanoramaImage(panoramaConfig = {}, outputDir = '') {
  const candidates = [
    ...(panoramaConfig.deliverables?.panoramaImages || []),
    panoramaConfig.deliverables?.primaryPanoramaImage
  ].filter(Boolean);

  for (const fileName of candidates) {
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(outputDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return path.basename(fileName);
    }
  }

  return '';
}

function buildHotspots(panoramaConfig = {}) {
  return (panoramaConfig.hotspots || []).map((hotspot, index) => ({
    pitch: Number(hotspot.position?.pitch ?? hotspot.pitch ?? 0),
    yaw: Number(hotspot.position?.yaw ?? hotspot.yaw ?? index * 45),
    type: hotspot.type === 'navigation' ? 'scene' : 'info',
    text: hotspot.text || hotspot.id || `热点 ${index + 1}`,
    sceneId: hotspot.target || hotspot.sceneId || ''
  }));
}

function generateVrTourFiles(outputDir, panoramaConfig = {}) {
  const panoramaImage = pickPanoramaImage(panoramaConfig, outputDir);
  if (!panoramaImage) {
    return [];
  }

  const tourConfig = {
    version: '0.1.0',
    description: panoramaConfig.description || 'AIInHouse 720 全景 VR 漫游',
    defaultScene: panoramaConfig.cameraPositions?.[0]?.id || 'scene-1',
    panorama: panoramaImage,
    hotSpots: buildHotspots(panoramaConfig),
    scenes: (panoramaConfig.cameraPositions || []).map((camera, index) => ({
      id: camera.id || `scene-${index + 1}`,
      title: camera.name || `视角 ${index + 1}`,
      panorama: panoramaImage,
      pitch: 0,
      yaw: 0,
      hfov: 105
    }))
  };

  fs.writeFileSync(path.join(outputDir, 'tour-config.json'), JSON.stringify(tourConfig, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'tour.js'), `fetch('./tour-config.json')
  .then(function(response){ return response.json(); })
  .then(function(config){
    if (!window.pannellum) return;
    var fallback = document.querySelector('.tour-fallback');
    if (fallback) fallback.style.display = 'none';
    window.pannellum.viewer('pano', {
      type: 'equirectangular',
      panorama: config.panorama,
      autoLoad: true,
      autoRotate: -1,
      hfov: 105,
      showControls: true,
      compass: true,
      hotSpots: config.hotSpots || []
    });
  });`, 'utf8');

  const title = panoramaConfig.cameraPositions?.[0]?.name || '全屋 VR 漫游';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} - AIInHouse VR</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css" />
  <style>
    *{box-sizing:border-box} html,body{margin:0;height:100%;background:#020617;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .tour{position:relative;height:100%;overflow:hidden;background:#020617}
    .tour-viewer{position:absolute;inset:0}
    .tour-fallback{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .tour-top{position:absolute;z-index:2;inset:0 0 auto 0;padding:24px;background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(0,0,0,0));pointer-events:none}
    .tour-top h1{margin:8px 0 0;font-size:28px}
    .tour-top p{margin:8px 0 0;color:#cbd5e1}
  </style>
</head>
<body>
  <div class="tour">
    <div id="pano" class="tour-viewer"></div>
    <img class="tour-fallback" src="./${escapeHtml(panoramaImage)}" alt="720 全景 VR" />
    <div class="tour-top">
      <div>AIInHouse VR Tour</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(panoramaConfig.description || '2:1 equirectangular 720 全景漫游')}</p>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js"></script>
  <script src="./tour.js"></script>
</body>
</html>`;

  fs.writeFileSync(path.join(outputDir, 'vr-tour.html'), html, 'utf8');
  return ['vr-tour.html', 'tour-config.json', 'tour.js'];
}

module.exports = {
  generateVrTourFiles,
  pickPanoramaImage
};
