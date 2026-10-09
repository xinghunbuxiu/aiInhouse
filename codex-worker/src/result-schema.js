function getResultSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['output', 'summary'],
    properties: {
      output: {
        type: 'object',
        additionalProperties: false,
        required: ['formalPlanSvg', 'cadFile', 'formalPlanJson', 'threeDConfig', 'panoramaConfig', 'reviewFile', 'previewImage'],
        properties: {
          formalPlanSvg: { type: 'string' },
          cadFile: { type: 'string' },
          formalPlanJson: { type: 'string' },
          recognitionDiagnostics: { type: 'string' },
          recognitionOverlay: { type: 'string' },
          recognitionEdges: { type: 'string' },
          recognitionBinary: { type: 'string' },
          recognitionWallBands: { type: 'string' },
          recognitionStructuralWalls: { type: 'string' },
          recognitionBalconyCandidates: { type: 'string' },
          recognitionRoomInteriors: { type: 'string' },
          recognitionWindowCandidates: { type: 'string' },
          recognitionDoorCandidates: { type: 'string' },
          recognitionSymbolCandidates: { type: 'string' },
          threeDConfig: { type: 'string' },
          panoramaConfig: { type: 'string' },
          reviewFile: { type: 'string' },
          previewImage: { type: 'string' },
          effectImage: { type: 'string' },
          renderImage: { type: 'string' },
          panoramaImage: { type: 'string' },
          equirectangularImage: { type: 'string' },
          modelFile: { type: 'string' }
        }
      },
      summary: {
        type: 'object',
        additionalProperties: true,
        required: ['roomCount', 'hasFormalPlan', 'hasCad', 'hasThreeD', 'hasPanorama'],
        properties: {
          roomCount: { type: 'number' },
          hasFormalPlan: { type: 'boolean' },
          hasCad: { type: 'boolean' },
          hasThreeD: { type: 'boolean' },
          hasPanorama: { type: 'boolean' }
        }
      }
    }
  };
}

module.exports = {
  getResultSchema
};
