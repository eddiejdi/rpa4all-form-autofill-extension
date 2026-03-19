const api = typeof browser !== 'undefined' ? browser : chrome;

const statusNode = document.getElementById('status');
const recordSelect = document.getElementById('recordSelect');
const loadRemoteButton = document.getElementById('loadRemote');
const loadSampleButton = document.getElementById('loadSample');
const fillCurrentButton = document.getElementById('fillCurrent');
const openOptionsButton = document.getElementById('openOptions');

let records = [];

function setStatus(message, isError) {
  statusNode.textContent = message;
  statusNode.style.color = isError ? '#b42318' : '#5f6b7a';
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    api.runtime.sendMessage(message, (response) => {
      const err = api.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function getStorageLocal(keys) {
  return new Promise((resolve, reject) => {
    api.storage.local.get(keys, (result) => {
      const err = api.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

function setStorageLocal(data) {
  return new Promise((resolve, reject) => {
    api.storage.local.set(data, () => {
      const err = api.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const err = api.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve((tabs || [])[0]);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    api.tabs.sendMessage(tabId, message, (response) => {
      const err = api.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function executeScriptFill(tabId, payload) {
  return new Promise((resolve, reject) => {
    api.scripting.executeScript(
      {
        target: { tabId },
        func: (data) => {
          const selectors = {
            theme: ['#marketingTheme', 'input[name="theme"]'],
            audience: ['#marketingAudience', 'input[name="audience"]'],
            notes: ['#marketingNotes', '#requestNotes', 'textarea[name="notes"]'],
            name: ['#businessCardName', 'input[name="name"]'],
            title: ['#businessCardTitle', '#requestRole', 'input[name="title"]', 'input[name="role"]'],
            email: ['#businessCardEmail', '#requestEmail', 'input[name="email"]'],
            phone: ['#businessCardPhone', '#requestPhone', 'input[name="phone"]'],
            company: ['#requestCompany', 'input[name="company"]'],
            legal_name: ['#requestLegalName', 'input[name="legalName"]'],
            company_document: ['#requestCompanyDocument', 'input[name="companyDocument"]'],
            contact: ['#requestContact', 'input[name="contact"]'],
            representative_document: ['#requestRepresentativeDocument', 'input[name="representativeDocument"]'],
            project: ['#requestProject', 'input[name="project"]'],
            address: ['#requestAddress', 'input[name="address"]'],
            address_number: ['#requestAddressNumber', 'input[name="addressNumber"]'],
            address_complement: ['#requestAddressComplement', 'input[name="addressComplement"]'],
            district: ['#requestDistrict', 'input[name="district"]'],
            postal_code: ['#requestPostalCode', 'input[name="postalCode"]'],
            temperature: ['#requestTemperature', 'select[name="temperature"]'],
            volume: ['#requestVolume', 'input[name="volume"]'],
            ingress: ['#requestIngress', 'input[name="ingress"]'],
            retention: ['#requestRetention', 'select[name="retention"]'],
            retrieval: ['#requestRetrieval', 'select[name="retrieval"]'],
            sla: ['#requestSla', 'select[name="sla"]'],
            compliance: ['#requestCompliance', 'select[name="compliance"]'],
            redundancy: ['#requestRedundancy', 'select[name="redundancy"]'],
            billing: ['#requestBilling', 'select[name="billing"]'],
            term: ['#requestTerm', 'select[name="term"]'],
            start_date: ['#requestStartDate', 'input[name="startDate"]'],
            city: ['#requestCity', 'input[name="city"]'],
            state: ['#requestState', 'input[name="state"]']
          };

          function norm(value) {
            return String(value || '').toLowerCase().trim();
          }

          function emit(field) {
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }

          function setField(field, value) {
            if (!field || field.disabled) {
              return false;
            }
            if (field.tagName === 'SELECT') {
              const target = norm(value);
              const options = Array.from(field.options || []);
              const exact = options.find((opt) => norm(opt.value) === target || norm(opt.textContent) === target);
              if (exact) {
                field.value = exact.value;
              } else {
                const partial = options.find((opt) => {
                  const ov = norm(opt.value);
                  const ot = norm(opt.textContent);
                  return ov.includes(target) || ot.includes(target) || target.includes(ov) || target.includes(ot);
                });
                field.value = partial ? partial.value : String(value);
              }
              emit(field);
              return true;
            }
            field.value = String(value == null ? '' : value);
            emit(field);
            return true;
          }

          let filled = 0;
          Object.keys(data || {}).forEach((key) => {
            const value = data[key];
            const options = selectors[key];
            if (!options) {
              return;
            }
            for (const selector of options) {
              const node = document.querySelector(selector);
              if (setField(node, value)) {
                filled += 1;
                break;
              }
            }
          });
          return { filled, totalKeys: Object.keys(data || {}).length, mode: 'script-fallback' };
        },
        args: [payload]
      },
      (results) => {
        const err = api.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(results && results[0] ? results[0].result : { filled: 0, totalKeys: 0, mode: 'script-fallback' });
      }
    );
  });
}

function renderRecords() {
  recordSelect.innerHTML = '';
  if (!records.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Sem registros';
    recordSelect.appendChild(option);
    recordSelect.disabled = true;
    return;
  }

  recordSelect.disabled = false;
  records.forEach((record, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${record.label} (#${record.id})`;
    recordSelect.appendChild(option);
  });
}

async function loadFromCache() {
  const result = await getStorageLocal(['rpa4allMassesCache']);
  records = Array.isArray(result.rpa4allMassesCache) ? result.rpa4allMassesCache : [];
  renderRecords();
  if (records.length) {
    setStatus(`Cache carregado com ${records.length} registro(s).`);
  }
}

async function loadFromSample() {
  const response = await fetch(api.runtime.getURL('sample-masses.json'));
  const json = await response.json();
  records = Array.isArray(json.records) ? json.records : [];
  await setStorageLocal({ rpa4allMassesCache: records, rpa4allMassesFetchedAt: Date.now() });
  renderRecords();
  setStatus(`Massa local carregada (${records.length} registro(s)).`);
}

async function loadFromApi() {
  setStatus('Carregando massa de testes da API...');
  const response = await sendRuntimeMessage({ type: 'fetchTestMasses' });
  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : 'Falha ao consultar API.');
  }
  records = response.records || [];
  renderRecords();
  setStatus(`API retornou ${records.length} registro(s).`);
}

async function fillCurrentTab() {
  if (!records.length) {
    await loadFromCache();
  }

  if (!records.length) {
    await loadFromSample();
  }

  if (!records.length) {
    throw new Error('Nenhum registro carregado. Use "Carregar massa (API)" ou "Usar massa local".');
  }

  const index = Number(recordSelect.value || 0);
  const selected = records[index];
  if (!selected || !selected.data) {
    throw new Error('Registro invalido.');
  }

  const tab = await queryActiveTab();
  if (!tab || !tab.id || !tab.url) {
    throw new Error('Nao foi possivel identificar a aba ativa.');
  }

  if (!/https:\/\/.+\.rpa4all\.com\//.test(tab.url)) {
    throw new Error('Abra uma pagina *.rpa4all.com para preencher.');
  }

  let result = null;
  try {
    const response = await sendMessageToTab(tab.id, { type: 'fillForm', payload: selected.data });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : 'Falha ao preencher formulario.');
    }
    result = response.result || {};
  } catch (error) {
    result = await executeScriptFill(tab.id, selected.data);
  }

  if (!result || Number(result.filled || 0) === 0) {
    result = await executeScriptFill(tab.id, selected.data);
  }

  setStatus(`Preenchido: ${result.filled}/${result.totalKeys} campos.`);
}

loadRemoteButton.addEventListener('click', async () => {
  try {
    await loadFromApi();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

loadSampleButton.addEventListener('click', async () => {
  try {
    await loadFromSample();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

fillCurrentButton.addEventListener('click', async () => {
  try {
    await fillCurrentTab();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

openOptionsButton.addEventListener('click', () => {
  api.runtime.openOptionsPage();
});

loadFromCache().catch(() => {
  renderRecords();
});

// First run UX: if cache is empty, auto-load local sample so user can test immediately.
setTimeout(() => {
  if (!records.length) {
    loadFromSample().catch(() => {
      setStatus('Nenhum registro em cache. Clique em "Usar massa local" ou "Carregar massa (API)".', true);
    });
  }
}, 0);
