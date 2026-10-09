import fs from 'node:fs';
import path from 'node:path';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function assetColor(asset, fallback) {
  return asset?.properties?.color || asset?.properties?.secondaryColor || fallback;
}

function buildRendererScene(assemblyPlan, sceneConfig) {
  const roomPlans = assemblyPlan.roomPlans || [];
  const rendererAssets = assemblyPlan.rendererAssets || [];

  return {
    version: '0.1.0',
    source: 'aiinhouse-local-renderer',
    style: assemblyPlan.style || sceneConfig.style || 'modern-natural',
    rendererContract: assemblyPlan.rendererContract || {},
    assets: rendererAssets,
    rooms: roomPlans.map((roomPlan, index) => {
      const assetByAction = Object.fromEntries(
        (roomPlan.steps || [])
          .filter((step) => step.asset)
          .map((step) => [step.action, step.asset])
      );

      return {
        id: roomPlan.roomId,
        name: roomPlan.roomName,
        type: roomPlan.roomType,
        area: roomPlan.area,
        position: {
          x: (index % 3) * 5,
          y: 0,
          z: Math.floor(index / 3) * 4
        },
        finishes: {
          wall: assetByAction.apply_wall_finish || null,
          floor: assetByAction.apply_floor_finish || null,
          ceiling: assetByAction.apply_ceiling_finish || null
        },
        lighting: assetByAction.place_lighting || null,
        furniture: (roomPlan.steps || [])
          .filter((step) => ['place_furniture', 'place_cabinet'].includes(step.action) && step.asset)
          .map((step) => step.asset),
        steps: roomPlan.steps || []
      };
    }),
    cameras: roomPlans.slice(0, 4).map((roomPlan, index) => ({
      id: `render-camera-${index + 1}`,
      name: `${roomPlan.roomName} 效果图机位`,
      roomId: roomPlan.roomId,
      position: { x: 4 + index * 2, y: 1.65, z: 6 + index },
      target: { x: index * 2, y: 1.2, z: 0 }
    }))
  };
}

