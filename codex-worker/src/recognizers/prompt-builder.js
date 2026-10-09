function stringify(value) {
  return JSON.stringify(value, null, 2);
}

const { buildRecognitionPromptAssetContext } = require('../assets/recognition-matcher');

function summarizeRooms(rooms = []) {
  return rooms.slice(0, 6).map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    area: room.area,
    width: room.width,
    height: room.height,
    confidence: room.confidence
  }));
}

function summarizeWalls(walls = []) {
  return walls.slice(0, 4).map((wall) => ({
    id: wall.id,
    thickness: wall.thickness,
    confidence: wall.confidence
  }));
}

function buildRecognitionPrompt(payload = {}) {
  const preprocessing = payload.preprocessing || null;
  const context = {
    job: payload.job || {},
    floorPlan: payload.floorPlan || {},
    sourceAsset: payload.sourceAsset || {},
    recognitionAssetGuide: buildRecognitionPromptAssetContext(),
    preprocessing: preprocessing
      ? {
          status: preprocessing.status,
          message: preprocessing.message,
          image: preprocessing.image,
          quality: preprocessing.quality,
          geometryCandidateSummary: {
            lineCount: preprocessing.geometryCandidates?.lines?.length || 0,
            contourCount: preprocessing.geometryCandidates?.contours?.length || 0,
            lines: (preprocessing.geometryCandidates?.lines || []).slice(0, 60),
            contours: (preprocessing.geometryCandidates?.contours || []).slice(0, 20)
          },
          ocrCandidates: (preprocessing.ocrCandidates || []).slice(0, 40)
        }
      : null,
    fallbackDraft: {
      sourceType: payload.fallbackDraft?.sourceType || 'digital',
      confidence: payload.fallbackDraft?.confidence || {},
      issues: payload.fallbackDraft?.issues || [],
      roomCount: Array.isArray(payload.fallbackDraft?.rooms) ? payload.fallbackDraft.rooms.length : 0,
      geometryRoomCount: Array.isArray(payload.fallbackDraft?.geometryRooms) ? payload.fallbackDraft.geometryRooms.length : 0,
      geometryRooms: summarizeRooms(payload.fallbackDraft?.geometryRooms || []),
      wallCount: Array.isArray(payload.fallbackDraft?.walls) ? payload.fallbackDraft.walls.length : 0,
      rooms: summarizeRooms(payload.fallbackDraft?.rooms || []),
      walls: summarizeWalls(payload.fallbackDraft?.walls || []),
      doors: (payload.fallbackDraft?.doors || []).slice(0, 4),
      windows: (payload.fallbackDraft?.windows || []).slice(0, 4)
    }
  };

  return `请根据当前平面图图片与上下文，输出一份 recognition-draft JSON，供后续 CAD/正式图、3D 配置和全景配置使用。

规则：
- 只输出合法 JSON，不要 markdown，不要解释。
- 尽量依据图片识别墙体、房间、门窗；把“看见什么”和“推断它是什么”分开处理。
- 优先使用 preprocessing.geometryCandidateSummary 中的线段/轮廓作为几何依据，再结合图片和 OCR 做语义校正；几何位置不得仅靠语言模型臆测。
- 参考 recognitionAssetGuide：尺寸线/标注不得当墙；门需门扇+弧；窗需平行细线或凸窗盒；承重墙通常更粗更黑。
- OCR 房间名称只能赋给标签中心点确实落在该房间内部的空间；不得仅凭距离把标签分配给相邻房间。
- 电梯井、管道井、设备平台、入户玄关、阳台属于可能存在的独立空间/结构，不得仅因有方框、门扇或洁具符号就把它们改成卫生间或卧室。
- 电梯井内的对角交叉线、井道边框和电梯门应作为结构/设备证据，不应解释成房间家具或卫生间洁具；入户门必须连接入户区域，不能凭空移动到电梯井。
- 不要为了满足常见户型模板而补齐房间数量；未标注且证据不足的区域使用“未确认空间”，在 issues 中说明。
- 如果无法完全确认，可以参考 fallbackDraft，但不要机械照抄；候选线段冲突时优先保持墙体闭合和房间拓扑合理。
- 不确定项写入 issues，并降低 confidence；不得声称未从图纸中读到的尺寸是精确尺寸。
- 坐标使用统一二维平面坐标，原点在图片左上角，x 向右，y 向下；无法知道真实米制尺寸时用相对像素/比例坐标。
- rooms 每项必须包含 name,type,area,x,y,width,height,confidence；房间应覆盖主要空间。
- walls 每项必须包含 start{x,y},end{x,y},thickness,confidence；优先输出外墙与主要隔墙。
- doors/windows 每项必须包含 type,x,y,width,height,confidence；x/y 取洞口中心点。
- 如果 preprocessing.quality.score < 0.6，必须在 issues 中说明需要人工复核。
- 字段至少包含：version, sourceType, generatedAt, strategy, confidence, rooms, walls, doors, windows, issues, nextActions。

上下文：
${stringify(context)}`;
}

function buildRecognitionProbePrompt(payload = {}) {
  const context = {
    floorPlan: payload.floorPlan || {},
    preprocessing: payload.preprocessing || null
  };

  return `请先快速判断这张图片是否是房屋平面图，并输出一个极简 JSON。

只输出合法 JSON，不要解释。
字段：
- isFloorPlan: boolean
- sourceType: string
- estimatedRoomCount: number
- majorSpaces: string[]
- confidence: number
- layoutHint: string

上下文：
${stringify(context)}`;
}

module.exports = {
  buildRecognitionPrompt,
  buildRecognitionProbePrompt
};
