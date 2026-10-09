const fs = require('fs');
const path = require('path');

function buildRoomCards(rooms = []) {
  return rooms.map((room, index) => {
    const x = 60 + (index % 3) * 180;
    const y = 118 + Math.floor(index / 3) * 96;
    const tones = [
      { fill: '#f8fafc', stroke: '#38bdf8' },
      { fill: '#fff7ed', stroke: '#f97316' },
      { fill: '#f5f3ff', stroke: '#8b5cf6' },
      { fill: '#ecfccb', stroke: '#65a30d' }
    ];
    const tone = tones[index % tones.length];

    return `
  <g>
    <rect x="${x}" y="${y}" width="148" height="72" rx="18" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="2"/>
    <text x="${x + 16}" y="${y + 28}" font-size="16" fill="#0f172a">${room.name || `空间 ${index + 1}`}</text>
    <text x="${x + 16}" y="${y + 50}" font-size="12" fill="#475569">${room.type || 'space'} · ${room.area || 0} m²</text>
  </g>`;
  }).join('\n');
}

function buildIssueList(issues = []) {
  if (!Array.isArray(issues) || !issues.length) {
    return '- 本次识别草稿没有额外异常项，可直接进入人工抽查。';
  }

  return issues.map((issue) => `- ${issue}`).join('\n');
}

function buildCommercialReadinessBlock(readiness = {}) {
  if (!readiness.status) {
    return '- 商用识别门禁: 未记录';
  }

  const reasons = readiness.blockingReasons?.length
    ? readiness.blockingReasons.map((reason) => `  - ${reason}`).join('\n')
    : '  - 无硬性阻塞项';
  const checklist = readiness.reviewChecklist?.length
    ? readiness.reviewChecklist.map((item) => `  - ${item}`).join('\n')
    : '  - 常规抽查房间名称、墙体闭合、门窗位置和比例尺';
  const metrics = readiness.metrics || {};

  return `- 商用识别门禁: ${readiness.status}
- 门禁得分: ${readiness.score ?? '未知'}
- 自动放行: ${readiness.autoPass ? '是' : '否'}
- 房间/墙体/门窗: ${metrics.roomCount ?? '-'} / ${metrics.wallCount ?? '-'} / ${metrics.openingCount ?? '-'}
- 模板依赖占比: ${metrics.templateDependencyRatio ?? '-'}
- 门窗贴墙率: ${metrics.attachedOpeningRatio ?? '-'}
- 阻塞原因:
${reasons}
- 复核清单:
${checklist}`;
}

function buildThreeDReadinessBlock(readiness = {}) {
  if (!readiness.status) {
    return '- 2D 转 3D 门禁: 未记录';
  }

  const blockers = readiness.blockers?.length
    ? readiness.blockers.map((reason) => `  - ${reason}`).join('\n')
    : '  - 无阻塞项';
  const checklist = readiness.reviewChecklist?.length
    ? readiness.reviewChecklist.map((item) => `  - ${item}`).join('\n')
    : '  - 常规检查墙体闭合、房间边界和门窗贴墙';
  const metrics = readiness.metrics || {};

  return `- 2D 转 3D 门禁: ${readiness.status}
- 门禁得分: ${readiness.score ?? '未知'}
- 可自动挤出建模: ${readiness.canAutoExtrude ? '是' : '否'}
- 可建模房间/全部房间: ${metrics.modelableRoomCount ?? '-'} / ${metrics.roomCount ?? '-'}
- 图像几何证据占比: ${metrics.geometryProofRatio ?? '-'}
- 模板依赖占比: ${metrics.templateDependencyRatio ?? '-'}
- 墙体覆盖率: ${metrics.wallCoverageRatio ?? '-'}
- 门窗贴墙率: ${metrics.attachedOpeningRatio ?? '-'}
- 阻塞原因:
${blockers}
- 复核清单:
${checklist}`;
}

function getDeliveryGrade(summary = {}) {
  const readiness = summary.commercialReadiness || {};
  if (readiness.status === 'commercial_ready') {
    return {
      grade: '商用识别可放行',
      conclusion: '平面图识别通过自动商用门禁，可进入设计生成和常规抽查；最终宣传级交付仍需素材授权与人工审批。'
    };
  }

  if (readiness.status === 'blocked') {
    return {
      grade: '识别阻塞',
      conclusion: '平面图识别未达到可复核草稿标准，需要先修正墙体、空间或门窗后再进入客户交付流程。'
    };
  }

  if (readiness.status === 'needs_human_review') {
    return {
      grade: '识别需复核',
      conclusion: '平面图已形成可复核装修草稿，但尚未达到自动商用准确线；需人工确认空间语义、门窗和比例后再作为准确装修图交付。'
    };
  }

  if (!summary.hasFormalPlan || !summary.hasThreeD || !summary.hasPanorama) {
    return {
      grade: '待补齐',
      conclusion: '交付包尚未完整生成，不能作为客户最终交付。'
    };
  }

  if (summary.recognitionGeometryConfidence >= 0.75 && summary.recognitionSemanticsConfidence >= 0.65 && summary.roomCount >= 4) {
    return {
      grade: '可预览交付',
      conclusion: '户型结构、3D 配置和 VR 漫游配置已完整，可用于客户预览和方案沟通；照片级商用图需接入真实渲染器或 imagegen 后终审。'
    };
  }

  return {
    grade: '需人工复核',
    conclusion: '已生成交付包草稿，但识别置信度或空间覆盖不足，需人工校正后再进入客户交付。'
  };
}