function buildEffectSvg(rendererScene) {
  const width = 1600;
  const height = 1000;
  const rooms = rendererScene.rooms || [];
  const heroRoom = rooms[0] || {};
  const wall = heroRoom.finishes?.wall;
  const floor = heroRoom.finishes?.floor;
  const ceiling = heroRoom.finishes?.ceiling;
  const furniture = heroRoom.furniture?.[0];
  const light = heroRoom.lighting;
  const wallColor = assetColor(wall, '#f1ece5');
  const floorColor = assetColor(floor, '#c8a676');
  const ceilingColor = assetColor(ceiling, '#faf9f7');
  const furnitureColor = assetColor(furniture, '#2f5d50');
  const lightColor = assetColor(light, '#fff4df');

  const roomTabs = rooms.slice(1, 6).map((room, index) => {
    const x = 1070 + (index % 2) * 170;
    const y = 190 + Math.floor(index / 2) * 74;
    return `<g>
      <rect x="${x}" y="${y}" width="145" height="50" rx="25" fill="#23263a" opacity="0.92"/>
      <text x="${x + 72.5}" y="${y + 31}" text-anchor="middle" font-size="18" font-weight="800" fill="#fff">${escapeXml(room.name)}</text>
    </g>`;
  }).join('\n');

  const stepLabels = (heroRoom.steps || []).slice(1, 6).map((step, index) => {
    const x = 90 + index * 210;
    return `<g>
      <circle cx="${x}" cy="910" r="16" fill="${index === 0 ? '#22c55e' : '#38bdf8'}"/>
      <text x="${x + 26}" y="916" font-size="17" font-weight="700" fill="#e5e7eb">${escapeXml(step.name)}</text>
    </g>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="wall" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.65" stop-color="${wallColor}"/>
      <stop offset="1" stop-color="#d6d3d1"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${floorColor}"/>
      <stop offset="1" stop-color="#604225"/>
    </linearGradient>
    <pattern id="planks" width="72" height="72" patternUnits="userSpaceOnUse" patternTransform="rotate(36)">
      <path d="M 0 0 L 0 72" stroke="#fff7ed" stroke-width="2" opacity="0.2"/>
    </pattern>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#020617" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="#030712"/>
  <path d="M 0 0 H 1600 V 660 L 1120 548 L 790 610 L 410 548 L 0 680 Z" fill="url(#wall)"/>
  <path d="M 0 680 L 410 548 L 790 610 L 1120 548 L 1600 660 V 1000 H 0 Z" fill="url(#floor)"/>
  <rect y="680" width="1600" height="320" fill="url(#planks)" opacity="0.7"/>
  <path d="M 0 0 H 1600 V 126 C 1220 76 442 78 0 132 Z" fill="${ceilingColor}" opacity="0.92"/>

  <g filter="url(#shadow)">
    <rect x="126" y="152" width="430" height="320" rx="22" fill="#bae6fd" stroke="#ffffff" stroke-width="12"/>
    <path d="M 126 386 C 230 322 354 318 556 408 V 472 H 126 Z" fill="#0f766e" opacity="0.52"/>
    <circle cx="486" cy="214" r="48" fill="#fde68a"/>
    <line x1="342" y1="152" x2="342" y2="472" stroke="#ffffff" stroke-width="9"/>
    <line x1="126" y1="312" x2="556" y2="312" stroke="#ffffff" stroke-width="9"/>
  </g>

  <g filter="url(#shadow)">
    <path d="M 236 710 C 340 634 600 634 734 714 L 778 860 C 614 930 356 922 188 858 Z" fill="#c97342"/>
    <rect x="286" y="574" width="392" height="132" rx="54" fill="${furnitureColor}"/>
    <path d="M 286 708 C 392 668 568 668 694 710 L 708 790 C 560 840 398 838 252 790 Z" fill="#f8fafc" opacity="0.9"/>
    <circle cx="336" cy="858" r="42" fill="#0f172a"/>
    <circle cx="694" cy="858" r="42" fill="#0f172a"/>
  </g>

  <g filter="url(#shadow)">
    <path d="M 924 602 L 1348 552 L 1450 728 L 1016 798 Z" fill="#ffffff"/>
    <path d="M 978 642 L 1312 604 L 1368 700 L 1040 748 Z" fill="#f4efe8"/>
    <rect x="1008" y="484" width="312" height="102" rx="20" fill="#1f2937"/>
    <rect x="1048" y="508" width="86" height="54" rx="9" fill="#38bdf8"/>
    <rect x="1158" y="508" width="86" height="54" rx="9" fill="#38bdf8"/>
  </g>

  <g filter="url(#shadow)">
    <rect x="720" y="166" width="240" height="104" rx="52" fill="#ffffff"/>
    <circle cx="840" cy="218" r="34" fill="${lightColor}"/>
  </g>

  <g>
    <rect x="84" y="70" width="650" height="132" rx="34" fill="rgba(15,23,42,0.72)" stroke="rgba(255,255,255,0.24)"/>
    <text x="124" y="126" font-size="34" font-weight="900" fill="#ffffff">${escapeXml(heroRoom.name || '装修效果图')}</text>
    <text x="124" y="166" font-size="19" fill="#cbd5e1">${escapeXml(heroRoom.area || 0)} m² · 素材库装配 · ${escapeXml(rendererScene.style)}</text>
    ${roomTabs}
  </g>
  <g>${stepLabels}</g>
</svg>`;
}

function buildSceneViewerHtml(rendererScene) {
  const sceneJson = JSON.stringify(rendererScene).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>AIInHouse Renderer Scene</title>
  <style>
    body{margin:0;background:#020617;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #app{min-height:100vh;display:grid;grid-template-columns:320px 1fr}
    aside{padding:24px;background:#0f172a;border-right:1px solid rgba(255,255,255,.12);overflow:auto}
    main{position:relative;overflow:hidden;background:linear-gradient(135deg,#111827,#334155 50%,#8b6b3f)}
    .room{border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:14px;margin:12px 0;background:rgba(255,255,255,.08)}
    .stage{position:absolute;inset:8%;border-radius:28px;background:rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.3)}
    .label{position:absolute;border-radius:999px;background:rgba(15,23,42,.78);padding:10px 16px;font-weight:700}
  </style>
</head>
<body>
  <div id="app">
    <aside><h1>装配场景</h1><p>由 scene-assembly-plan.json 生成</p><div id="rooms"></div></aside>
    <main><div class="stage" id="stage"></div></main>
  </div>
  <script>
    const scene = ${sceneJson};
    document.getElementById('rooms').innerHTML = scene.rooms.map(room => '<div class="room"><b>'+room.name+'</b><br>'+room.steps.map(step => step.name).join(' · ')+'</div>').join('');
    document.getElementById('stage').innerHTML = scene.rooms.map((room,index)=>'<div class="label" style="left:'+(8+(index%3)*28)+'%;top:'+(16+Math.floor(index/3)*28)+'%">'+room.name+'</div>').join('');
  </script>
</body>
</html>`;
}

function main() {
  const outputDir = path.resolve(getArg('--output') || process.cwd());
  const scenePath = getArg('--scene');
  const assemblyPath = getArg('--assembly-plan');
  fs.mkdirSync(outputDir, { recursive: true });

  const sceneConfig = readJson(scenePath, {});
  const assemblyPlan = readJson(assemblyPath, {});
  const rendererScene = buildRendererScene(assemblyPlan, sceneConfig);

  fs.writeFileSync(path.join(outputDir, 'renderer-scene.json'), JSON.stringify(rendererScene, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'effect-assembly.svg'), buildEffectSvg(rendererScene), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'scene-viewer.html'), buildSceneViewerHtml(rendererScene), 'utf8');

  const result = {
    output: {
      effectImage: 'effect-assembly.svg',
      modelFile: 'renderer-scene.json',
      sceneViewer: 'scene-viewer.html'
    },
    summary: {
      provider: 'aiinhouse-local-renderer',
      roomCount: rendererScene.rooms.length,
      assetCount: rendererScene.assets.length
    }
  };
  fs.writeFileSync(path.join(outputDir, 'render-result.json'), JSON.stringify(result, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
