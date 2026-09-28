const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const cities = [];
for (const file of fs.readdirSync(path.join(root, 'dados/alinhados')).filter(file => /^[A-Z]{2}\.js$/.test(file))) {
  const scope = { window: { MALHAS: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dados/alinhados', file), 'utf8'), scope);
  const topology = scope.window.MALHAS[file.slice(0, 2)];
  for (const geometry of Object.values(topology.objects)[0].geometries) {
    const p = geometry.properties;
    cities.push({ id: String(p.CD_MUN), name: p.NM_MUN, uf: p.SIGLA_UF });
  }
}
fs.writeFileSync(path.join(root, 'dados/municipios-index.js'), `window.MUNICIPIOS_INDEX=${JSON.stringify(cities)};\n`);
console.log(`${cities.length} municipalities indexed locally.`);
