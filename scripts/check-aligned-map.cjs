const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const topojson = require('../.map-tools/node_modules/topojson-client');
const root = path.resolve(__dirname, '..');
function load(name, aligned) {
  const context = {window: {MALHAS: {}}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dados', aligned ? 'alinhados' : '', name + '.js'), 'utf8'), context);
  return JSON.parse(JSON.stringify(context.window.MALHAS[name]));
}
function collection(t) { return topojson.feature(t, Object.values(t.objects)[0]); }
const national = load('estados', true);
const owners = new Map();
for (const state of national.objects.estados.geometries) {
  for (const arc of state.arcs.flat(2)) {
    const id = arc < 0 ? ~arc : arc;
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push({sig: state.properties.SIGLA_UF, arc});
  }
}
for (const adjacent of owners.values()) {
  assert(adjacent.length <= 2, 'More than two states own a border');
  if (adjacent.length === 2) assert.equal(adjacent[0].arc, ~adjacent[1].arc, 'Adjacent states must use opposite sides of the same arc');
}
console.log('Verified: shared state arcs have exactly opposite directions.');
const union = topojson.mergeArcs(national, national.objects.estados.geometries);
for (const polygon of union.arcs) {
  for (const hole of polygon.slice(1)) {
    const touchingStates = new Set(hole.flatMap(ref =>
      (owners.get(ref < 0 ? ~ref : ref) || []).map(owner => owner.sig)));
    assert(touchingStates.size < 2, 'Unfilled gap between states');
  }
}
let count = 0;
for (const state of collection(national).features) {
  const sig = state.properties.SIGLA_UF;
  const local = load(sig, true);
  const geometries = Object.values(local.objects)[0].geometries;
  assert.deepEqual(state.geometry, topojson.merge(local, geometries), `State/municipality mismatch: ${sig}`);
  const original = Object.values(load(sig, false).objects)[0].geometries;
  assert.equal(geometries.length, original.length, `Missing municipalities: ${sig}`);
  count += geometries.length;
}
console.log(`Verified: ${count} municipalities retained; all 27 state outlines match; no enclosed gaps between states.`);
const html = fs.readFileSync(path.join(root, 'mapa-brasil-municipios.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}

// Optional static geometry preview; no browser or page execution is involved.
async function preview() {
  const sharp = require(process.env.SHARP_PATH || 'sharp');
  const bounds = process.env.MAP_BOUNDS ? process.env.MAP_BOUNDS.split(',').map(Number) : [-54, -26.2, -43.5, -19];
  const width = 1440, height = 960;
  const scale = Math.min(width / (bounds[2] - bounds[0]), height / (bounds[3] - bounds[1]));
  const x = lng => (lng - bounds[0]) * scale;
  const y = lat => (bounds[3] - lat) * scale;
  function geometryPath(g) {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polygons.map(p => p.map(r => r.map((v, i) => `${i ? 'L' : 'M'}${x(v[0]).toFixed(3)},${y(v[1]).toFixed(3)}`).join('') + 'Z').join('')).join('');
  }
  fs.mkdirSync(path.join(root, 'qa'), {recursive: true});
  for (const aligned of [false, true]) {
    const states = collection(load('estados', aligned));
    const local = load('SP', aligned);
    const muni = collection(local);
    const outline = topojson.merge(local, Object.values(local.objects)[0].geometries);
    const statePaths = states.features.filter(f => f.properties.SIGLA_UF !== 'SP').map(f => `<path d="${geometryPath(f.geometry)}" fill="white" stroke="#b3bdc9" stroke-width="0.75"/>`).join('');
    const muniPaths = muni.features.map(f => `<path d="${geometryPath(f.geometry)}" fill="white" stroke="#c5ccd5" stroke-width="0.5"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f3f5f7"/>${statePaths}${muniPaths}<path d="${geometryPath(outline)}" fill="none" stroke="#96a2b0" stroke-width="1"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'qa', `${aligned ? 'depois' : 'antes'}${process.env.MAP_BOUNDS ? '-zoom' : ''}.png`));
  }
}
if (process.argv.includes('--preview')) preview().catch(error => {console.error(error);process.exitCode = 1;});
