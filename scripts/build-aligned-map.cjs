// Rebuild display geometry from the municipal sources, preserving the originals.
// Dependencies: npm install --prefix .map-tools mapshaper topojson-client
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mapshaper = require('../.map-tools/node_modules/mapshaper');
const topojson = require('../.map-tools/node_modules/topojson-client');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dados');
const output = path.join(source, 'alinhados');

// Keep shared coordinates verbatim, including across separately loaded files.
function subset(topology, objects) {
  const arcs = [], ids = new Map();
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    const id = value < 0 ? ~value : value;
    if (!ids.has(id)) { ids.set(id, arcs.length); arcs.push(topology.arcs[id]); }
    return value < 0 ? ~ids.get(id) : ids.get(id);
  }
  function geometry(g) {
    if (g.type === 'GeometryCollection') return {...g, geometries: g.geometries.map(geometry)};
    return {...g, arcs: visit(g.arcs)};
  }
  const result = {type: 'Topology', objects: Object.fromEntries(
    Object.entries(objects).map(([name, obj]) => [name, geometry(obj)])), arcs};
  if (topology.transform) result.transform = topology.transform;
  return result;
}

async function main() {
  const states = fs.readdirSync(source).filter(name => /^[A-Z]{2}\.json$/.test(name)).sort();
  const features = states.flatMap(name => {
    const topology = JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'));
    return topojson.feature(topology, Object.values(topology.objects)[0]).features;
  });
  const originalIds = features.map(f => f.properties.CD_MUN).sort();
  // Repair rounding cracks and slivers from independent simplification.
  // This is cartographic display geometry; original administrative data is retained.
  const files = await mapshaper.applyCommands(
    '-i municipios.geojson -clean snap-interval=0.0015 gap-width=1500m ' +
    '-o conjunto.json format=topojson no-quantization',
    {'municipios.geojson': JSON.stringify({type: 'FeatureCollection', features})});
  const topology = JSON.parse(files['conjunto.json']);
  const collection = Object.values(topology.objects)[0];
  // Larger triangular gaps can remain where independently simplified state
  // borders took different shortcuts. Fill only holes touching multiple UFs;
  // keep holes contained within one state (e.g. lakes) untouched.
  const owners = new Map();
  for (const geometry of collection.geometries) {
    const refs = geometry.type === 'Polygon' ? geometry.arcs.flat() : geometry.arcs.flat(2);
    for (const ref of refs) {
      const id = ref < 0 ? ~ref : ref;
      if (!owners.has(id)) owners.set(id, new Set());
      owners.get(id).add(geometry);
    }
  }
  const country = topojson.mergeArcs(topology, collection.geometries);
  let filledStateGaps = 0;
  for (const polygon of country.arcs) {
    for (const hole of polygon.slice(1)) {
      const neighbors = new Map();
      for (const ref of hole) {
        const id = ref < 0 ? ~ref : ref;
        const arc = topology.arcs[id];
        let length = 0;
        for (let i = 1; i < arc.length; i++) length += Math.hypot(arc[i][0] - arc[i-1][0], arc[i][1] - arc[i-1][1]);
        for (const owner of owners.get(id) || []) neighbors.set(owner, (neighbors.get(owner) || 0) + length);
      }
      if (new Set([...neighbors.keys()].map(g => g.properties.SIGLA_UF)).size < 2) continue;
      const recipient = [...neighbors].sort((a, b) => b[1] - a[1])[0][0];
      const filler = {type: 'Polygon', arcs: [hole.slice().reverse().map(ref => ~ref)]};
      const merged = topojson.mergeArcs(topology, [recipient, filler]);
      recipient.type = merged.type;
      recipient.arcs = merged.arcs;
      filledStateGaps++;
    }
  }
  console.log(`Repaired ${filledStateGaps} enclosed gaps between UFs; single-state holes retained.`);
  assert.deepEqual(collection.geometries.map(g => g.properties.CD_MUN).sort(), originalIds);
  assert(collection.geometries.every(g => g.arcs?.length), 'Municipality lost its geometry');
  const stateGeometries = [], municipalFiles = {};
  for (const name of states) {
    const sig = name.slice(0, 2);
    const geometries = collection.geometries.filter(g => g.properties.SIGLA_UF === sig);
    assert(geometries.length, `No municipalities for ${sig}`);
    const state = topojson.mergeArcs(topology, geometries);
    state.properties = {SIGLA_UF: sig};
    state.id = sig;
    stateGeometries.push(state);
    municipalFiles[sig] = subset(topology, {[sig]: {type: 'GeometryCollection', geometries}});
  }
  const national = subset(topology, {estados: {type: 'GeometryCollection', geometries: stateGeometries}});
  // Every state must equal the union of its municipalities coordinate for coordinate.
  for (const state of topojson.feature(national, national.objects.estados).features) {
    const sig = state.properties.SIGLA_UF;
    const local = municipalFiles[sig];
    assert.deepEqual(state.geometry, topojson.merge(local, local.objects[sig].geometries), sig);
  }
  fs.mkdirSync(output, {recursive: true});
  for (const [key, data] of Object.entries({...municipalFiles, estados: national})) {
    fs.writeFileSync(path.join(output, `${key}.js`), `window.MALHAS[${JSON.stringify(key)}]=${JSON.stringify(data)};\n`);
  }
  fs.writeFileSync(path.join(output, 'conjunto.json'), JSON.stringify(topology));
  console.log(`Validated ${originalIds.length} municipalities, ${states.length} states; every state boundary equals its municipal union.`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
