(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BasesData = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const COLUMNS = Object.freeze({ contactName: 2, person: 3, contactPhone: 4, stock: 6, city: 14, tags: 15 });
  const text = value => String(value ?? '').trim();
  const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const cityKey = value => normalize(value).replace(/[^a-z0-9]/g, '');
  const missing = value => !text(value) || /^[-–—]+$/.test(text(value));

  function decodeCSV(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('windows-1252').decode(bytes); }
  }

  function parseCSV(input) {
    let source = input.replace(/^\uFEFF/, '');
    const directive = source.match(/^sep=(.)\r?\n/i);
    let separator = directive?.[1];
    if (directive) source = source.slice(directive[0].length);
    if (!separator) {
      const counts = { ';': 0, ',': 0, '\t': 0 };
      let quoted = false;
      for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '"') { if (quoted && source[i + 1] === '"') i++; else quoted = !quoted; }
        else if (!quoted && (c === '\n' || c === '\r')) break;
        else if (!quoted && Object.hasOwn(counts, c)) counts[c]++;
      }
      separator = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    }
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        if (quoted && source[i + 1] === '"') { field += '"'; i++; }
        else if (quoted || !field) quoted = !quoted;
        else field += c;
      } else if (c === separator && !quoted) { row.push(field); field = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) {
        row.push(field); rows.push(row); row = []; field = '';
        if (c === '\r' && source[i + 1] === '\n') i++;
      } else field += c;
    }
    if (quoted) throw new Error('O CSV tem um campo com aspas sem fechamento. Exporte o arquivo novamente.');
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function headerIndex(rows) {
    return rows.slice(0, 30).findIndex(row => {
      const person = normalize(row[COLUMNS.person]);
      const city = normalize(row[COLUMNS.city]);
      return /^(is atual|nome|pessoa|responsavel|consultor|consultora)$/.test(person)
        && /^(cidade(?:\s*\/\s*uf)?|municipio(?:\s*\/\s*uf)?)$/.test(city);
    });
  }

  function importRows(rows, options = {}) {
    const start = headerIndex(rows);
    if (start < 0) throw new Error('Confira o cabeçalho: a coluna D deve ser Nome ou IS Atual, e a coluna O deve ser Cidade/UF.');
    const stage = options.stage || '';
    const stageLabel = options.stageLabel || '';
    const people = new Map();
    const allRecords = [];
    let skipped = 0, total = 0;
    rows.slice(start + 1).forEach((row, offset) => {
      if (!row.some(value => !missing(value))) return;
      if (normalize(row[COLUMNS.person]) === normalize(rows[start][COLUMNS.person])
        && normalize(row[COLUMNS.city]) === normalize(rows[start][COLUMNS.city])) return;
      total++;
      const personName = text(row[COLUMNS.person]);
      const rec = {
        row: start + offset + 2,
        contactName: text(row[COLUMNS.contactName]),
        person: personName,
        contactPhone: text(row[COLUMNS.contactPhone]),
        city: text(row[COLUMNS.city]),
        // Optional squad filters; geographic matching uses city only.
        tags: text(row[COLUMNS.tags]),
        stock: text(row[COLUMNS.stock]),
        stage,
        stageLabel
      };
      allRecords.push(rec);
      if (missing(personName)) { skipped++; return; }
      const id = normalize(personName);
      if (!people.has(id)) people.set(id, { id, name: personName, records: [] });
      people.get(id).records.push(rec);
    });
    if (!people.size && !allRecords.length) throw new Error('Nenhum dado encontrado na coluna D.');
    const totalItem = {
      id: '__total__',
      name: 'TOTAL',
      isTotal: true,
      records: allRecords
    };
    return {
      people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      totalItem,
      allRecords,
      skipped,
      total,
      stage,
      stageLabel
    };
  }

  function combineDatasets(slotDatasets) {
    const people = new Map();
    const allRecords = [];
    let skipped = 0, total = 0;
    const datasets = Array.isArray(slotDatasets) ? slotDatasets : Object.values(slotDatasets || {});
    for (const dataset of datasets) {
      if (!dataset) continue;
      skipped += dataset.skipped || 0;
      total += dataset.total || 0;
      if (dataset.allRecords) {
        allRecords.push(...dataset.allRecords);
      }
      if (dataset.people) {
        for (const p of dataset.people) {
          if (!people.has(p.id)) {
            people.set(p.id, { id: p.id, name: p.name, records: [] });
          }
          people.get(p.id).records.push(...p.records);
        }
      }
    }
    const totalItem = {
      id: '__total__',
      name: 'TOTAL',
      isTotal: true,
      records: allRecords
    };
    return {
      people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      totalItem,
      allRecords,
      skipped,
      total
    };
  }

  function createCityIndex(cities) {
    const byName = new Map(), byState = new Map();
    cities.forEach(city => {
      const key = cityKey(city.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(city);
      byState.set(`${key}/${city.uf}`, city);
    });
    return { byName, byState };
  }

  function resolveCity(value, index) {
    if (missing(value)) return { reason: 'Cidade não informada' };
    const match = text(value).match(/^(.*?)\s*(?:\/|\s+-\s*|,\s*|\()\s*([A-Za-z]{2})\)?\s*$/);
    if (match) {
      const city = index.byState.get(`${cityKey(match[1])}/${match[2].toUpperCase()}`);
      return city ? { city } : { reason: 'Cidade/UF não encontrada na malha' };
    }
    const candidates = index.byName.get(cityKey(value)) || [];
    if (candidates.length === 1) return { city: candidates[0] };
    return { reason: candidates.length ? 'Há cidades homônimas; informe a UF' : 'Cidade não encontrada na malha' };
  }

  function filterByState(dataset, uf, index) {
    if (!dataset || !uf) return dataset;
    const belongs = record => {
      const resolved = resolveCity(record.city, index).city;
      // Keep invalid city names with an explicit UF in that state's pending list.
      const explicit = text(record.city).match(/(?:\/|\s+-\s*|,\s*|\()\s*([A-Za-z]{2})\)?\s*$/);
      return (resolved?.uf || explicit?.[1].toUpperCase()) === uf;
    };
    const allRecords = dataset.allRecords.filter(belongs);
    const people = dataset.people.map(person => ({...person, records: person.records.filter(belongs)}))
      .filter(person => person.records.length);
    return {...dataset, allRecords, people, total: allRecords.length,
      totalItem: {...dataset.totalItem, records: allRecords}};
  }

  function parseStock(value) {
    const source = normalize(value);
    // The leading quantity is authoritative; parenthesized numbers describe a category range.
    const classified = source.match(/^([+-]?\d[\d., ]*)\s+(?:pequeno|medio|grande|enterprise)(?:\s*\([^)]*\))?$/);
    let raw = (classified ? classified[1] : source).replace(/\s/g, '');
    if (!raw) return null;
    if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '');
    raw = raw.replace(',', '.');
    if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function splitTags(value) {
    return text(value).split(/[;,|\n]+/).map(text).filter(Boolean);
  }

  function tagKey(value) {
    const normalized = normalize(value);
    const compact = normalized.replace(/[\s\-–—]+/g, '');
    if (compact.includes('excliente') || compact === 'reativa') return 'ex-cliente';
    return normalized;
  }

  function filterBySquad(dataset, squad, index) {
    if (!dataset || !squad) return dataset;
    const members = new Set(squad.members.map(normalize));
    // Support both legacy single tag and new multi-tag array
    const rawTags = Array.isArray(squad.tags) ? squad.tags : (squad.tag ? [squad.tag] : []);
    const tagKeys = rawTags.map(t => tagKey(t)).filter(Boolean);
    const matches = record => {
      if (members.size && !members.has(normalize(record.person))) return false;
      if (squad.states.length) {
        const explicit = text(record.city).match(/(?:\/|\s+-\s*|,\s*|\()\s*([A-Za-z]{2})\)?\s*$/);
        const uf = resolveCity(record.city, index).city?.uf || explicit?.[1].toUpperCase();
        if (!squad.states.includes(uf)) return false;
      }
      if (tagKeys.length) {
        const recordTagKeys = splitTags(record.tags).map(value => tagKey(value));
        if (!tagKeys.some(tk => recordTagKeys.includes(tk))) return false;
      }
      if (squad.stock) {
        const value = parseStock(record.stock);
        if (value === null) return false;
        const target = squad.stock.value;
        const comparisons = {gte: value >= target, gt: value > target, eq: value === target, lte: value <= target, lt: value < target};
        if (!comparisons[squad.stock.op]) return false;
      }
      return true;
    };
    const allRecords = dataset.allRecords.filter(matches);
    const people = dataset.people.map(person => ({...person, records: person.records.filter(matches)}))
      .filter(person => person.records.length);
    return {...dataset, allRecords, people, total: allRecords.length,
      totalItem: {...dataset.totalItem, records: allRecords}};
  }

  function locatePerson(person, index) {
    const cities = new Map(), unresolved = new Map();
    for (const record of person.records) {
      const result = resolveCity(record.city, index);
      if (result.city) {
        const city = result.city;
        if (!cities.has(city.id)) cities.set(city.id, { ...city, records: [], count: 0 });
        const item = cities.get(city.id);
        item.records.push(record); item.count++;
      } else {
        const key = `${record.city}|${result.reason}`;
        if (!unresolved.has(key)) unresolved.set(key, { value: record.city || 'Sem cidade', reason: result.reason, count: 0 });
        unresolved.get(key).count++;
      }
    }
    return {
      cities: [...cities.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR')),
      unresolved: [...unresolved.values()],
      total: person.records.length
    };
  }
  return { COLUMNS, normalize, decodeCSV, parseCSV, headerIndex, importRows, combineDatasets, createCityIndex, resolveCity, filterByState, filterBySquad, parseStock, splitTags, tagKey, locatePerson };
});
