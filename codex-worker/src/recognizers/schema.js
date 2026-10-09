function getRecognitionDraftSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['version', 'sourceType', 'strategy', 'confidence', 'rooms', 'walls', 'doors', 'windows', 'issues', 'nextActions'],
    properties: {
      version: { type: 'string' },
      sourceType: { type: 'string' },
      generatedAt: { type: 'string' },
      strategy: { type: 'object', additionalProperties: true },
      confidence: {
        type: 'object',
        additionalProperties: true,
        properties: {
          geometry: { type: 'number' },
          semantics: { type: 'number' }
        }
      },
      sourceAsset: { type: 'object', additionalProperties: true },
      preprocessing: { type: 'object', additionalProperties: true },
      rooms: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['name', 'type', 'x', 'y', 'width', 'height', 'confidence'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            area: { type: 'number' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            confidence: { type: 'number' }
          }
        }
      },
      walls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['start', 'end', 'thickness', 'confidence'],
          properties: {
            id: { type: 'string' },
            start: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' }
              }
            },
            end: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' }
              }
            },
            thickness: { type: 'number' },
            confidence: { type: 'number' }
          }
        }
      },
      doors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            confidence: { type: 'number' }
          }
        }
      },
      windows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            confidence: { type: 'number' }
          }
        }
      },
      issues: { type: 'array' },
      nextActions: { type: 'array' },
      quality: { type: 'object', additionalProperties: true }
    }
  };
}

module.exports = {
  getRecognitionDraftSchema
};
