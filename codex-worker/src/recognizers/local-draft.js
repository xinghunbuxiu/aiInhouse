  const spatialValidation = validateFloorplanDraft(repaired);
  const previousQuality = repaired.quality || {};
  // Keep legacy string issues and preserve structured diagnostics instead of silently dropping them.
  const issues = (repaired.issues || []).map((issue) => {
    if (typeof issue === 'string') return issue;
    if (!issue || typeof issue !== 'object') return String(issue);
    const severity = issue.severity ? `[${issue.severity}]` : '';
    const code = issue.code || issue.message || 'recognition-issue';
    const entity = issue.entityId ? ` (${issue.entityId})` : '';
    const related = issue.relatedEntityId ? ` -> ${issue.relatedEntityId}` : '';
    return `识别问题${severity}: ${code}${entity}${related}`;
  });
  for (const issue of spatialValidation.issues) {
    issues.push(`空间校验[${issue.severity}]: ${issue.code} (${issue.entityId || 'unknown'})`);
  }
  return {
    ...repaired,
    issues,
    spatialGraph: spatialValidation.graph,
    quality: {
      ...previousQuality,
      // Structural contradictions must affect downstream readiness, not merely
      // appear as informational log messages.
      needsReview: Boolean(previousQuality.needsReview)
        || spatialValidation.reviewRequired
        || !spatialValidation.valid,
      spatialValidation: {
        valid: spatialValidation.valid,
        reviewRequired: spatialValidation.reviewRequired,
        issueCount: spatialValidation.issues.length,
        errorCount: spatialValidation.issues.filter(issue => issue.severity === 'error').length,
        reviewCount: spatialValidation.issues.filter(issue => issue.severity === 'review').length,
        metrics: spatialValidation.metrics,
        issues: spatialValidation.issues
      }
    }
  };
}

function mergePreprocessing(draft, preprocessing) {
  if (!preprocessing) {
    return draft;
  }

  return {
    ...draft,
    preprocessing,
    sourceAsset: {
      ...(draft.sourceAsset || {}),
      preprocessedImagePath: preprocessing.preprocessedImagePath || ''
    }
  };
}

function withIssuePrefix(draft, prefix, issue) {
  return {
    ...draft,