function buildDeliverableChecklist(summary = {}) {
  const items = [
    ['正式平面图 SVG', summary.hasFormalPlan],
    ['CAD/DXF 文件', summary.hasCad],
    ['3D 场景配置', summary.hasThreeD],
    ['装修工序/素材装配计划', summary.hasThreeD],
    ['俯瞰渲染图', summary.hasBirdseyeRender],
    ['室内观赏图', summary.hasInteriorRender],
    ['VR 全景漫游配置', summary.hasPanorama],
    ['全景 raster 图', summary.hasPanoramaRaster],
    ['VR 漫游页', summary.hasVrTour],
    ['客户预览图', true],
    ['复核报告', true]
  ];

  return items.map(([label, ok]) => `- ${ok ? '[x]' : '[ ]'} ${label}`).join('\n');
}

function filterRecognitionIssues(issues = [], commercialReadiness = {}) {
  if (commercialReadiness.status !== 'commercial_ready') {
    return issues;
  }

  return issues.filter((issue) => !String(issue).includes('稳定的结构化解析结果'));
}

function generateReviewFiles(job, outputDir, summary, rooms = []) {
  const recognitionDraft = job?.runtimeHints?.recognitionDraft || {};
  const recognitionConfidence = recognitionDraft.confidence || {};
  const commercialReadiness = recognitionDraft.quality?.commercialReadiness || summary.commercialReadiness || {};
  const threeDReadiness = recognitionDraft.quality?.threeDReadiness || summary.threeDReadiness || {};
  const deliveryGrade = getDeliveryGrade(summary);
  const filteredIssues = filterRecognitionIssues(recognitionDraft.issues, commercialReadiness);
  const review = `# AI 交付复核建议

- 任务号: ${job.job.job_no}
- 任务类型: ${job.job.job_type}
- 平面图: ${job.floor_plan?.name || '未命名平面图'}
- 交付等级: ${deliveryGrade.grade}
- 复核结论: ${deliveryGrade.conclusion}

## 自动检查摘要

- 房间数量: ${summary.roomCount}
- 已生成正式图: ${summary.hasFormalPlan ? '是' : '否'}
- 已生成 CAD 图: ${summary.hasCad ? '是' : '否'}
- 已生成 3D 配置: ${summary.hasThreeD ? '是' : '否'}
- 已生成全景配置: ${summary.hasPanorama ? '是' : '否'}
- 俯瞰渲染图: ${summary.hasBirdseyeRender ? '是' : '否'}
- 室内观赏图: ${summary.interiorRenderCount || 0} 张
- 全景 raster: ${summary.hasPanoramaRaster ? '是' : '否'}
- 识别异常数量: ${filteredIssues.length}

## 交付清单

${buildDeliverableChecklist(summary)}

## 识别草稿状态

- 几何置信度: ${recognitionConfidence.geometry ?? '未知'}
- 语义置信度: ${recognitionConfidence.semantics ?? '未知'}
- 本地策略: ${recognitionDraft.strategy?.localGeometry || '未记录'}
- GPT 校对: ${recognitionDraft.strategy?.semanticReview || '未记录'}

## 商用识别门禁

${buildCommercialReadinessBlock(commercialReadiness)}

## 2D 转 3D 门禁

${buildThreeDReadinessBlock(threeDReadiness)}

## 重点复核项

${buildIssueList(filteredIssues)}

## 商用交付建议

- 用作客户最终宣传图前，应确认房间名称、墙体闭合、门窗位置、厨房/卫生间位置和家具尺度。
- 若当前效果图为本地 SVG 预览，适合作为方案预览和流程验收；照片级商业成片需使用已授权素材库并接入 imagegen、Blender 或其他真实渲染器输出 PNG/JPG。
- VR 漫游图必须保持 2:1 equirectangular 比例，并通过 Pannellum 热点测试后再发布。
- 所有素材需保留授权来源或内部可商用证明，避免使用未授权第三方模型、贴图或图片。
- 最终商用放行需要填写 delivery-approval.json，将 humanApproved 和 licenseApproved 置为 true，并记录审批人、审批时间和备注。
`;

  const previewSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="640" height="360" viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="520" cy="82" r="44" fill="#f59e0b" fill-opacity="0.82"/>
  <path d="M405 202C436 148 474 120 521 120C567 120 592 143 603 190V260H405V202Z" fill="#1e293b" fill-opacity="0.65"/>
  <rect x="36" y="28" width="568" height="304" rx="28" fill="rgba(15,23,42,0.12)" stroke="rgba(255,255,255,0.16)"/>
  <text x="60" y="58" font-size="30" fill="#f8fafc">AIInHouse Full House Design</text>
  <text x="60" y="84" font-size="14" fill="#cbd5e1">${job.floor_plan?.name || job.job.job_no} · ${summary.roomCount} 个空间串行渲染完成</text>
  ${buildRoomCards(rooms)}
  <rect x="404" y="130" width="180" height="118" rx="24" fill="#f8fafc" fill-opacity="0.94"/>
  <rect x="430" y="170" width="72" height="42" rx="14" fill="#c97342"/>
  <rect x="512" y="156" width="42" height="60" rx="12" fill="#2f5d50"/>
  <circle cx="470" cy="150" r="18" fill="#fcd34d"/>
  <text x="430" y="236" font-size="13" fill="#334155">全屋 3D 设计预览</text>
  <text x="60" y="320" font-size="14" fill="#94a3b8">当前图像由 CAD/正式图 -> 分房间方案 -> 全屋整合 串行生成，可直接用于后台交付展示。</text>
</svg>`;

  const reviewPath = path.join(outputDir, 'review.md');
  const previewPath = path.join(outputDir, 'preview.svg');
  fs.writeFileSync(reviewPath, review, 'utf8');
  fs.writeFileSync(previewPath, previewSvg, 'utf8');

  return {
    reviewPath,
    previewPath
  };
}

module.exports = {
  generateReviewFiles
};
