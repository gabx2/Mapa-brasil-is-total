const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

async function runTest() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-f5-test-'));
  const port = 9333;

  console.log('Launching headless Edge on port', port);
  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpDir}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    // Wait for Edge to start listening
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const json = await res.json();
          wsUrl = json.webSocketDebuggerUrl;
          break;
        }
      } catch (_) {}
    }

    assert(wsUrl, 'Failed to connect to Edge CDP endpoint');
    console.log('Connected to Edge via CDP:', wsUrl);

    // Open WebSocket to browser
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let msgId = 1;
    function sendCommand(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', handler);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    // Create new target (page)
    const { targetId } = await sendCommand('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await sendCommand('Target.attachToTarget', { targetId, flatten: true });

    function sendPage(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', handler);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, sessionId, method, params }));
      });
    }

    await sendPage('Page.enable');
    await sendPage('Runtime.enable');

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown') {
        console.error('BROWSER EXCEPTION:', JSON.stringify(data.params.exceptionDetails));
      } else if (data.method === 'Runtime.consoleAPICalled') {
        console.log('BROWSER CONSOLE:', data.params.type, data.params.args.map(a => a.value || a.description).join(' '));
      }
    });

    // 1. Navigate to mapa-brasil-municipios.html
    console.log('Navigating to mapa-brasil-municipios.html...');
    const targetUrl = 'file:///c:/Users/AC/Desktop/MAPA%20BRASIL%20IS/mapa-brasil-municipios.html';
    await sendPage('Page.navigate', { url: targetUrl });

    // Wait for load
    await new Promise(r => setTimeout(r, 2000));

    // 2. Clear any old IndexedDB data and save a test slot
    console.log('Saving test dataset to IndexedDB...');
    const evalRes = await sendPage('Runtime.evaluate', {
      expression: `(async () => {
        if (!window.BasesUI || !window.BasesUI.storage) return 'NO_STORAGE';
        await window.BasesUI.storage.clearAll();
        const testDataset = {
          total: 88,
          people: [{ id: 'teste_pessoa', name: 'PESSOA TESTE', records: [{ row: 2, contactName: 'Cliente A', person: 'PESSOA TESTE', city: 'Curitiba/PR', stage: 'quali' }] }],
          allRecords: [{ row: 2, contactName: 'Cliente A', person: 'PESSOA TESTE', city: 'Curitiba/PR', stage: 'quali' }],
          skipped: 0,
          stage: 'quali',
          stageLabel: 'Qualificação'
        };
        await window.BasesUI.storage.saveSlot('quali', {
          stage: 'quali',
          fileName: 'f5_persisted_test.xlsx',
          currentSheet: 'Sheet1',
          dataset: testDataset
        });
        return 'SAVED';
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    assert.equal(evalRes.result.value, 'SAVED', 'Storage saveSlot must succeed in Edge');
    console.log('Slot saved successfully in IndexedDB.');

    // 3. Simulate F5 reload (Page.reload)
    console.log('Simulating F5 reload (Page.reload)...');
    await sendPage('Page.reload');

    // Wait for page to reload and hydrate from IndexedDB
    let restored = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      const checkRes = await sendPage('Runtime.evaluate', {
        expression: `(() => {
          const slot = document.getElementById('slot-quali');
          const isLoaded = slot && slot.classList.contains('is-loaded');
          const countQuali = document.getElementById('tab-count-quali')?.textContent?.trim();
          const countAll = document.getElementById('tab-count-all')?.textContent?.trim();
          const searchEnabled = !document.getElementById('person-search')?.disabled;
          return { isLoaded, countQuali, countAll, searchEnabled };
        })()`,
        returnByValue: true
      });
      const val = checkRes.result?.value;
      if (val && val.isLoaded && val.countQuali === '88' && val.countAll === '88') {
        restored = true;
        console.log('Verification passed on reload attempt', i, val);
        break;
      }
    }

    assert(restored, 'IndexedDB data was not restored after F5 reload!');
    console.log('SUCCESS: Page reloaded and 88 records restored from IndexedDB automatically!');

    // 4. Test slot removal persists on F5 too
    console.log('Testing removal persistence across reload...');
    await sendPage('Runtime.evaluate', {
      expression: `(() => {
        document.querySelector('#slot-quali .slot-remove').click();
      })()`
    });
    await new Promise(r => setTimeout(r, 500));

    // Reload again
    await sendPage('Page.reload');
    await new Promise(r => setTimeout(r, 1500));

    const checkRemoval = await sendPage('Runtime.evaluate', {
      expression: `(() => {
        const slot = document.getElementById('slot-quali');
        const isLoaded = slot && slot.classList.contains('is-loaded');
        const countQuali = document.getElementById('tab-count-quali')?.textContent?.trim();
        return { isLoaded, countQuali };
      })()`,
      returnByValue: true
    });
    assert.equal(checkRemoval.result.value.isLoaded, false, 'Slot must remain cleared after reload');
    assert.equal(checkRemoval.result.value.countQuali, '0', 'Count must remain 0 after reload');
    console.log('SUCCESS: Slot removal also persisted across reload!');

    ws.close();
  } finally {
    edgeProc.kill();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

runTest()
  .then(() => {
    console.log('\nALL REAL BROWSER F5 PERSISTENCE TESTS PASSED 100%!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nTEST FAILED:', err);
    process.exit(1);
  });
