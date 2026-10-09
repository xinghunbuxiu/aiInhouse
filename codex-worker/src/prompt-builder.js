function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function summarizeRooms(rooms = []) {
  return rooms.slice(0, 12).map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    area: room.area,
    width: room.width,
    length: room.length
  }));
}

function summarizeOpenings(items = []) {
  return items.slice(0, 12).map((item) => ({
    id: item.id,
    type: item.type,
    width: item.width
  }));
}

function summarizeWalls(walls = []) {
  return {
    count: walls.length,
    sample: walls.slice(0, 8).map((wall) => ({
      id: wall.id,
      thickness: wall.thickness,
      start: wall.start,
      end: wall.end
    }))
  };
}

function summarizeParseResult(parseResult = {}) {
  if (!parseResult || typeof parseResult !== 'object') {
    return {};
  }

  const rooms = Array.isArray(parseResult.rooms) ? parseResult.rooms : [];
  const doors = Array.isArray(parseResult.doors) ? parseResult.doors : [];
  const windows = Array.isArray(parseResult.windows) ? parseResult.windows : [];
  const walls = Array.isArray(parseResult.walls) ? parseResult.walls : [];
  const meta = parseResult.meta || {};

  return {
    meta: {
      sourceType: meta.sourceType || 'digital',
      convertedToFormal: Boolean(meta.convertedToFormal),
      processNotes: meta.processNotes || '',
      pipeline: meta.pipeline || {}
    },
    roomCount: rooms.length,
    rooms: summarizeRooms(rooms),
    wallSummary: summarizeWalls(walls),
    doors: summarizeOpenings(doors),
    windows: summarizeOpenings(windows),
    hasGenerated3DConfig: Boolean(parseResult.generated3DConfig),
    hasPanoramaConfig: Boolean(parseResult.panoramaConfig)
  };
}

function summarizeRecognitionDraft(recognitionDraft = {}) {
  if (!recognitionDraft || typeof recognitionDraft !== 'object') {
    return {};
  }

  return {
    strategy: recognitionDraft.strategy || {},
    confidence: recognitionDraft.confidence || {},
    roomCount: Array.isArray(recognitionDraft.rooms) ? recognitionDraft.rooms.length : 0,
    rooms: summarizeRooms(recognitionDraft.rooms || []),
    wallSummary: summarizeWalls(recognitionDraft.walls || []),
    doors: summarizeOpenings(recognitionDraft.doors || []),
    windows: summarizeOpenings(recognitionDraft.windows || []),
    issues: Array.isArray(recognitionDraft.issues) ? recognitionDraft.issues : [],
    nextActions: Array.isArray(recognitionDraft.nextActions) ? recognitionDraft.nextActions : []
  };
}

function buildCodexPrompt(job) {
  const context = {
    job: {
      id: job?.job?.id,
      jobNo: job?.job?.job_no,
      jobType: job?.job?.job_type,
      sourceType: job?.job?.source_type,
      inputPayload: job?.job?.input_payload || {}
    },
    floorPlan: {
      id: job?.floor_plan?.id,
      name: job?.floor_plan?.name,
      imageUrl: job?.floor_plan?.image_url,
      parseResult: summarizeParseResult(job?.floor_plan?.parse_result || {})
    },
    house: job?.house || null,
    building: job?.building || null,
    block: job?.block || null,
    assets: job?.assets || {},
    runtimeHints: {
      recognitionDraft: summarizeRecognitionDraft(job?.runtimeHints?.recognitionDraft)
    }
  };

  return `# AIInHouse Codex Job

你正在处理一个本地房产业务平面图任务。请根据输入平面图、已有识别草稿与业务上下文，生成适合后台管理系统回传的交付文件。

## 任务目标

- 任务号: ${job?.job?.job_no || '未知'}
- 任务类型: ${job?.job?.job_type || '未知'}
- 图纸来源: ${job?.job?.source_type || 'digital'}

## 输出要求

请在输出目录中生成以下文件，按任务类型决定是否全部生成：

- \`formal-plan.svg\`
- \`formal-plan.dxf\`
- \`formal-plan.json\`
- \`3d-config.json\`
- \`panorama-config.json\`
- \`review.md\`
- \`preview.svg\` 或 \`preview.png\`
- \`effect-codex.png\` / \`effect-raster.png\`（如果可生成装修效果位图）
- \`panorama-codex.png\` / \`panorama-raster.png\`（如果可生成 VR 全景位图）

## 推荐处理策略

- 先以 \`runtimeHints.recognitionDraft\` 作为几何草稿基础，不要完全依赖语言模型凭空猜墙体。
- 优先保留已经识别出的墙体、房间、门窗结构，再做房间命名、用途推断和疑点标注。
- 如果识别草稿里有 \`issues\`，请在 \`review.md\` 里给出人工复核建议。
- 如果某一步无法完全确定，也请输出“可复核的正式图草稿”，不要因为局部不确定而放弃整张图。

## 结果回传格式

请在完成后输出一段 JSON 到 stdout，或者写入 \`codex-result.json\`，结构如下：

\`\`\`json
{
  "output": {
    "formalPlanSvg": "formal-plan.svg",
    "cadFile": "formal-plan.dxf",
    "formalPlanJson": "formal-plan.json",
    "threeDConfig": "3d-config.json",
    "panoramaConfig": "panorama-config.json",
    "reviewFile": "review.md",
    "previewImage": "preview.svg",
    "effectImage": "effect-codex.png",
    "panoramaImage": "panorama-codex.png"
  },
  "summary": {
    "roomCount": 4,
    "hasFormalPlan": true,
    "hasCad": true,
    "hasThreeD": true,
    "hasPanorama": true
  }
}
\`\`\`

## 业务上下文

\`\`\`json
${stringify(context)}
\`\`\`

## 额外约束

- 输出路径必须是相对于本次任务 output 目录的文件名
- JSON 必须合法可解析
- 如果某一步无法生成，也请给出可工作的最小结果，不要只返回空值
- 目标是“本地几何识别 + GPT 语义校对”的混合链路，请在结果里尽量体现该策略
`;
}

module.exports = {
  buildCodexPrompt
};
