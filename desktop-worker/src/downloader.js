const fs = require('fs');
const path = require('path');
const { backendOrigin } = require('./config');

function resolveAssetUrl(assetPath) {
  if (!assetPath) {
    return '';
  }

  if (/^https?:\/\//.test(assetPath)) {
    return assetPath;
  }

  return `${backendOrigin}${assetPath.startsWith('/') ? assetPath : `/${assetPath}`}`;
}

async function downloadFile(url, targetPath, headers = {}) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`下载文件失败: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
}

async function downloadSourceAsset(jobPackage, paths, token) {
  const sourceUrl = resolveAssetUrl(jobPackage?.assets?.source_url || jobPackage?.floor_plan?.image_url);

  if (!sourceUrl) {
    return null;
  }

  const ext = path.extname(new URL(sourceUrl).pathname) || '.png';
  const targetPath = `${paths.sourceFile}${ext}`;

  await downloadFile(sourceUrl, targetPath, {
    Authorization: `Bearer ${token}`
  });

  return targetPath;
}

module.exports = {
  resolveAssetUrl,
  downloadSourceAsset
};
