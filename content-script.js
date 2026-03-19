(function () {
  const api = typeof browser !== 'undefined' ? browser : chrome;

  const EXPLICIT_SELECTORS = {
    theme: ['#marketingTheme', 'input[name="theme"]'],
    audience: ['#marketingAudience', 'input[name="audience"]'],
    notes: ['#marketingNotes', 'textarea[name="notes"]'],
    name: ['#businessCardName', 'input[name="name"]'],
    title: ['#businessCardTitle', 'input[name="title"]', 'input[name="cargo"]'],
    email: ['#businessCardEmail', 'input[type="email"]'],
    phone: ['#businessCardPhone', 'input[type="tel"]', 'input[name="phone"]', 'input[name="telefone"]'],
    tagline: ['#businessCardTagline'],
    specialties: ['#businessCardSpecialties'],
    note: ['#businessCardNote']
  };

  const KEY_ALIASES = {
    nome: 'name',
    full_name: 'name',
    nome_completo: 'name',
    cargo: 'title',
    role: 'title',
    telefone: 'phone',
    celular: 'phone',
    observacoes: 'notes',
    observacao: 'notes',
    publico: 'audience',
    publico_alvo: 'audience',
    tema: 'theme'
  };

  const FIELD_CANDIDATE_SELECTOR = 'input, textarea, select';

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function normalizeKey(key) {
    const compact = normalize(key).replace(/[^a-z0-9]+/g, '_');
    return KEY_ALIASES[compact] || compact;
  }

  function flattenObject(obj, prefix, out) {
    if (!obj || typeof obj !== 'object') {
      return out;
    }

    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      const currentKey = prefix ? `${prefix}.${key}` : key;
      if (value == null) {
        return;
      }
      if (Array.isArray(value)) {
        out[currentKey] = value.join(', ');
        return;
      }
      if (typeof value === 'object') {
        flattenObject(value, currentKey, out);
        return;
      }
      out[currentKey] = value;
    });

    return out;
  }

  function getFieldDescriptor(field) {
    const label = field.labels && field.labels.length ? field.labels[0].innerText : '';
    const attrs = [
      field.id,
      field.name,
      field.getAttribute('placeholder'),
      field.getAttribute('aria-label'),
      field.getAttribute('data-testid'),
      label
    ]
      .filter(Boolean)
      .map((item) => normalize(item));

    return {
      node: field,
      attrs,
      fingerprint: attrs.join(' ')
    };
  }

  function usableField(field) {
    if (!field || field.disabled) {
      return false;
    }
    const type = normalize(field.type);
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'file') {
      return false;
    }
    return true;
  }

  function scoreField(descriptor, normalizedKey) {
    const key = normalize(normalizedKey);
    if (!key) {
      return 0;
    }

    let score = 0;
    descriptor.attrs.forEach((attr) => {
      if (attr === key) {
        score += 100;
      }
      if (attr.includes(key)) {
        score += 50;
      }
      const keyTokens = key.split('_').filter(Boolean);
      const tokenHits = keyTokens.filter((token) => attr.includes(token));
      score += tokenHits.length * 10;
    });
    return score;
  }

  function setFieldValue(field, rawValue) {
    const type = normalize(field.type);
    const value = rawValue == null ? '' : rawValue;

    if (field.tagName === 'SELECT') {
      const target = normalize(value);
      const options = Array.from(field.options || []);
      const exact = options.find((opt) => normalize(opt.value) === target || normalize(opt.textContent) === target);
      if (exact) {
        field.value = exact.value;
      } else if (options.length > 0) {
        field.value = String(value);
      }
      return true;
    }

    if (type === 'checkbox') {
      field.checked = typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'sim', 'on'].includes(normalize(value));
      return true;
    }

    if (type === 'radio') {
      const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(field.name || '')}"]`);
      const pick = Array.from(group).find((node) => normalize(node.value) === normalize(value));
      if (pick) {
        pick.checked = true;
        return true;
      }
      return false;
    }

    field.value = String(value);
    return true;
  }

  function emitEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillWithExplicitSelectors(key, value, usedNodes) {
    const selectors = EXPLICIT_SELECTORS[key];
    if (!selectors) {
      return null;
    }

    for (const selector of selectors) {
      const field = document.querySelector(selector);
      if (!usableField(field) || usedNodes.has(field)) {
        continue;
      }
      if (setFieldValue(field, value)) {
        emitEvents(field);
        usedNodes.add(field);
        return field;
      }
    }

    return null;
  }

  function fillForm(payload) {
    const flat = flattenObject(payload, '', {});
    const descriptors = Array.from(document.querySelectorAll(FIELD_CANDIDATE_SELECTOR))
      .filter(usableField)
      .map(getFieldDescriptor);

    const usedNodes = new Set();
    let filled = 0;
    const keys = Object.keys(flat);

    keys.forEach((sourceKey) => {
      const value = flat[sourceKey];
      const leafKey = sourceKey.split('.').slice(-1)[0];
      const normalizedKey = normalizeKey(leafKey);

      const explicitField = fillWithExplicitSelectors(normalizedKey, value, usedNodes);
      if (explicitField) {
        filled += 1;
        return;
      }

      let best = null;
      let bestScore = 0;
      descriptors.forEach((descriptor) => {
        if (usedNodes.has(descriptor.node)) {
          return;
        }
        const currentScore = scoreField(descriptor, normalizedKey);
        if (currentScore > bestScore) {
          bestScore = currentScore;
          best = descriptor;
        }
      });

      if (best && bestScore >= 20 && setFieldValue(best.node, value)) {
        emitEvents(best.node);
        usedNodes.add(best.node);
        filled += 1;
      }
    });

    return {
      filled,
      totalKeys: keys.length,
      page: window.location.href
    };
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'fillForm') {
      return false;
    }

    try {
      const result = fillForm(message.payload || {});
      sendResponse({ ok: true, result });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }

    return true;
  });
})();
