import fs from 'node:fs';
import path from 'node:path';

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function parseDesignTitle(title = '') {
  const areaMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|平米)/i);
  const layoutMatch = title.match(/(\d+)室(\d+)厅(\d+)卫(\d+)厨/);
  return {
    title,
    areaM2: areaMatch ? Number(areaMatch[1]) : null,
    layout: layoutMatch ? `${layoutMatch[1]}室${layoutMatch[2]}厅${layoutMatch[3]}卫${layoutMatch[4]}厨` : '',
    bedrooms: layoutMatch ? Number(layoutMatch[1]) : 0,
    halls: layoutMatch ? Number(layoutMatch[2]) : 0,
    baths: layoutMatch ? Number(layoutMatch[3]) : 0,
    kitchens: layoutMatch ? Number(layoutMatch[4]) : 0
  };
}

function extractRoomAreas(text = '') {
  const normalized = text.replace(/\s+/g, ' ');
  const matches = [];
  const pattern = /([\u4e00-\u9fa5A-Za-z]{1,12})\s*(\d+(?:\.\d+)?)\s*(?:㎡|m²|平米)/ig;
  for (const match of normalized.matchAll(pattern)) {
    matches.push({
      name: match[1],
      areaM2: Number(match[2])
    });
  }

  return matches
    .filter((item, index, all) => all.findIndex((other) => other.name === item.name && other.areaM2 === item.areaM2) === index)
    .slice(0, 40);
}

const title = getArg('--title');
const url = getArg('--url');
const textFile = getArg('--text-file');
const text = textFile && fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8') : getArg('--text');
const output = getArg('--output', 'tmp/kujiale-visible-snapshot.json');

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: {
    url,
    title
  },
  design: parseDesignTitle(title),
  visibleRooms: extractRoomAreas(text),
  apiCandidates: [
    '/d/api/session/v2?designid=',
    '/d/api/session?designid=',
    '/dds/api/c/designdata',
    '/gateway/dds/api/c/designdata',
    '/dds/api/c/homedesign',
    '/dds/api/c/floorplans/unit',
    '/dds/api/c/cameraperspective?designid=',
    '/api/diy/render?designId='
  ],
  notes: [
    'This snapshot intentionally stores only visible page text and public API path candidates.',
    'Do not store login cookies or JWT values in tracked files. Use an ignored HAR/curl file for authenticated structured design export.'
  ]
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(snapshot, null, 2), 'utf8');
console.log(JSON.stringify({
  output,
  design: snapshot.design,
  visibleRoomCount: snapshot.visibleRooms.length
}, null, 2));
