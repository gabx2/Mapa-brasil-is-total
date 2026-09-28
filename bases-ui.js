(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const panel = el('bases-panel'), search = el('person-search'), options = el('person-options');
  const fileInput = el('bases-file'), upload = el('bases-upload'), sheetSelect = el('bases-sheet');
  const fmt = value => value.toLocaleString('pt-BR');
  const cityIndex = BasesData.createCityIndex(window.MUNICIPIOS_INDEX || []);
  const STAGES = [
    { key: 'quali', label: 'Qualificação', short: 'Qualificação' },
    { key: 'frio', label: 'Negociação Fria', short: 'Fria' },
    { key: 'morna', label: 'Negociação Morna', short: 'Morna' },
    { key: 'quente', label: 'Negociação Quente', short: 'Quente' }
  ];

  const slots = {
    quali: null,
    frio: null,
    morna: null,
    quente: null
  };

  const BasesStorage = {
    dbName: 'MapaBrasilBasesDB',
    version: 1,
    db: null,

    async open() {
      if (this.db) return this.db;
      if (typeof indexedDB === 'undefined') return null;
      return new Promise(resolve => {
        try {
          const req = indexedDB.open(this.dbName, this.version);
          req.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('slots')) {
              db.createObjectStore('slots', { keyPath: 'stage' });
            }
          };
          req.onsuccess = event => {
            this.db = event.target.result;
            resolve(this.db);
          };
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    },

    async saveSlot(stage, payload) {
      const db = await this.open();
      if (!db) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction('slots', 'readwrite');
          const store = tx.objectStore('slots');
          store.put({
            stage,
            fileName: payload.fileName || '',
            currentSheet: payload.currentSheet || '',
            names: payload.names || [],
            buffer: payload.buffer || null,
            dataset: payload.dataset || null,
            savedAt: Date.now()
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    },

    async removeSlot(stage) {
      const db = await this.open();
      if (!db) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction('slots', 'readwrite');
          const store = tx.objectStore('slots');
          store.delete(stage);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    },

    async loadAllSlots() {
      const db = await this.open();
      if (!db) return [];
      return new Promise(resolve => {
        try {
          const tx = db.transaction('slots', 'readonly');
          const store = tx.objectStore('slots');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (_) {
          resolve([]);
        }
      });
    },

    async clearAll() {
      const db = await this.open();
      if (!db) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction('slots', 'readwrite');
          const store = tx.objectStore('slots');
          store.clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    }
  };

  async function initStorage() {
    try {
      const saved = await BasesStorage.loadAllSlots();
      if (!Array.isArray(saved) || !saved.length) return;
      let loadedAny = false;
      for (const item of saved) {
        if (!item || !item.stage || !item.dataset) continue;
        const stageObj = STAGES.find(s => s.key === item.stage);
        if (!stageObj) continue;

        let nextBook = null;
        if (item.buffer && window.XLSX && !/\.csv$/i.test(item.fileName || '')) {
          try {
            nextBook = XLSX.read(new Uint8Array(item.buffer), {type: 'array', cellFormula: false, cellHTML: false});
          } catch (_) {}
        }

        slots[item.stage] = {
          dataset: item.dataset,
          workbook: nextBook,
          fileName: item.fileName,
          names: item.names || [],
          currentSheet: item.currentSheet || '',
          buffer: item.buffer || null
        };
        updateSlotUI(item.stage);
        loadedAny = true;
      }
      if (loadedAny) {
        updateTabsUI();
        applyActiveDataset();
      }
    } catch (err) {
      console.warn('Erro ao restaurar planilhas salvas:', err);
    }
  }

  let currentStage = 'all';
  let activeImportStage = 'quali';
  let dataset = null, selected = null;
  let squads = null;
  let filtered = [], active = -1, importVersion = 0, selectionVersion = 0;
  let group = null, currentCities = new Map(), selectedCityId = null;
  const geometryCache = new Map();
  map.createPane('person-bases');
  map.getPane('person-bases').style.zIndex = 460;
  ['panel', 'upload-dock'].forEach(id => {
    const element = el(id);
    if (element && window.L?.DomEvent) {
      L.DomEvent.disableClickPropagation(element);
      L.DomEvent.disableScrollPropagation(element);
    }
  });

  function error(message = '') {
    el('bases-error').textContent = message;
    el('bases-error').hidden = !message;
  }
  function getActiveDataset() {
    if (currentStage === 'all') {
      const activeSlots = Object.values(slots).filter(Boolean);
      if (!activeSlots.length) return null;
      return filterScope(BasesData.combineDatasets(activeSlots.map(s => s.dataset)));
    }
    return filterScope(slots[currentStage]?.dataset || null);
  }

  function filterScope(source) {
    return BasesData.filterBySquad(BasesData.filterByState(source, siglaAtual, cityIndex), squads?.active(), cityIndex);
  }

  function getFirstEmptyStage() {
    for (const s of STAGES) {
      if (!slots[s.key]) return s.key;
    }
    return 'quali';
  }

  function updateSlotUI(stage) {
    const slotEl = el(`slot-${stage}`);
    if (!slotEl) return;
    const slot = slots[stage];
    const removeBtn = slotEl.querySelector('.slot-remove');
    const infoEl = slotEl.querySelector('.slot-info');
    if (slot) {
      slotEl.classList.add('is-loaded');
      if (infoEl) infoEl.textContent = `✓ ${fmt(slot.dataset.total)} reg.`;
      if (removeBtn) removeBtn.hidden = false;
    } else {
      slotEl.classList.remove('is-loaded');
      if (infoEl) infoEl.textContent = 'Aguardando XLS';
      if (removeBtn) removeBtn.hidden = true;
    }
  }

  function updateTabsUI() {
    let totalAll = 0;
    STAGES.forEach(s => {
      const slot = slots[s.key];
      const count = slot ? filterScope(slot.dataset).total : 0;
      totalAll += count;
      const countEl = el(`tab-count-${s.key}`);
      if (countEl) countEl.textContent = fmt(count);
      const tabEl = document.querySelector(`.stage-tab[data-stage="${s.key}"]`);
      if (tabEl) {
        tabEl.disabled = !slot;
        tabEl.title = slot ? `${s.label} (${fmt(count)} registros)` : `${s.label} (nenhuma planilha importada)`;
      }
    });
    const countAllEl = el('tab-count-all');
    if (countAllEl) countAllEl.textContent = fmt(totalAll);
    const tabAllEl = document.querySelector('.stage-tab[data-stage="all"]');
    if (tabAllEl) {
      tabAllEl.disabled = totalAll === 0;
    }
  }

  function removeSlot(stage) {
    if (!slots[stage]) return;
    slots[stage] = null;
    BasesStorage.removeSlot(stage);
    updateSlotUI(stage);
    updateTabsUI();
    if (currentStage === stage) {
      switchStage('all');
    } else {
      applyActiveDataset();
    }
  }

  function switchStage(stage) {
    if (stage !== 'all' && !slots[stage]) return;
    currentStage = stage;
    document.querySelectorAll('.stage-tab').forEach(btn => {
      const active = btn.dataset.stage === stage;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    applyActiveDataset();
  }

  function applyActiveDataset() {
    dataset = getActiveDataset();
    if (!dataset) {
      dataset = null;
      clearSelection();
      search.disabled = true;
      el('person-toggle').disabled = true;
      search.placeholder = 'Importe uma planilha para buscar';
      return;
    }
    search.disabled = false;
    el('person-toggle').disabled = false;
    const stageObj = STAGES.find(s => s.key === currentStage);
    search.placeholder = currentStage === 'all'
      ? 'Buscar pessoa ou TOTAL…'
      : `Buscar em ${stageObj?.label || currentStage}…`;

    if (!selected) {
      showPerson(dataset.totalItem);
    } else {
      if (selected.isTotal) {
        showPerson(dataset.totalItem);
      } else {
        const matching = dataset.people.find(p => p.id === selected.id);
        if (matching) {
          showPerson(matching);
        } else {
          selectionVersion++;
          removeMapLayer();
          el('bases-cities').replaceChildren();
          const contactsEl = el('bases-contacts');
          if (contactsEl) contactsEl.hidden = true;
          el('bases-summary').textContent = `${selected.name} não possui registros ${currentStage === 'all' ? 'no total' : `em ${stageObj?.label || 'esta etapa'}`}${siglaAtual ? ` em ${ESTADOS[siglaAtual].nome}` : ''}.`;
          el('bases-fit').disabled = true;
          el('bases-pending').hidden = true;
        }
      }
    }
    if (!options.hidden) {
      renderPeople();
    }
  }

  function closePeople() {
    options.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    search.value = selected?.name || '';
    active = -1;
  }
  function renderPeople() {
    const query = BasesData.normalize(search.value);
    const list = [];
    if (!dataset) {
      filtered = [];
      options.replaceChildren();
      return;
    }
    if (dataset.totalItem && (!query || BasesData.normalize('TOTAL').includes(query))) {
      list.push(dataset.totalItem);
    }
    list.push(...dataset.people.filter(p => BasesData.normalize(p.name).includes(query)));
    filtered = list;
    active = -1;
    options.replaceChildren();
    search.removeAttribute('aria-activedescendant');
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-options'; empty.textContent = 'Nenhuma pessoa encontrada.';
      options.append(empty);
    }
    filtered.forEach((person, index) => {
      const row = document.createElement('div');
      row.id = `person-option-${index}`; row.className = 'person-option';
      if (person.isTotal) row.classList.add('person-option-total');
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      const name = document.createElement('span'); name.textContent = person.name;
      const count = document.createElement('small');
      const stageObj = STAGES.find(s => s.key === currentStage);
      const stageSuffix = currentStage === 'all' ? 'Todas as bases' : (stageObj ? stageObj.label : currentStage);
      count.textContent = person.isTotal
        ? `${fmt(person.records.length)} registros · ${stageSuffix}`
        : `${fmt(person.records.length)} registros`;
      row.append(name, count);
      row.onmousedown = event => event.preventDefault();
      row.onclick = () => showPerson(person);
      options.append(row);
    });
  }
  function openPeople() {
    if (!dataset) return;
    closeOptions(); search.value = '';
    options.hidden = false; search.setAttribute('aria-expanded', 'true');
    renderPeople();
  }

  function deselectCity() {
    if (!selectedCityId) return;
    const prev = currentCities.get(selectedCityId);
    if (prev) {
      prev.button?.classList.remove('is-active');
      prev.layer?.setStyle(prev.heatStyle);
    }
    selectedCityId = null;
    const contacts = el('bases-contacts');
    if (contacts) contacts.hidden = true;
  }

  function renderContacts(city) {
    const section = el('bases-contacts');
    if (!section) return;
    section.hidden = false;
    const titleEl = el('bases-contacts-title');
    if (titleEl) titleEl.textContent = `Contatos em ${city.name} · ${city.uf}`;
    const count = city.records ? city.records.length : 0;
    const countEl = el('bases-contacts-count');
    if (countEl) countEl.textContent = `${fmt(count)} ${count === 1 ? 'registro' : 'registros'}`;

    const list = el('bases-contacts-list');
    list.replaceChildren();

    if (!count) {
      const empty = document.createElement('p');
      empty.className = 'bases-note';
      empty.textContent = 'Nenhum contato encontrado neste município.';
      list.append(empty);
      return;
    }

    city.records.forEach(rec => {
      const card = document.createElement('div');
      card.className = 'base-contact-card';

      const nameEl = document.createElement('div');
      nameEl.className = 'base-contact-name';
      const nameText = document.createElement('span');
      if (rec.contactName) {
        nameText.textContent = rec.contactName;
      } else {
        nameText.classList.add('is-empty');
        nameText.textContent = 'Nome não informado';
      }
      nameEl.append(nameText);

      if (rec.stage) {
        const stageBadge = document.createElement('span');
        stageBadge.className = `contact-stage-badge contact-stage-${rec.stage}`;
        const stageObj = STAGES.find(s => s.key === rec.stage);
        stageBadge.textContent = stageObj ? stageObj.short : rec.stage;
        nameEl.append(stageBadge);
      }

      const phoneEl = document.createElement('div');
      phoneEl.className = 'base-contact-phone';
      if (rec.contactPhone) {
        const rawDigits = rec.contactPhone.replace(/\D/g, '');
        if (rawDigits.length >= 8) {
          const link = document.createElement('a');
          link.href = `tel:${rawDigits}`;
          link.textContent = rec.contactPhone;
          phoneEl.append(document.createTextNode('📞 '), link);
        } else {
          phoneEl.textContent = `📞 ${rec.contactPhone}`;
        }
      } else {
        phoneEl.classList.add('is-empty');
        phoneEl.textContent = 'Telefone não informado';
      }

      card.append(nameEl, phoneEl);
      list.append(card);
    });
  }

  function selectCity(cityId, fit = true) {
    if (!currentCities.has(cityId)) return false;
    if (selectedCityId && selectedCityId !== cityId) {
      const prev = currentCities.get(selectedCityId);
      if (prev) {
        prev.button?.classList.remove('is-active');
        prev.layer?.setStyle(prev.heatStyle);
      }
    }
    selectedCityId = cityId;
    const { city, layer, button, heatStyle } = currentCities.get(cityId);
    button?.classList.add('is-active');
    button?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    layer?.setStyle({
      fillOpacity: Math.min(1, heatStyle.fillOpacity + 0.22),
      weight: 2.5,
      color: '#991b1b'
    });
    layer?.bringToFront();

    if (fit && layer) fitArea(layer, false);
    renderContacts(city);
    return true;
  }

  function removeMapLayer() {
    deselectCity();
    if (group) group.remove();
    group = null; currentCities.clear();
  }
  function clearSelection() {
    selectionVersion++;
    selected = null;
    deselectCity();
    removeMapLayer();
    closePeople();
    el('bases-results').hidden = true;
    el('bases-clear').hidden = true;
    if (!siglaAtual) setStateDetail(false);
  }
  function fitBases() {
    deselectCity();
    if (siglaAtual && municipiosLayer) fitArea(municipiosLayer, false);
    else if (estadosLayer) fitArea(estadosLayer, false);
  }
  function tooltip(city) {
    const box = document.createElement('div'); box.className = 'base-map-tooltip';
    const title = document.createElement('strong'); title.textContent = `${city.name} · ${city.uf}`;
    const count = document.createElement('span');
    count.textContent = selected?.isTotal
      ? `${fmt(city.count)} registros no total`
      : `${fmt(city.count)} registros de ${selected.name}`;
    box.append(title, count); return box;
  }
  async function getGeometry(uf) {
    if (!geometryCache.has(uf)) {
      const promise = loadMalha(uf).then(topology => {
        const features = topojson.feature(topology, Object.values(topology.objects)[0]).features;
        return new Map(features.map(f => [String(f.properties.CD_MUN), f]));
      }).catch(err => {geometryCache.delete(uf); throw err;});
      geometryCache.set(uf, promise);
    }
    return geometryCache.get(uf);
  }
  async function showPerson(person, autoFit = false) {
    const version = ++selectionVersion;
    selected = person; closePeople(); clearStateRelief(); error();
    removeMapLayer();
    el('bases-clear').hidden = false;
    el('bases-results').hidden = false;
    el('bases-person-name').textContent = person.name;
    el('bases-summary').textContent = 'Localizando as bases no mapa…';
    el('bases-cities').replaceChildren();
    el('bases-pending').hidden = true;
    el('bases-fit').disabled = true;
    await mapaPronto;
    if (version !== selectionVersion) return;
    if (!estadosLayer) {
      el('bases-summary').textContent = 'Não foi possível carregar o mapa.';
      error('Recarregue a página para tentar novamente.');
      return;
    }
    const result = BasesData.locatePerson(person, cityIndex);
    const ufs = [...new Set(result.cities.map(city => city.uf))];
    const geometry = new Map(), failed = new Set();
    let next = 0;
    // Limit parallel local file loads; stale selections never replace the latest one.
    await Promise.all(Array.from({length: Math.min(4, ufs.length)}, async () => {
      while (next < ufs.length && version === selectionVersion) {
        const uf = ufs[next++];
        try { geometry.set(uf, await getGeometry(uf)); }
        catch { failed.add(uf); }
      }
    }));
    if (version !== selectionVersion) return;
    setStateDetail(true);
    group = L.featureGroup().addTo(map);
    const unresolved = [...result.unresolved];
    let located = 0;
    const counts = result.cities.map(c => c.count);
    const maxCount = counts.length ? Math.max(...counts) : 1;
    const minCount = counts.length ? Math.min(...counts) : 1;
    const logMin = Math.log(Math.max(minCount, 1));
    const logMax = Math.log(Math.max(maxCount, 1));

    function getHeatStyle(count) {
      const t = logMax === logMin ? 1 : (Math.log(Math.max(count, 1)) - logMin) / (logMax - logMin);
      const r = 255;
      const g = Math.round(226 - t * (226 - 13));
      const b = Math.round(230 - t * (230 - 54));
      const toHex = n => n.toString(16).padStart(2, '0');
      const fillColor = '#' + toHex(r) + toHex(g) + toHex(b);
      const fillOpacity = parseFloat((0.55 + t * 0.35).toFixed(2));
      const borderColor = t > 0.4 ? '#e90835' : '#f87171';
      const weight = t > 0.7 ? 1.3 : (t > 0.4 ? 1.1 : 0.9);
      return { fillColor, fillOpacity, color: borderColor, weight, opacity: 1 };
    }

    const layersToAdd = [];
    for (const city of result.cities) {
      const feature = geometry.get(city.uf)?.get(city.id);
      if (!feature) {
        unresolved.push({value: `${city.name}/${city.uf}`, reason: 'Malha indisponível; selecione novamente para tentar', count: city.count});
        continue;
      }
      const heatStyle = getHeatStyle(city.count);
      const layer = L.geoJSON(feature, {
        pane: 'person-bases', smoothFactor: 0,
        style: heatStyle
      });
      layer.bindTooltip(tooltip(city), {sticky: true, opacity: 1});
      layer.on('mouseover', function() {
        this.setStyle({ fillOpacity: Math.min(1, heatStyle.fillOpacity + 0.18), weight: 2 });
      });
      layer.on('mouseout', function() {
        if (selectedCityId === city.id) {
          this.setStyle({ fillOpacity: Math.min(1, heatStyle.fillOpacity + 0.22), weight: 2.5, color: '#991b1b' });
        } else {
          this.setStyle(heatStyle);
        }
      });
      layer.on('click', () => selectCity(city.id, true));
      layersToAdd.push(layer);
      located += city.count;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'base-city';
      const indicator = document.createElement('i');
      indicator.className = 'city-heat-pill';
      indicator.style.backgroundColor = heatStyle.fillColor;
      const label = document.createElement('span'); label.textContent = `${city.name} · ${city.uf}`;
      const count = document.createElement('small'); count.textContent = `${fmt(city.count)} registros`;
      button.append(indicator, label, count);
      button.onmouseenter = () => {
        if (selectedCityId !== city.id) layer.setStyle({ fillOpacity: 1, weight: 2.2 });
      };
      button.onmouseleave = () => {
        if (selectedCityId !== city.id) layer.setStyle(heatStyle);
      };
      button.onclick = () => selectCity(city.id, true);
      el('bases-cities').append(button);
      currentCities.set(city.id, {city, layer, button, heatStyle});
    }
    for (let i = layersToAdd.length - 1; i >= 0; i--) {
      group.addLayer(layersToAdd[i]);
    }
    const pending = unresolved.reduce((sum, item) => sum + item.count, 0);
    const stageObj = STAGES.find(s => s.key === currentStage);
    const stageSuffix = currentStage === 'all' ? 'no total' : `em ${stageObj?.label || currentStage}`;
    el('bases-summary').textContent = selected?.isTotal
      ? `${fmt(located)} de ${fmt(result.total)} registros ${stageSuffix} em ${fmt(currentCities.size)} municípios.`
      : `${fmt(located)} de ${fmt(result.total)} registros localizados ${stageSuffix} em ${fmt(currentCities.size)} municípios.`;
    if (siglaAtual) el('bases-summary').textContent += ` Estado: ${ESTADOS[siglaAtual].nome}.`;
    el('bases-fit').disabled = !currentCities.size;
    const pendingList = el('bases-pending-list'); pendingList.replaceChildren();
    el('bases-pending').hidden = !pending;
    el('bases-pending').open = !located && pending > 0;
    el('bases-pending-title').textContent = `${fmt(pending)} registros não localizados`;
    unresolved.forEach(item => {
      const line = document.createElement('p');
      line.textContent = `${item.value} (${fmt(item.count)}) — ${item.reason}`;
      pendingList.append(line);
    });
    if (failed.size) error(`Não foi possível abrir a malha de ${[...failed].join(', ')}. Selecione a pessoa novamente para tentar.`);
    if (autoFit && estadosLayer) fitArea(estadosLayer, false);
  }

  function readSheet(book, name) {
    const sheet = book.Sheets[name];
    if (!sheet?.['!ref']) return [];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r >= 200000) throw new Error('A aba excede 200 mil linhas. Divida o arquivo antes de importar.');
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1, defval: '', raw: false, blankrows: true,
      range: {s: {r: 0, c: 0}, e: {r: range.e.r, c: 15}}
    });
  }
  async function importFile(file, stage = 'quali') {
    if (!file) return;
    error();
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { error('Escolha um arquivo CSV, XLS ou XLSX.'); return; }
    if (file.size > 40 * 1024 * 1024) { error('O arquivo excede 40 MB. Divida-o antes de importar.'); return; }
    const stageObj = STAGES.find(s => s.key === stage) || STAGES[0];
    const slotEl = el(`slot-${stageObj.key}`);
    const version = ++importVersion;
    if (slotEl) {
      const info = slotEl.querySelector('.slot-info');
      if (info) info.textContent = 'Lendo…';
    }
    upload.disabled = true;
    el('bases-file-status').textContent = `Lendo planilha de ${stageObj.label}…`;
    try {
      const buffer = await file.arrayBuffer();
      if (version !== importVersion) return;
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      let rows, nextBook = null, names = [], name = '';
      if (/\.csv$/i.test(file.name)) rows = BasesData.parseCSV(BasesData.decodeCSV(buffer));
      else {
        if (!window.XLSX) throw new Error('O leitor de Excel não carregou. Reabra o mapa ou importe a versão CSV.');
        nextBook = XLSX.read(new Uint8Array(buffer), {type: 'array', cellFormula: false, cellHTML: false});
        names = nextBook.SheetNames;
        for (const candidate of names) {
          const candidateRows = readSheet(nextBook, candidate);
          if (BasesData.headerIndex(candidateRows) >= 0) { rows = candidateRows; name = candidate; break; }
        }
        if (!rows) throw new Error('Nenhuma aba contém Nome/IS Atual na coluna D e Cidade/UF na coluna O.');
      }
      if (version !== importVersion) return;
      const imported = BasesData.importRows(rows, { stage: stageObj.key, stageLabel: stageObj.label });
      slots[stageObj.key] = {
        dataset: imported,
        workbook: nextBook,
        fileName: file.name,
        names,
        currentSheet: name,
        buffer
      };
      BasesStorage.saveSlot(stageObj.key, {
        fileName: file.name,
        currentSheet: name,
        names,
        buffer,
        dataset: imported
      });
      updateSlotUI(stageObj.key);
      updateTabsUI();
      applyActiveDataset();
      search.focus();
    } catch (err) {
      if (version !== importVersion) return;
      error(err.message || 'Não foi possível ler o arquivo.');
      updateSlotUI(stageObj.key);
    } finally {
      if (version === importVersion) upload.disabled = false;
      fileInput.value = '';
    }
  }

  // Setup 2x2 upload slots
  document.querySelectorAll('.upload-slot').forEach(slot => {
    const stage = slot.dataset.stage;
    slot.onclick = event => {
      if (event.target.closest('.slot-remove')) return;
      activeImportStage = stage;
      fileInput.click();
    };
    slot.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activeImportStage = stage;
        fileInput.click();
      }
    };
    const removeBtn = slot.querySelector('.slot-remove');
    if (removeBtn) {
      removeBtn.onclick = event => {
        event.stopPropagation();
        removeSlot(stage);
      };
    }
    slot.addEventListener('dragover', event => {
      event.preventDefault();
      event.stopPropagation();
      slot.classList.add('is-dragging');
    });
    slot.addEventListener('dragleave', event => {
      if (!slot.contains(event.relatedTarget)) slot.classList.remove('is-dragging');
    });
    slot.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      slot.classList.remove('is-dragging');
      if (event.dataTransfer.files.length !== 1) {
        error('Importe uma planilha de cada vez.');
        return;
      }
      activeImportStage = stage;
      importFile(event.dataTransfer.files[0], stage);
    });
  });

  // Stage switcher tabs
  document.querySelectorAll('.stage-tab').forEach(btn => {
    btn.onclick = () => {
      if (!btn.disabled) {
        switchStage(btn.dataset.stage);
      }
    };
  });

  upload.onclick = () => {
    activeImportStage = currentStage !== 'all' ? currentStage : 'quali';
    fileInput.click();
  };
  fileInput.onchange = () => {
    if (fileInput.files.length) {
      importFile(fileInput.files[0], activeImportStage);
    }
  };

  const dropTargets = [el('upload-dock'), panel].filter(Boolean);
  dropTargets.forEach(target => {
    target.addEventListener('dragover', event => {
      event.preventDefault();
      target.classList.add('is-dragging');
    });
    target.addEventListener('dragleave', event => {
      if (!target.contains(event.relatedTarget)) target.classList.remove('is-dragging');
    });
    target.addEventListener('drop', event => {
      event.preventDefault();
      target.classList.remove('is-dragging');
      if (event.dataTransfer.files.length !== 1) {
        error('Importe uma planilha de cada vez.');
        return;
      }
      const targetStage = currentStage !== 'all' ? currentStage : getFirstEmptyStage();
      activeImportStage = targetStage;
      importFile(event.dataTransfer.files[0], targetStage);
    });
  });

  let previousSheet = '';
  sheetSelect.addEventListener('focus', () => {previousSheet = sheetSelect.value;});
  sheetSelect.onchange = () => {
    const slot = slots[activeImportStage] || slots.quali;
    if (!slot?.workbook) return;
    try {
      const rows = readSheet(slot.workbook, sheetSelect.value);
      const stageObj = STAGES.find(s => s.key === activeImportStage) || STAGES[0];
      const imported = BasesData.importRows(rows, { stage: stageObj.key, stageLabel: stageObj.label });
      slot.dataset = imported;
      slot.currentSheet = sheetSelect.value;
      BasesStorage.saveSlot(stageObj.key, {
        fileName: slot.fileName,
        currentSheet: slot.currentSheet,
        names: slot.names,
        buffer: slot.buffer,
        dataset: imported
      });
      updateSlotUI(stageObj.key);
      updateTabsUI();
      applyActiveDataset();
      previousSheet = sheetSelect.value;
    } catch (err) {
      sheetSelect.value = previousSheet;
      error(err.message);
    }
  };

  search.addEventListener('focus', openPeople);
  search.addEventListener('click', () => {if (options.hidden) openPeople();});
  search.addEventListener('input', () => {options.hidden = false; search.setAttribute('aria-expanded', 'true'); renderPeople();});
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') {closePeople(); if (event.key === 'Escape') event.stopPropagation(); return;}
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.hidden) openPeople();
      if (!filtered.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      [...options.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
      const option = options.children[active];
      search.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter' && !options.hidden) {
      event.preventDefault(); const person = filtered[active < 0 ? 0 : active]; if (person) showPerson(person);
    }
  });

  el('person-toggle').onclick = () => {if (options.hidden) {search.focus(); if (options.hidden) openPeople();} else closePeople();};
  el('bases-clear').onclick = () => {clearSelection(); error();};
  el('bases-fit').onclick = fitBases;
  const contactsClose = el('bases-contacts-close');
  if (contactsClose) contactsClose.onclick = () => deselectCity();
  document.addEventListener('pointerdown', event => {if (!event.target.closest('.person-picker')) closePeople();});
  panel.addEventListener('focusout', event => {if (!event.relatedTarget?.closest?.('.person-picker')) closePeople();});

  window.BasesUI = {
    refreshState: () => { updateTabsUI(); applyActiveDataset(); },
    hasSelection: () => !!selected,
    clearSelection,
    fit: fitBases,
    selectCity,
    deselectCity,
    switchStage,
    removeSlot,
    getSlots: () => slots,
    getStage: () => currentStage,
    importFile,
    storage: BasesStorage,
    initStorage
  };

  squads = window.createSquadsUI({
    states: ESTADOS,
    getDataset: () => BasesData.combineDatasets(Object.values(slots).filter(Boolean).map(slot => slot.dataset)),
    onChange: () => {
      clearSelection();
      updateTabsUI();
      applyActiveDataset();
    }
  });
  initStorage();
})();
