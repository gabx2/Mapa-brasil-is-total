const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('../.map-tools/node_modules/jsdom');
const data = require('../bases-data.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const root = path.resolve(__dirname, '..');
const headers = Array(17).fill('');
headers[2] = 'Contato'; headers[3] = 'IS Atual'; headers[4] = 'Telefone'; headers[14] = 'Cidade/UF'; headers[6] = 'Estoque'; headers[15] = 'Tags';
function row(name, city, tags = '', stock = '', contact = '', phone = '') {
  const cells = Array(17).fill('');
  cells[2] = contact; cells[3] = name; cells[4] = phone; cells[14] = city; cells[15] = tags; cells[6] = stock; return cells;
}
const fixtures = [headers, row('Pessoa A', 'Florianópolis/SC', 'Teste', '68', 'João Silva', '(48) 99999-1111'),
  row('Pessoa A', 'Florianopolis/SC', '', '', 'Maria Souza', '(48) 98888-2222'),
  row('Pessoa A', 'São Paulo/SP', '', '', 'Carlos Lima', '11977773333'),
  row('Pessoa A', 'Santa Helena'), row('Pessoa A', '-'), row('Pessoa B', 'Curitiba/PR', '', '', 'Ana Santos', '41966664444')];
const scope = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'dados/municipios-index.js'), 'utf8'), scope);
const index = data.createCityIndex(scope.window.MUNICIPIOS_INDEX);
const imported = data.importRows(fixtures), located = data.locatePerson(imported.people[0], index);
assert.equal(located.cities.length, 2);
assert.equal(located.cities.find(c => c.uf === 'SC').count, 2);
assert.equal(located.unresolved.length, 2);
assert.equal(imported.people[0].records[0].tags, 'Teste');
assert.equal(imported.people[0].records[0].stock, '68');
assert.deepEqual(data.parseCSV('\ufeffsep=;\r\n"a;b";"c""d";"uma\nlinha"\r\n'), [['a;b', 'c"d', 'uma\nlinha']]);
assert.deepEqual(data.parseCSV('D,O\nNome,Cidade'), [['D','O'],['Nome','Cidade']]);
assert.throws(() => data.parseCSV('"sem fechamento'), /aspas/);
assert.throws(() => data.importRows([['errado']]), /coluna D/);
assert.equal(data.resolveCity('Florianópolis / sc', index).city.uf, 'SC');
assert.equal(data.resolveCity('Santa Helena', index).city, undefined);
assert.equal(data.resolveCity('RS', index).city, undefined);
assert.equal(data.decodeCSV(Uint8Array.from([0x61,0xe7,0xe3,0x6f])), 'ação');
const originalFields = fixtures[1];
for (const bookType of ['xlsx', 'biff8']) {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(fixtures), 'Bases');
  const bytes = XLSX.write(book, {type: 'buffer', bookType});
  const reread = XLSX.read(bytes, {type: 'buffer'});
  const rows = XLSX.utils.sheet_to_json(reread.Sheets.Bases, {header: 1, defval: '', raw: false});
  assert.deepEqual(rows[1], originalFields);
  assert.equal(data.importRows(rows).people.length, 2);
}
console.log('PASS: CSV quoted fields/encodings; XLS/XLSX; D/O mapping; reserved P/G; ambiguous and missing cities.');

const squadFixture = data.importRows([headers,
  row('Ana', 'Curitiba/PR', 'Ex-cliente; VIP', '500'),
  row('Ana', 'São Paulo/SP', 'Ex-cliente', '1.000'),
  row('Bia', 'Florianópolis/SC', 'VIP', '499'),
  row('Bia', 'Curitiba/PR', 'Novo', ''),
  row('Ana', 'Curitiba/PR', 'Ex-cliente antigo', 'indefinido')]);
