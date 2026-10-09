const fs = require('fs');

function readJob(jobFile) {
  const content = fs.readFileSync(jobFile, 'utf8');
  return JSON.parse(content);
}

module.exports = {
  readJob
};
