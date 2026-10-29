#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'backend/data/recognition-error-book.json');
const book = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
const ids = new Set();
const validLifecycle = new Set(['open', 'guarded', 'fixed', 'verified', 'reopened']);
const required = book.caseSchema?.requiredFields || [];

if (!book.version || !Array.isArray(book.cases) || !book.cases.length) {
  errors.push('book must have a version and at least one case');
}
for (const [index, item] of (book.cases || []).entries()) {
  const prefix = item.id || `case[${index}]`;
  if (!item.id) errors.push(`${prefix}: missing id`);
  if (ids.has(item.id)) errors.push(`${prefix}: duplicate id`);
  ids.add(item.id);
  for (const field of required) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      errors.push(`${prefix}: missing required field ${field}`);
    }
  }
  if (!['observed', 'risk'].includes(item.status)) errors.push(`${prefix}: invalid status`);
  if (!validLifecycle.has(item.lifecycle)) errors.push(`${prefix}: invalid lifecycle`);
  if (!Array.isArray(item.prevention) || item.prevention.length === 0) {
    errors.push(`${prefix}: prevention must be a non-empty array`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    errors.push(`${prefix}: evidence/source references are required`);
  }
  if (item.status === 'observed' && !item.evidence?.some(e => e.file || e.commit || e.sample || e.workflowRun || e.humanReview)) {
    errors.push(`${prefix}: observed case requires traceable evidence`);
  }
  if (!item.regressionCheck || !/test|check|CI|回归|检查|门禁/i.test(item.regressionCheck)) {
    errors.push(`${prefix}: regressionCheck must describe an executable check`);
  }
}
if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  version: book.version,
  cases: book.cases.length,
  observed: book.cases.filter(item => item.status === 'observed').length,
  risks: book.cases.filter(item => item.status === 'risk').length,
  uniqueIds: ids.size
}, null, 2));
