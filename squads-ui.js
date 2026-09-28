(function () {
  'use strict';
  const STORAGE_KEY = 'mapa-brasil-squads-v1';
  window.createSquadsUI = function ({states, getDataset, onChange}) {
    const el = id => document.getElementById(id);
    const dialog = el('squad-dialog'), form = el('squad-form'), select = el('squad-select');
    let squads = [], activeId = '', editingId = null;
    let tagChoices = [], tagLimit = 8;
    function getSelectedTagKeys() {
      return [...el('squad-tag-list').querySelectorAll('input:checked')].map(input => input.value);
    }
    function renderTagChoices() {
      const words = BasesData.normalize(el('squad-tag-search').value).split(/\s+/).filter(Boolean);
      const matches = tagChoices.filter(tag => words.every(word => BasesData.normalize(tag.label).includes(word)));
      const results = el('squad-tag-results'); results.replaceChildren();
      const selectedKeys = new Set(getSelectedTagKeys());
      for (const tag of matches.slice(0, tagLimit)) {
        const isSelected = selectedKeys.has(BasesData.tagKey(tag.label));
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'squad-tag-choice';
        button.setAttribute('aria-pressed', String(isSelected));
        const name = document.createElement('span'); name.textContent = tag.label;
        const count = document.createElement('small'); count.textContent = `${tag.count.toLocaleString('pt-BR')} registros`;
        button.append(name, count);
        button.onclick = () => {
          const key = BasesData.tagKey(tag.label);
          const existing = el('squad-tag-list').querySelector(`input[value="${CSS.escape(key)}"]`);
          if (existing) {
            existing.checked = !existing.checked;
            if (!existing.checked) existing.closest('label').remove();
          } else {
            tagCheckbox(el('squad-tag-list'), key, tag.label, true);
          }
          renderTagChoices();
        };
        results.append(button);
      }
      el('squad-tag-count').textContent = matches.length
        ? `${Math.min(tagLimit, matches.length)} de ${matches.length} tags${words.length ? ' encontradas' : ' · mais frequentes primeiro'}`
        : tagChoices.length ? 'Nenhuma tag corresponde à busca.' : 'Nenhuma tag encontrada nas planilhas importadas.';
      el('squad-tag-more').hidden = matches.length <= tagLimit;
    }
    const active = () => squads.find(squad => squad.id === activeId) || null;
    const trigger = el('squad-trigger'), menu = el('squad-menu');
    function closeMenu(focus = false) {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus();
    }
    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      (menu.querySelector('[aria-selected="true"]') || menu.firstElementChild)?.focus();
    }
    const valid = squad => squad && typeof squad.id === 'string' && typeof squad.name === 'string'
      && Array.isArray(squad.members) && squad.members.every(x => typeof x === 'string')
      && Array.isArray(squad.states) && squad.states.every(x => Object.hasOwn(states, x))
      && (typeof squad.tag === 'string' || (Array.isArray(squad.tags) && squad.tags.every(x => typeof x === 'string')))
      && (!squad.stock ||
        (['gte', 'gt', 'eq', 'lte', 'lt'].includes(squad.stock.op) && Number.isFinite(squad.stock.value)));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      squads = Array.isArray(saved.squads) ? saved.squads.filter(valid) : [];
      activeId = squads.some(s => s.id === saved.activeId) ? saved.activeId : '';
    } catch { el('squad-storage-status').textContent = 'Não foi possível ler os squads salvos neste navegador.'; }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({squads, activeId}));
        el('squad-storage-status').textContent = '';
      } catch {
        el('squad-storage-status').textContent = 'Squad disponível nesta sessão. O navegador não permitiu salvar; ele pode ser perdido ao fechar.';
      }
    }
    function render() {
      select.replaceChildren(new Option('Sem squad · todas as bases', ''));
      for (const squad of squads) select.add(new Option(squad.name, squad.id));
      select.value = activeId;
      el('squad-current').textContent = active()?.name || 'Sem squad · todas as bases';
      menu.replaceChildren();
      for (const option of select.options) {
        const button = document.createElement('button');
        button.type = 'button'; button.setAttribute('role', 'option'); button.tabIndex = -1;
        button.textContent = option.textContent;
        button.setAttribute('aria-selected', String(option.value === activeId));
        button.onclick = () => {select.value = option.value; closeMenu(true); select.onchange();};
        menu.append(button);
      }
      el('squad-edit').disabled = !active();
      const squad = active();
      const summary = [];
      if (squad) {
        summary.push(squad.members.length ? `${squad.members.length} pessoa(s)` : 'Todas as pessoas');
        summary.push(squad.states.length ? squad.states.join(', ') : 'Todos os estados');
        const squadTags = Array.isArray(squad.tags) ? squad.tags : (squad.tag ? [squad.tag] : []);
        if (squadTags.length) summary.push(`Tag${squadTags.length > 1 ? 's' : ''}: ${squadTags.join(', ')}`);
        if (squad.stock) summary.push(`Estoque ${ {gte: '≥', gt: '>', eq: '=', lte: '≤', lt: '<'}[squad.stock.op]} ${squad.stock.value.toLocaleString('pt-BR')}`);
      }
      el('squad-summary').textContent = summary.join(' · ');
    }
    function change() { persist(); render(); onChange(); }
    function checkbox(container, value, labelText, checked) {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.checked = checked;
      label.append(input, document.createTextNode(labelText)); container.append(label);
    }
    function tagCheckbox(container, key, labelText, checked) {
      const label = document.createElement('label');
      label.className = 'squad-tag-selected';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = key; input.checked = checked;
      input.hidden = true;
      const text = document.createElement('span'); text.textContent = labelText;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'squad-tag-remove'; remove.textContent = '✕';
      remove.title = 'Remover tag';
      remove.onclick = event => { event.preventDefault(); label.remove(); renderTagChoices(); };
      label.append(input, text, remove); container.append(label);
    }
    function open(squad = null) {
      closeMenu();
      editingId = squad?.id || null;
      form.reset();
      el('squad-member-status').textContent = '';
      el('squad-form-error').textContent = '';
      el('squad-dialog-title').textContent = squad ? 'Editar squad' : 'Criar squad';
      el('squad-delete').hidden = !squad;
      el('squad-name').value = squad?.name || '';
      const dataset = getDataset();
      const people = new Map((dataset?.people || []).map(p => [p.id, p.name]));
      for (const name of squad?.members || []) people.set(BasesData.normalize(name), name);
      el('squad-members').replaceChildren();
      for (const [id, name] of [...people].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) {
        checkbox(el('squad-members'), name, name, squad?.members.some(x => BasesData.normalize(x) === id));
      }
      el('squad-member-empty').hidden = people.size > 0;
      el('squad-states').replaceChildren();
      for (const [uf, state] of Object.entries(states).sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))) {
        checkbox(el('squad-states'), uf, `${uf} · ${state.nome}`, squad?.states.includes(uf));
      }
      el('squad-use-states').checked = !!squad?.states.length;
      const savedTags = Array.isArray(squad?.tags) ? squad.tags : (squad?.tag ? [squad.tag] : []);
      el('squad-use-tag').checked = savedTags.length > 0;
      const tags = new Map(), stocks = new Map();
      for (const record of dataset?.allRecords || []) {
        const seen = new Set();
        for (const tag of BasesData.splitTags(record.tags)) {
          const key = BasesData.tagKey(tag);
          if (/^[-–—]+$/.test(key) || seen.has(key)) continue;
          seen.add(key);
          if (!tags.has(key)) tags.set(key, {label: key === 'ex-cliente' ? 'Ex-cliente' : tag, count: 0});
          tags.get(key).count++;
        }
        const label = String(record.stock || '').trim();
        if (!label || /^[-–—]+$/.test(label)) continue;
        const key = BasesData.normalize(label);
        if (!stocks.has(key)) stocks.set(key, {label, value: BasesData.parseStock(label), count: 0});
        stocks.get(key).count++;
      }
      const sortedTags = [...tags.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
      tagChoices = [...sortedTags].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
      tagLimit = 8;
      el('squad-tag-search').value = '';
      // Populate selected tags list
      el('squad-tag-list').replaceChildren();
      for (const savedTag of savedTags) {
        const key = BasesData.tagKey(savedTag);
        const found = sortedTags.find(t => BasesData.tagKey(t.label) === key);
        tagCheckbox(el('squad-tag-list'), key, found?.label || savedTag, true);
      }
      renderTagChoices();
      el('squad-found-stocks').replaceChildren(new Option(stocks.size ? 'Selecione um estoque encontrado' : 'Nenhum estoque nas planilhas importadas', ''));
      for (const stock of [...stocks.values()].sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity) || a.label.localeCompare(b.label, 'pt-BR'))) {
        const option = new Option(`${stock.label} · ${stock.count.toLocaleString('pt-BR')} registros${stock.value === null ? ' (sem quantidade numérica)' : ''}`, String(stock.value));
        option.disabled = stock.value === null;
        el('squad-found-stocks').add(option);
      }
      el('squad-found-stocks').disabled = !stocks.size;
      el('squad-use-stock').checked = !!squad?.stock;
      el('squad-stock-op').value = squad?.stock?.op || 'gte';
      el('squad-stock-value').value = squad?.stock?.value.toLocaleString('pt-BR', {useGrouping: false, maximumFractionDigits: 10}) || '';
      toggleFields();
      // Set initial open/closed state for collapsible sections
      el('squad-section-members').open = true;
      el('squad-section-states').open = !squad;
      el('squad-section-tag').open = !squad;
      el('squad-section-stock').open = !squad;
      updateSectionBadges();
      dialog.showModal();
      el('squad-name').focus();
    }
    function toggleFields() {
      for (const kind of ['states', 'tag', 'stock']) {
        el(`squad-${kind}-fields`).hidden = !el(`squad-use-${kind}`).checked;
      }
    }
    const checkedValues = id => [...el(id).querySelectorAll('input:checked')].map(input => input.value);
    function updateSectionBadges() {
      // Members badge
      const memberCount = checkedValues('squad-members').length;
      el('squad-badge-members').textContent = memberCount ? `${memberCount} selecionada(s)` : 'Todas as pessoas';
      // States badge
      const stateCount = el('squad-use-states').checked ? checkedValues('squad-states').length : 0;
      el('squad-badge-states').textContent = el('squad-use-states').checked
        ? (stateCount ? `${stateCount} estado(s)` : 'Nenhum marcado')
        : 'Todos os estados';
      // Tag badge
      const tagCount = el('squad-use-tag').checked ? getSelectedTagKeys().length : 0;
      el('squad-badge-tag').textContent = el('squad-use-tag').checked
        ? (tagCount ? `${tagCount} tag(s)` : 'Nenhuma selecionada')
        : 'Sem filtro';
      // Stock badge
      const stockVal = el('squad-stock-value').value.trim();
      const stockOp = el('squad-stock-op').value;
      const opLabels = {gte: '≥', gt: '>', eq: '=', lte: '≤', lt: '<'};
      el('squad-badge-stock').textContent = el('squad-use-stock').checked
        ? (stockVal ? `${opLabels[stockOp] || ''} ${stockVal}` : 'Sem valor')
        : 'Sem filtro';
    }
    form.onsubmit = event => {
      event.preventDefault();
      const name = el('squad-name').value.trim();
      const members = checkedValues('squad-members');
      const chosenStates = el('squad-use-states').checked ? checkedValues('squad-states') : [];
      const chosenTags = el('squad-use-tag').checked ? getSelectedTagKeys() : [];
      const stock = el('squad-use-stock').checked ? {
        op: el('squad-stock-op').value, value: BasesData.parseStock(el('squad-stock-value').value)
      } : null;
      let error = '';
      if (!name) error = 'Dê um nome ao squad.';
      else if (squads.some(s => s.id !== editingId && BasesData.normalize(s.name) === BasesData.normalize(name))) error = 'Já existe um squad com esse nome.';
      else if (el('squad-use-states').checked && !chosenStates.length) error = 'Marque pelo menos um estado ou desative o filtro de estados.';
      else if (el('squad-use-tag').checked && !chosenTags.length) error = 'Selecione pelo menos uma tag ou desative o filtro de tag.';
      else if (stock && stock.value === null) error = 'Informe um estoque numérico válido, por exemplo 500 ou 1.000.';
      else if (!chosenStates.length && !chosenTags.length && !stock) error = 'Escolha pelo menos um filtro: estado, tag ou estoque.';
      if (error) { el('squad-form-error').textContent = error; return; }
      const squad = {id: editingId || `squad-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, members, states: chosenStates, tags: chosenTags, tag: '', stock};
      if (editingId) squads = squads.map(s => s.id === editingId ? squad : s);
      else squads.push(squad);
      activeId = squad.id;
      dialog.close(); change();
    };
    el('squad-new').onclick = () => open();
    el('squad-edit').onclick = () => open(active());
    el('squad-cancel').onclick = () => dialog.close();
    el('squad-tag-search').oninput = () => {tagLimit = 8; renderTagChoices();};
    el('squad-tag-search').onkeydown = event => {if (event.key === 'Enter') event.preventDefault();};
    el('squad-tag-more').onclick = () => {tagLimit += 8; renderTagChoices();};
    el('squad-found-stocks').onchange = event => {
      if (!event.target.value) return;
      el('squad-stock-op').value = 'eq';
      el('squad-stock-value').value = Number(event.target.value).toLocaleString('pt-BR', {useGrouping: false, maximumFractionDigits: 10});
    };
    el('squad-stock-op').onchange = el('squad-stock-value').oninput = () => { el('squad-found-stocks').value = ''; };
    el('squad-stock-large').onclick = () => {
      el('squad-found-stocks').value = '';
      el('squad-stock-op').value = 'gt';
      el('squad-stock-value').value = '500';
    };
    el('squad-delete').onclick = () => {
      const squad = squads.find(s => s.id === editingId);
      if (!squad || !window.confirm(`Excluir o squad “${squad.name}”? As planilhas e registros serão mantidos.`)) return;
      squads = squads.filter(s => s.id !== editingId);
      if (activeId === editingId) activeId = '';
      dialog.close(); change();
    };
    select.onchange = () => {activeId = select.value; change();};
    trigger.onclick = () => menu.hidden ? openMenu() : closeMenu();
    trigger.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {event.preventDefault(); openMenu();}
    };
    menu.onkeydown = event => {
      const buttons = [...menu.children], index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closeMenu(true);}
      else if (event.key === 'Tab') closeMenu();
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', event => {if (!event.target.closest('.squad-dropdown')) closeMenu();});
    menu.parentElement.addEventListener('focusout', event => {if (!menu.parentElement.contains(event.relatedTarget)) closeMenu();});
    for (const kind of ['states', 'tag', 'stock']) el(`squad-use-${kind}`).onchange = () => { toggleFields(); updateSectionBadges(); };
    // Update badges when sections are toggled open/closed
    for (const section of ['members', 'states', 'tag', 'stock']) {
      el(`squad-section-${section}`).addEventListener('toggle', updateSectionBadges);
    }
    // Update badges when member checkboxes change
    el('squad-members').addEventListener('change', updateSectionBadges);
    el('squad-states').addEventListener('change', updateSectionBadges);
    // Region preset quick-select buttons
    const REGIONS = {
      noneco: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO', 'AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE', 'DF', 'GO', 'MS', 'MT'],
      sul: ['PR', 'RS', 'SC'],
      rjmges: ['RJ', 'MG', 'ES']
    };
    document.querySelectorAll('.squad-region-btn').forEach(btn => {
      btn.onclick = () => {
        const region = btn.dataset.region;
        const inputs = [...el('squad-states').querySelectorAll('input[type=checkbox]')];
        if (region === 'none') {
          inputs.forEach(input => input.checked = false);
        } else if (region === 'all') {
          inputs.forEach(input => input.checked = true);
        } else {
          const ufs = new Set(REGIONS[region] || []);
          inputs.forEach(input => { if (ufs.has(input.value)) input.checked = true; });
        }
        updateSectionBadges();
      };
    });
    el('squad-member-search').oninput = event => {
      const query = BasesData.normalize(event.target.value);
      for (const label of el('squad-members').children) label.hidden = !BasesData.normalize(label.textContent).includes(query);
    };
    function addMembers(source) {
      const names = new Map();
      for (const cell of source.split(/[\r\n\t]+/)) {
        const name = cell.trim().replace(/\s+/g, ' ');
        if (name) names.set(BasesData.normalize(name), name);
      }
      if (!names.size) { el('squad-member-status').textContent = 'Cole ou digite pelo menos um nome.'; return false; }
      const existing = new Map([...el('squad-members').querySelectorAll('input')].map(input => [BasesData.normalize(input.value), input]));
      let added = 0;
      for (const [key, name] of names) {
        const input = existing.get(key);
        if (input) { if (!input.checked) added++; input.checked = true; }
        else { checkbox(el('squad-members'), name, name, true); added++; }
      }
      el('squad-member-search').value = '';
      for (const label of el('squad-members').children) label.hidden = false;
      const labels = [...el('squad-members').children];
      labels.sort((a, b) => Number(b.querySelector('input').checked) - Number(a.querySelector('input').checked));
      el('squad-members').append(...labels);
      el('squad-members').scrollTop = 0;
      el('squad-member-empty').hidden = true;
      const total = checkedValues('squad-members').length;
      el('squad-member-status').textContent = `${added} pessoa(s) adicionada(s) à seleção. ${total} selecionada(s) no squad.`;
      updateSectionBadges();
      return true;
    }
    el('squad-add-member').onclick = () => addMembers(el('squad-member-search').value);
    el('squad-add-list').onclick = () => {
      addMembers(el('squad-member-list').value);
    };
    function pasteMembers(event) {
      const source = event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('Text');
      if (source) {
        event.preventDefault();
        el('squad-member-list').value = source;
        addMembers(source);
      } else {
        // Some browsers expose the text only after the native paste completes.
        const field = event.currentTarget;
        setTimeout(() => {
          if (!dialog.open || !field.value.trim()) return;
          const inserted = field.value;
          el('squad-member-list').value = inserted;
          addMembers(inserted);
        }, 0);
      }
    }
    el('squad-member-list').onpaste = pasteMembers;
    el('squad-member-search').onpaste = pasteMembers;
    el('squad-member-list').oninput = event => {
      if (event.inputType === 'insertFromPaste' && event.target.value.trim()) addMembers(event.target.value);
    };
    render();
    return {active};
  };
})();