const squadFilter = overrides => data.filterBySquad(squadFixture, {members: [], states: [], tag: '', stock: null, ...overrides}, index);
assert.equal(squadFilter({states: ['PR', 'SC']}).total, 4);
assert.equal(squadFilter({tag: 'EX-CLIENTE'}).total, 2, 'Tag must match a full token, not a substring');
assert.equal(squadFilter({stock: {op: 'gte', value: 500}}).total, 2);
assert.equal(squadFilter({stock: {op: 'gt', value: 500}}).total, 1);
assert.equal(squadFilter({stock: {op: 'eq', value: 500}}).total, 1);
assert.equal(squadFilter({stock: {op: 'lte', value: 500}}).total, 2, 'Blank stock must not become zero');
assert.equal(squadFilter({stock: {op: 'lt', value: 500}}).total, 1);
assert.equal(squadFilter({members: ['ANA'], states: ['PR'], tag: 'ex-cliente', stock: {op: 'gte', value: 500}}).total, 1);
assert.equal(squadFilter({states: ['PR'], stock: {op: 'gt', value: 500}}).total, 0);
assert.equal(squadFixture.total, 5, 'Filtering must preserve the imported dataset');
assert.equal(data.parseStock('1.500,50'), 1500.5);
assert.equal(data.parseStock('0'), 0);
assert.equal(data.parseStock(''), null);
for (const [label, quantity] of [
  ['38 Pequeno (21 - 50)', 38], ['91 Médio (51 - 500)', 91],
  ['485 Médio (51 - 500)', 485], ['500 Médio (51 - 500)', 500],
  ['511 Grande (501 - 1500)', 511], ['758 Grande (501 - 1500)', 758],
  ['3009 Enterprise (1500+)', 3009], ['3.009 Enterprise (1500+)', 3009]
]) assert.equal(data.parseStock(label), quantity);
assert.equal(data.parseStock('Grande (501 - 1500)'), null, 'A range must not become an exact quantity');
assert.equal(data.parseStock('Estoque desconhecido 1500'), null);
const classifiedDataset = data.importRows([headers, ...[
  '38 Pequeno (21 - 50)', '485 Médio (51 - 500)', '500 Médio (51 - 500)',
  '511 Grande (501 - 1500)', '758 Grande (501 - 1500)', '3009 Enterprise (1500+)', ''
].map(stock => row('Ana', 'Curitiba/PR', '', stock))]);
assert.equal(data.filterBySquad(classifiedDataset, {members: [], states: [], tag: '', stock: {op: 'gt', value: 500}}, index).total, 3);
assert.equal(classifiedDataset.allRecords[5].stock, '3009 Enterprise (1500+)');
console.log('PASS: optional squad filters, AND combinations, memberships, exact tags and stock comparisons.');

const aliasDataset = data.importRows([headers, ...[
  'Ex-Cliente', 'Imóveis - Ex-Cliente', 'Imóveis - Reativa Ex-Cliente', 'reativa',
  'IMOVEIS – EX CLIENTE', 'Ex-Cliente; Reativa', 'Imóveis - Já é Cliente',
  'Imóveis - Pasta Zap', 'Ex-cliente antigo', '', '-'
].map(tag => row('Ana', 'Curitiba/PR', tag))]);
for (const tag of ['ex cliente', 'Ex-Cliente', 'Imóveis - Ex-Cliente', 'Imóveis - Reativa Ex-Cliente', 'Reativa']) {
  const filteredAliases = data.filterBySquad(aliasDataset, {members: [], states: [], tag, stock: null}, index);
  assert.equal(filteredAliases.total, 6, `${tag}: aliases match individually and multiple aliases do not duplicate a record`);
}
assert.equal(data.filterBySquad(aliasDataset, {members: [], states: [], tag: 'Imóveis - Já é Cliente', stock: null}, index).total, 1);
assert.equal(aliasDataset.allRecords[1].tags, 'Imóveis - Ex-Cliente', 'Original imported tags remain unchanged');
console.log('PASS: Ex-cliente/Reativa aliases, exclusions, no duplicate counts and existing saved tag spellings.');

