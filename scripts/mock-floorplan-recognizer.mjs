import fs from 'fs';
import path from 'path';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildDraft(job) {
  const parseResult = job?.floor_plan?.parse_result || {};
  const rooms = Array.isArray(parseResult.rooms) && parseResult.rooms.length
    ? parseResult.rooms.map((room, index) => ({
      id: room.id || `room-${index + 1}`,
      name: room.name || `空间 ${index + 1}`,
      type: room.type || 'space',
      area: toNumber(room.area, 10),
      x: toNumber(room.x, 40 + index * 100),
      y: toNumber(room.y, 40),
      width: toNumber(room.width, 90),
      height: toNumber(room.height, 70),
      confidence: 0.9
    }))
    : [
      { id: 'living', name: '客厅', type: 'living', area: 22, x: 40, y: 40, width: 150, height: 120, confidence: 0.76 },
      { id: 'bedroom', name: '主卧', type: 'bedroom', area: 16, x: 210, y: 40, width: 120, height: 110, confidence: 0.72 },
      { id: 'kitchen', name: '厨房', type: 'kitchen', area: 9, x: 40, y: 180, width: 110, height: 84, confidence: 0.7 }
    ];

  return {
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    sourceType: job?.job?.source_type || 'digital',
    strategy: {
      localGeometry: 'external_mock_recognizer',
      semanticReview: 'gpt_post_review',
      targetOutput: 'cad_ready_floor_plan'
    },
    confidence: {
      geometry: 0.79,
      semantics: 0.68
    },
    sourceAsset: {
      path: job?.assets?.local_source_file || '',
      exists: Boolean(job?.assets?.local_source_file)
    },
    rooms,
    walls: rooms.flatMap((room) => {
      const x1 = room.x;
      const y1 = room.y;
      const x2 = room.x + room.width;
      const y2 = room.y + room.height;

      return [
        { id: `${room.id}-w1`, start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: 12, confidence: room.confidence },
        { id: `${room.id}-w2`, start: { x: x2, y: y1 }, end: { x: x2, y: y2 }, thickness: 12, confidence: room.confidence },
        { id: `${room.id}-w3`, start: { x: x2, y: y2 }, end: { x: x1, y: y2 }, thickness: 12, confidence: room.confidence },
        { id: `${room.id}-w4`, start: { x: x1, y: y2 }, end: { x: x1, y: y1 }, thickness: 12, confidence: room.confidence }
      ];
    }),
    doors: [],
    windows: [],
    issues: [
      '这是一个外部识别器示例脚本，后续可替换为 OpenCV / OCR / 检测模型实现。',
      '当前仅演示 recognition-draft 接口，不代表真实 CAD 级识别精度。'
    ],
    nextActions: [
      '替换本脚本为真实 Python/OpenCV 识别器',
      '继续将识别结果交给 Codex 生成正式图、3D 和全景'
    ]
  };
}

async function main() {
  const jobFile = getArgValue('--job');
  const outputDir = getArgValue('--output');

  if (!jobFile || !outputDir) {
    throw new Error('用法: node scripts/mock-floorplan-recognizer.mjs --job <job.json> --output <dir>');
  }

  const job = JSON.parse(fs.readFileSync(path.resolve(jobFile), 'utf8'));
  const draft = buildDraft(job);
  const draftFile = path.join(path.resolve(outputDir), 'recognition-draft.json');
  fs.mkdirSync(path.dirname(draftFile), { recursive: true });
  fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(draft)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