async function main() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const html = fs.readFileSync(path.join(root, 'mapa-brasil-municipios.html'), 'utf8');
  const dom = new JSDOM(html, {runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://mapa.test/', virtualConsole});
  const w = dom.window, d = w.document;
  const run = source => new vm.Script(source).runInContext(dom.getInternalVMContext());
  w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
  w.matchMedia = query => ({matches: query.includes('reduced-motion'), addEventListener(){}, removeEventListener(){}});
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.HTMLDialogElement.prototype.showModal = function() {this.open = true;};
  w.HTMLDialogElement.prototype.close = function() {this.open = false;};
  Object.defineProperty(d.getElementById('map'), 'clientWidth', {value: 1440});
  Object.defineProperty(d.getElementById('map'), 'clientHeight', {value: 960});
  const originalAppend = d.head.appendChild.bind(d.head);
  d.head.appendChild = function(element) {
    if (element.tagName === 'SCRIPT' && element.getAttribute('src')?.startsWith('dados/')) {
      setTimeout(() => {
        try {run(fs.readFileSync(path.join(root, element.getAttribute('src')), 'utf8')); element.onload();}
        catch (error) {errors.push(error); element.onerror();}
      }, 0);
    }
    return originalAppend(element);
  };
  run(fs.readFileSync(path.join(root, '.map-tools/node_modules/leaflet/dist/leaflet-src.js'), 'utf8'));
  w.L.Browser.svg = true;
  run(fs.readFileSync(path.join(root, '.map-tools/node_modules/topojson-client/dist/topojson-client.js'), 'utf8'));
  for (const file of ['vendor/xlsx.full.min.js','dados/municipios-index.js','dados/paises.js','bases-data.js']) run(fs.readFileSync(path.join(root,file),'utf8'));
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if(match[1].trim()) run(match[1]);
  run(fs.readFileSync(path.join(root, 'squads-ui.js'), 'utf8'));
  run(fs.readFileSync(path.join(root, 'bases-ui.js'), 'utf8'));
  async function waitFor(predicate, description) {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 15000) throw new Error('Timeout: ' + description + '; ' + d.getElementById('bases-error').textContent);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async function upload(name, buffer) {
    const file = {name, size: buffer.length, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)};
    const input = d.getElementById('bases-file');
    Object.defineProperty(input, 'files', {configurable:true, value:[file]});
    input.dispatchEvent(new w.Event('change'));
    await waitFor(() => !d.getElementById('bases-upload').disabled, 'file import');
  }
  async function choose(name) {
    const input = d.getElementById('person-search');
    input.focus(); input.value = name; input.dispatchEvent(new w.Event('input'));
    const option = d.querySelector('#person-options [role="option"]');
    assert(option, 'Person dropdown result missing');
    option.click();
    await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'person map');
  }
  // Restore a large saved dataset before the asynchronous national map is ready.
  const largeRows = [headers, ...Array.from({length: 50000}, (_, i) =>
    row('Carga teste', ['São Paulo/SP', 'Florianópolis/SC', 'Curitiba/PR'][i % 3]))];
  const largeDataset = data.importRows(largeRows, {stage: 'quali'});
  const originalLoad = w.BasesUI.storage.loadAllSlots;
  w.BasesUI.storage.loadAllSlots = async () => [{stage: 'quali', dataset: largeDataset, fileName: 'carga.csv'}];
  assert.equal(w.eval('!!estadosLayer'), false, 'Restore starts before map readiness');
  await w.BasesUI.initStorage();
  await waitFor(() => d.querySelectorAll('.leaflet-person-bases-pane path').length === 3, '50000 restored records automatically painted');
  assert.match(d.getElementById('bases-summary').textContent, /50\.000 de 50\.000/);
  assert.equal(d.getElementById('bases-person-name').textContent, 'TOTAL');
  w.BasesUI.storage.loadAllSlots = originalLoad;
  w.BasesUI.removeSlot('quali');
  console.log('PASS: 50,000 saved records render TOTAL automatically, including restoration before map readiness.');
  await waitFor(() => w.eval('!!estadosLayer'), 'national map');
  await waitFor(() => w.eval('!!paisesLayer'), 'world countries map');
  assert(w.eval('!!paisesLayer'), 'paisesLayer initialized');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Notas']]), 'Notas');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(fixtures), 'Bases');
  for (const [ext,type] of [['xlsx','xlsx'],['xls','biff8']]) {
    await upload('teste.' + ext, XLSX.write(book, {type: 'buffer', bookType:type}));
    assert(!d.getElementById('person-search').disabled);

    await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'automatic total map');
    assert.equal(d.getElementById('bases-person-name').textContent, 'TOTAL');
    assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 3, 'Import must paint TOTAL without selecting a person');

    // Test TOTAL as first option
    d.getElementById('person-toggle').click();
    const opts = d.querySelectorAll('#person-options [role="option"]');
    assert(opts.length >= 3, 'Dropdown must have TOTAL and all people');
    assert.match(opts[0].textContent, /TOTAL/);
    opts[0].click();
    await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'total map');
    assert.equal(d.getElementById('bases-person-name').textContent, 'TOTAL');
    assert.equal(d.querySelectorAll('.base-city').length, 3);
    assert.match(d.getElementById('bases-summary').textContent, /no total em 3 municípios/);
    assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 3);
    d.querySelector('.base-city').click();
    assert.equal(d.getElementById('bases-contacts').hidden, false);
    assert.equal(d.querySelectorAll('.base-contact-card').length, 2);
    d.getElementById('bases-contacts-close').click();
    assert.equal(d.getElementById('bases-contacts').hidden, true);

    await choose('Pessoa A');
    assert.equal(d.querySelectorAll('.base-city').length, 2);
    assert.match(d.getElementById('bases-summary').textContent, /3 de 5/);
    assert.match(d.getElementById('bases-pending-title').textContent, /2 registros/);
    assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 2);
    assert.equal(w.eval('stateLayers.size'), 27);

    // Test city selection & contact list display
    d.querySelector('.base-city').click();
    assert.equal(d.getElementById('bases-contacts').hidden, false);
    assert.match(d.getElementById('bases-contacts-title').textContent, /Florianópolis/);
    assert.equal(d.querySelectorAll('.base-contact-card').length, 2);
    assert.match(d.querySelectorAll('.base-contact-name')[0].textContent, /João Silva/);
    assert.match(d.querySelectorAll('.base-contact-phone')[0].textContent, /99999-1111/);
    assert.match(d.querySelectorAll('.base-contact-name')[1].textContent, /Maria Souza/);
    assert.match(d.querySelectorAll('.base-contact-phone')[1].textContent, /98888-2222/);

    // Test close button
    d.getElementById('bases-contacts-close').click();
    assert.equal(d.getElementById('bases-contacts').hidden, true);

    // Test fit button deselecting city
    d.querySelector('.base-city').click();
    assert.equal(d.getElementById('bases-contacts').hidden, false);
    d.getElementById('bases-fit').click();
    assert.equal(d.getElementById('bases-contacts').hidden, true);

    await choose('Pessoa B');
    assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 1);
    assert.match(d.getElementById('bases-cities').textContent, /Curitiba/);
    d.querySelector('.base-city').click();
    assert.equal(d.getElementById('bases-contacts').hidden, false);
    assert.equal(d.querySelectorAll('.base-contact-card').length, 1);
    assert.match(d.querySelector('.base-contact-name').textContent, /Ana Santos/);
    assert.match(d.querySelector('.base-contact-phone').textContent, /966664444/);

    d.getElementById('home-map').click();
    assert.equal(w.BasesUI.hasSelection(), false);
    assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 0);
    assert.equal(d.getElementById('bases-contacts').hidden, true);
  }

  // Test multi-slot import (quali + frio) and stage switching
  const frioBook = XLSX.utils.book_new();
  const frioFixtures = [
    headers,
    row('Pessoa A', 'Porto Alegre/RS', '', '', 'Lucas Porto', '51999998888'),
    row('Pessoa A', 'Curitiba/PR', '', '', 'Juliana Prado', '41988887777'),
    row('Pessoa C', 'Belo Horizonte/MG', '', '', 'Marcos BH', '31977776666')
  ];
  XLSX.utils.book_append_sheet(frioBook, XLSX.utils.aoa_to_sheet(frioFixtures), 'Fria');
  const frioBuffer = XLSX.write(frioBook, {type: 'buffer', bookType: 'xlsx'});
  const frioFile = {name: 'frio.xlsx', size: frioBuffer.length, arrayBuffer: async () => frioBuffer.buffer.slice(frioBuffer.byteOffset, frioBuffer.byteOffset + frioBuffer.byteLength)};
  await w.BasesUI.importFile(frioFile, 'frio');
  assert(d.getElementById('slot-frio').classList.contains('is-loaded'), 'Slot frio must be loaded');
  assert.equal(d.getElementById('tab-count-frio').textContent, '3');
  assert.equal(d.querySelector('.stage-tab[data-stage="frio"]').disabled, false);

  // In "Tudo", Pessoa A should have records from both Quali (5 total, 3 located) and Fria (2 located)
  await choose('Pessoa A');
  assert.equal(w.BasesUI.getStage(), 'all');
  assert.equal(d.querySelectorAll('.base-city').length, 4, 'Pessoa A has 4 cities combined in Tudo (Floripa, SP, POA, Curitiba)');
  d.querySelector('.base-city').click();
  assert(d.querySelectorAll('.contact-stage-badge').length > 0, 'Contact cards in Tudo must show stage badges');

  d.getElementById('bases-fit').click();
  await waitFor(() => !w.eval('zoomInProgress') && !w.eval('pendingFit') && !w.eval('map._animatingZoom'), 'fit animation complete');
  await new Promise(r => setTimeout(r, 150));

  // Record zoom and center before switching tabs
  const initialZoom = w.eval('map.getZoom()');
  const initialCenterLat = w.eval('map.getCenter().lat');

  // Switch to "Fria" tab
  d.querySelector('.stage-tab[data-stage="frio"]').click();
  await waitFor(() => d.querySelectorAll('.base-city').length === 2, 'stage switch to frio');
  assert.equal(w.eval('map.getZoom()'), initialZoom, 'Map zoom must not jump when switching to Fria');
  assert.equal(w.eval('map.getCenter().lat'), initialCenterLat, 'Map latitude must not jump when switching to Fria');

  // Switch to "Quali" tab
  d.querySelector('.stage-tab[data-stage="quali"]').click();
  await waitFor(() => d.querySelectorAll('.base-city').length === 2, 'stage switch to quali');
  assert.equal(w.eval('map.getZoom()'), initialZoom, 'Map zoom must not jump when switching to Quali');
  assert.equal(w.eval('map.getCenter().lat'), initialCenterLat, 'Map latitude must not jump when switching to Quali');

  // Switch back to "Tudo" tab
  d.querySelector('.stage-tab[data-stage="all"]').click();
  await waitFor(() => d.querySelectorAll('.base-city').length === 4, 'stage switch back to all');
  assert.equal(w.eval('map.getZoom()'), initialZoom, 'Map zoom must not jump when switching to Tudo');
  assert.equal(w.eval('map.getCenter().lat'), initialCenterLat, 'Map latitude must not jump when switching to Tudo');

  // State drill-down scopes heat polygons, totals, people and stages together.
  await choose('TOTAL');
  await w.eval("carregarMunicipios('PR')");
  await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'Parana heat');
  assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 1);
  assert.match(d.getElementById('bases-summary').textContent, /2 de 2.*Paraná/);
  assert.equal(d.getElementById('tab-count-all').textContent, '2');
  assert.equal(d.getElementById('tab-count-quali').textContent, '1');
  assert.equal(d.getElementById('tab-count-frio').textContent, '1');
  assert.match(d.getElementById('bases-cities').textContent, /Curitiba/);
  assert.doesNotMatch(d.getElementById('bases-cities').textContent, /Florianópolis|São Paulo/);
  d.querySelector('.base-city').click();
  assert.equal(d.querySelectorAll('.base-contact-card').length, 2);
  await choose('Pessoa A');
  assert.equal(w.eval('siglaAtual'), 'PR');
  assert.match(d.getElementById('bases-summary').textContent, /1 de 1/);
  w.BasesUI.switchStage('quali');
  assert.match(d.getElementById('bases-summary').textContent, /não possui registros.*Paraná/);
  assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 0);
  await choose('TOTAL');
  assert.equal(w.eval('siglaAtual'), 'PR');
  assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 1);
  w.BasesUI.switchStage('all');
  await w.eval("carregarMunicipios('SC')");
  await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'Santa Catarina heat');
  assert.match(d.getElementById('bases-summary').textContent, /2 de 2.*Santa Catarina/);
  assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 1);
  await w.eval("carregarMunicipios('AM')");
  await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'empty state');
  assert.match(d.getElementById('bases-summary').textContent, /0 de 0.*Amazonas/);
  assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 0);
  d.getElementById('home-map').click();
  await waitFor(() => d.querySelectorAll('.base-city').length === 5, 'restore Brazil heat');
  assert.equal(w.eval('siglaAtual'), null);
  assert.equal(d.getElementById('tab-count-all').textContent, '9');
  assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, 5);
  await choose('Pessoa A');
  console.log('PASS: state-only heat, record counts, contacts, person/stage changes, empty state and Brazil restoration.');

  // Test slot removal
  d.querySelector('#slot-frio .slot-remove').click();
  assert(!d.getElementById('slot-frio').classList.contains('is-loaded'), 'Slot frio must be cleared');
  assert.equal(d.querySelector('.stage-tab[data-stage="frio"]').disabled, true);
  await waitFor(() => d.querySelectorAll('.base-city').length === 2, 'after removing frio, Pessoa A has only Quali cities');
  console.log('PASS: 4-slot 2x2 import, multi-stage consolidation, stage filtering tabs, and slot removal.');

  // Create, apply, edit and restore a saved squad through the actual form.
  d.getElementById('squad-new').click();
  assert.match(d.getElementById('squad-found-tags').textContent, /Teste · 1 registros/);
  d.getElementById('squad-tag-search').value = 'não existe';
  d.getElementById('squad-tag-search').dispatchEvent(new w.Event('input'));
  assert.equal(d.querySelectorAll('.squad-tag-choice').length, 0);
  d.getElementById('squad-tag-search').value = 'TÉSTE';
  d.getElementById('squad-tag-search').dispatchEvent(new w.Event('input'));
  assert.equal(d.querySelectorAll('.squad-tag-choice').length, 1);
  d.querySelector('.squad-tag-choice').click();
  assert.equal(d.getElementById('squad-tag').value, 'Teste');
  assert.equal(d.querySelector('.squad-tag-choice').getAttribute('aria-pressed'), 'true');
  assert.match(d.getElementById('squad-found-stocks').textContent, /68 · 1 registros/);
  d.getElementById('squad-found-tags').value = 'Teste';
  d.getElementById('squad-found-tags').dispatchEvent(new w.Event('change'));
  assert.equal(d.getElementById('squad-tag').value, 'Teste');
  d.getElementById('squad-found-stocks').value = '68';
  d.getElementById('squad-found-stocks').dispatchEvent(new w.Event('change'));
  assert.equal(d.getElementById('squad-stock-value').value, '68');
  assert.equal(d.getElementById('squad-stock-op').value, 'eq');
  const pasteList = source => {
    const event = new w.Event('paste', {cancelable: true});
    Object.defineProperty(event, 'clipboardData', {value: {getData: () => source}});
    d.getElementById('squad-member-list').dispatchEvent(event);
    assert(event.defaultPrevented);
  };
  d.querySelector('#squad-members input[value="Pessoa B"]').checked = true;
  pasteList(' Pessoa A\r\nPESSOA A\r\n\r\nJoão Silva\t Maria Souza \nJoao Silva');
  assert.equal(d.querySelectorAll('#squad-members input:checked').length, 4, 'Pasting deduplicates names and preserves previous selections');
  pasteList('Pessoa A\nJOÃO SILVA');
  assert.equal(d.querySelectorAll('#squad-members input:checked').length, 4, 'Repeated pastes are idempotent');
  assert.match(d.getElementById('squad-member-status').textContent, /0 pessoa.*4 selecionada/);
  assert.equal(d.getElementById('squad-member-list').value, 'Pessoa A\nJOÃO SILVA', 'Pasted text stays visible');
  const searchPaste = new w.Event('paste', {cancelable: true});
  Object.defineProperty(searchPaste, 'clipboardData', {value: {getData: () => 'Nova Pessoa\r\nOutra Pessoa'}});
  d.getElementById('squad-member-search').dispatchEvent(searchPaste);
  assert.equal(d.querySelectorAll('#squad-members input:checked').length, 6, 'Pasting in the search field also adds the list');
  const nativePaste = new w.Event('paste', {cancelable: true});
  d.getElementById('squad-member-list').dispatchEvent(nativePaste);
  d.getElementById('squad-member-list').value = 'Nome via colagem nativa';
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(d.querySelectorAll('#squad-members input:checked').length, 7, 'Native paste fallback adds the inserted text');
  d.getElementById('squad-member-list').value = 'Nome via input';
  d.getElementById('squad-member-list').dispatchEvent(new w.InputEvent('input', {inputType:'insertFromPaste'}));
  assert.equal(d.querySelectorAll('#squad-members input:checked').length, 8);
  d.getElementById('squad-cancel').click();
  d.getElementById('squad-new').click();
  d.getElementById('squad-name').value = 'SUL';
  pasteList('Pessoa A\r\nPessoa A\r\n');
  d.getElementById('squad-use-states').checked = true;
  d.querySelector('#squad-states input[value="SC"]').checked = true;
  d.getElementById('squad-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
  await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'apply squad');
  assert.equal(d.querySelectorAll('.base-city').length, 1);
  assert.match(d.getElementById('bases-summary').textContent, /2 de 2/);
  assert.equal(d.getElementById('tab-count-all').textContent, '2');
  assert.match(d.getElementById('squad-summary').textContent, /1 pessoa.*SC/);
  const savedSquadId = d.getElementById('squad-select').value;
  d.getElementById('squad-edit').click();
  d.getElementById('squad-use-states').checked = false;
  d.getElementById('squad-use-tag').checked = true;
  d.getElementById('squad-tag').value = 'Teste';
  d.getElementById('squad-use-stock').checked = true;
  d.getElementById('squad-stock-large').click();
  assert.equal(d.getElementById('squad-stock-op').value, 'gt');
  assert.equal(d.getElementById('squad-stock-value').value, '500');
  d.getElementById('squad-stock-op').value = 'gte';
  d.getElementById('squad-stock-value').value = '68';
  d.getElementById('squad-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
  await waitFor(() => !d.getElementById('bases-summary').textContent.includes('Localizando'), 'edit squad');
  assert.match(d.getElementById('bases-summary').textContent, /1 de 1/);
  assert.equal(d.getElementById('squad-select').value, savedSquadId);
  const savedSquads = JSON.parse(w.localStorage.getItem('mapa-brasil-squads-v1'));
  assert.equal(savedSquads.squads.length, 1);
  assert.equal(savedSquads.squads[0].stock.value, 68);
  assert.equal(savedSquads.squads[0].states.length, 0);
  d.getElementById('squad-select').value = '';
  d.getElementById('squad-select').dispatchEvent(new w.Event('change'));
  await waitFor(() => d.querySelectorAll('.base-city').length === 3, 'remove squad filter');
  assert.equal(d.getElementById('tab-count-all').textContent, '6');
  // Recreate the manager to exercise persisted definitions and selected squad.
  savedSquads.activeId = savedSquadId;
  w.localStorage.setItem('mapa-brasil-squads-v1', JSON.stringify(savedSquads));
  const restoredManager = w.createSquadsUI({states: w.eval('ESTADOS'), getDataset: () => imported, onChange() {}});
  assert.equal(restoredManager.active().name, 'SUL');
  assert.equal(restoredManager.active().tag, 'Teste');
  d.getElementById('squad-edit').click();
  d.getElementById('squad-use-tag').checked = false;
  d.getElementById('squad-use-stock').checked = false;
  d.getElementById('squad-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
  assert.match(d.getElementById('squad-form-error').textContent, /pelo menos um filtro/);
  d.getElementById('squad-cancel').click();
  console.log('PASS: squad form creation/editing, map and totals, persistence restoration, validation and clearing filters.');

  if (process.argv[2]) {
    const buffer = fs.readFileSync(process.argv[2]);
    await upload(path.basename(process.argv[2]), buffer);
    assert(d.getElementById('bases-error').hidden);
    const parsed = data.importRows(data.parseCSV(data.decodeCSV(buffer)));
    const fernanda = parsed.people.find(p => data.normalize(p.name) === data.normalize('Fernanda Ferreira da Silva'));
    const expected = data.locatePerson(fernanda, index);
    await choose('Fernanda Ferreira da Silva');
    assert.equal(d.querySelectorAll('.base-city').length, expected.cities.length);
    assert.equal(d.querySelectorAll('.leaflet-person-bases-pane path').length, expected.cities.length);
    assert.equal(expected.total, 1713);
    assert.equal(expected.cities.length, 252);
    assert.equal(expected.cities.reduce((n,c) => n+c.count,0),1699);
    console.log(`PASS: actual CSV (${parsed.total} rows, ${parsed.people.length} people); Fernanda: 1699 records, 252 highlighted municipalities, 14 explicit pending records.`);
    await upload('invalido.csv', Buffer.from('a;b\n1;2'));
    assert(!d.getElementById('bases-error').hidden);
    assert(w.BasesUI.hasSelection(), 'Failed import must preserve previous selection');
    d.getElementById('bases-clear').click();
    assert.equal(w.BasesUI.hasSelection(), false);
  }
  assert.equal(errors.length, 0, errors.map(e=>e.message).join('\n'));
  console.log('PASS: DOM + real Leaflet integration; dropdown, multiple sheets, person switches, markers, home/reset, failed-import recovery.');
  dom.window.close();
}
main().catch(error => {console.error(error); process.exitCode=1; process.exit(1);});
