// Client-side logic for Sale Feed Viewer
const socket = io();
const statusEl = document.getElementById('status');
const itemsEl = document.getElementById('items');
const minDiscountInput = document.getElementById('minDiscount');
const itemsCountEl = document.getElementById('itemsCount');
const lastUpdatedEl = document.getElementById('lastUpdated');

const currencyInput = document.getElementById('currency');

let minDiscount = Number(minDiscountInput.value) || 0;
let items = [];
let latestUpdateTs = null;
let targetCurrency = (currencyInput && currencyInput.value) || 'PLN';
// Kursy walut (baza EUR); aktualizowane z serwera. Wartosci awaryjne na start.
let fxRates = { EUR: 1, USD: 1.08, PLN: 4.3, GBP: 0.85 };

minDiscountInput.addEventListener('input', () => {
  minDiscount = Number(minDiscountInput.value) || 0;
  render();
});

if (currencyInput) {
  currencyInput.addEventListener('change', () => {
    targetCurrency = currencyInput.value || 'PLN';
    render();
  });
}

socket.on('fxRates', (fx) => {
  if (fx && fx.rates && typeof fx.rates === 'object') {
    fxRates = { ...fxRates, ...fx.rates };
    render();
  }
});

// Przelicz kwote z waluty zrodlowej na aktualnie wybrana walute (baza EUR)
function convertToTarget(value, fromCurrency) {
  if (value == null || Number.isNaN(value)) return null;
  const from = normalizeCurrencyCode(fromCurrency) || 'EUR';
  const to = targetCurrency;
  if (from === to) return value;
  const rFrom = fxRates[from];
  const rTo = fxRates[to];
  if (!rFrom || !rTo) return value; // brak kursu -> pokaz oryginal
  return (value / rFrom) * rTo;
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.classList.remove('online', 'offline');
  if (state) {
    statusEl.classList.add(state);
  }
}

socket.on('connect', () => {
  setStatus('Polaczono', 'online');
});

socket.on('disconnect', () => {
  setStatus('Rozlaczono', 'offline');
});

socket.on('connect_error', () => {
  setStatus('Blad polaczenia', 'offline');
});

function normalizeCurrencyCode(raw) {
  if (!raw && raw !== 0) return null;
  const original = String(raw).trim();
  if (!original) return null;
  const upper = original.toUpperCase();
  const asciiUpper = upper
    .replace(/\u0141/g, 'L')
    .replace(/\u0142/g, 'L');
  const map = {
    '\u20AC': 'EUR',
    'EUR': 'EUR',
    'E': 'EUR',
    '$': 'USD',
    'USD': 'USD',
    'US$': 'USD',
    '\u00A3': 'GBP',
    'GBP': 'GBP',
    'PLN': 'PLN',
    'ZL': 'PLN',
    'ZLOTY': 'PLN',
    'R$': 'BRL',
    'BRL': 'BRL',
    '\u20BD': 'RUB',
    'RUB': 'RUB',
    'CAD': 'CAD',
    'AUD': 'AUD',
    'CHF': 'CHF',
    'DKK': 'DKK',
    'NOK': 'NOK',
    'SEK': 'SEK',
    'JPY': 'JPY',
    'CNY': 'CNY',
    'KRW': 'KRW'
  };
  if (map[asciiUpper]) return map[asciiUpper];
  if (map[upper]) return map[upper];
  if (map[original]) return map[original];
  const letters = asciiUpper.replace(/[^A-Z]/g, '');
  if (letters.length >= 3) return letters.slice(0, 3);
  return null;
}

function parsePriceText(input) {
  if (input == null) return { value: null, currency: null };
  if (typeof input === 'number') {
    return { value: input, currency: null };
  }
  const raw = String(input).trim();
  if (!raw) return { value: null, currency: null };

  const currencyPart = raw.replace(/[0-9.,\s+-]/g, '') || null;
  const match = raw.match(/-?[0-9.,]+/);
  let numeric = match ? match[0] : raw;
  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      numeric = numeric.replace(/\.(?=\d{3}(,|$))/g, '');
      numeric = numeric.replace(',', '.');
    } else {
      numeric = numeric.replace(/,(?=\d{3}(\.|$))/g, '');
    }
  } else if (lastComma !== -1) {
    numeric = numeric.replace(/\.(?=\d{3}(,|$))/g, '');
    numeric = numeric.replace(',', '.');
  } else {
    numeric = numeric.replace(/,(?=\d{3}(\.|$))/g, '');
  }

  numeric = numeric.replace(/[^0-9.\-]/g, '');
  let value = parseFloat(numeric);
  // Treat integer-only numeric strings with >=3 digits as cents (e.g. "247" -> 2.47)
  const hasDecimalSeparator = /[.,]/.test(numeric);
  const onlyDigits = /^[0-9]+$/.test(numeric.replace(/\s+/g, ''));
  if (!hasDecimalSeparator && onlyDigits && numeric.length >= 3 && Number.isFinite(value)) {
    value = value / 100;
  }
  return {
    value: Number.isFinite(value) ? value : null,
    currency: normalizeCurrencyCode(currencyPart)
  };
}

function computeDiscountPercent(sale) {
  if (!sale || typeof sale !== 'object') return 0;
  if (typeof sale.discountPercent === 'number') return sale.discountPercent;
  if (typeof sale.discount === 'number') return sale.discount;
  const price = parseFloat(sale.price || sale.currentPrice || sale.value);
  const prev = parseFloat(sale.previousPrice || sale.oldPrice || sale.normalPrice);
  if (!Number.isNaN(price) && !Number.isNaN(prev) && prev > 0) {
    return Math.round((1 - price / prev) * 100);
  }
  return 0;
}

function formatMoney(value, currency, fallback) {
  if (value == null || Number.isNaN(value)) {
    return fallback != null ? String(fallback) : '';
  }
  const code = currency || 'EUR';
  try {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: code }).format(value);
  } catch (err) {
    const numeric = Number.isFinite(value) ? value.toFixed(2) : String(value);
    return `${numeric} ${code}`.trim();
  }
}

function formatDiffText(diff, percent, currency) {
  if (diff == null || Number.isNaN(diff)) return '';
  const sign = diff < 0 ? '-' : diff > 0 ? '+' : '';
  const amount = formatMoney(Math.abs(diff), currency, Math.abs(diff));
  let percentText = '';
  if (percent != null && !Number.isNaN(percent)) {
    const percentSign = percent < 0 ? '-' : percent > 0 ? '+' : '';
    percentText = `${percentSign}${Math.abs(percent).toFixed(2)}%`;
  }
  const descriptor = diff < 0 ? 'taniej' : diff > 0 ? 'drozzej' : 'bez zmian';
  return `${sign}${amount}${percentText ? ` (${percentText})` : ''} ${descriptor}`.trim();
}

function pluralizeOffers(count) {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (abs === 1) return 'oferta';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'oferty';
  return 'ofert';
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '-';
  try {
    return new Date(timestamp).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (err) {
    return '-';
  }
}

function getSalePriceInfo(sale) {
  const insights = sale?.priceInsights;
  if (insights?.salePrice) {
    return {
      value: insights.salePrice.value,
      currency: normalizeCurrencyCode(insights.salePrice.currency || insights.saleCurrency || sale?.currency),
      raw: insights.salePrice.raw
    };
  }
  const raw = sale?.price ?? sale?.currentPrice ?? sale?.value ?? sale?.salePrice ?? null;
  const parsed = parsePriceText(raw);
  return {
    value: parsed.value,
    currency: parsed.currency || normalizeCurrencyCode(sale?.currency),
    raw
  };
}

// Buduje jedna rowna sekcje cenowa (Skinport / Steam / CSFloat)
function makePriceSection({ label, mainText, mainIsError, state, secondaryLabel, secondaryText, sourceUrl, diffBase, diffValue }) {
  const el = document.createElement('div');
  el.className = 'price-section ' + (state === 'cheapest' ? 'cheapest' : state === 'other' ? 'other' : 'neutral');

  const head = document.createElement('div');
  head.className = 'ps-head';
  const lbl = document.createElement('span');
  lbl.className = 'ps-label';
  lbl.textContent = label;
  head.appendChild(lbl);
  if (sourceUrl) {
    const link = document.createElement('a');
    link.className = 'meta-link';
    link.href = sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Zrodlo';
    head.appendChild(link);
  }
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'ps-body';
  const main = document.createElement('span');
  main.className = 'ps-main' + (mainIsError ? ' ps-error' : '');
  main.textContent = mainText || '--';
  body.appendChild(main);

  if (
    diffBase != null && diffValue != null &&
    !Number.isNaN(diffBase) && !Number.isNaN(diffValue)
  ) {
    const diff = Math.round((diffValue - diffBase) * 100) / 100;
    const pct = diffBase > 0 ? Math.round((diffValue / diffBase - 1) * 100 * 100) / 100 : null;
    const sign = diff < 0 ? '-' : diff > 0 ? '+' : '';
    const amount = formatMoney(Math.abs(diff), targetCurrency, Math.abs(diff));
    const pctText = pct != null && !Number.isNaN(pct)
      ? ` (${pct < 0 ? '-' : pct > 0 ? '+' : ''}${Math.abs(pct).toFixed(2)}%)`
      : '';
    const diffEl = document.createElement('span');
    diffEl.className = 'ps-diff';
    diffEl.textContent = `${sign}${amount}${pctText}`;
    body.appendChild(diffEl);
  }
  el.appendChild(body);

  if (secondaryText) {
    const note = document.createElement('div');
    note.className = 'ps-note';
    note.textContent = secondaryLabel ? `${secondaryLabel}: ${secondaryText}` : secondaryText;
    el.appendChild(note);
  }

  return el;
}

function updateStats(filteredItems) {
  const count = filteredItems.length;
  if (itemsCountEl) {
    itemsCountEl.textContent = `${count} ${pluralizeOffers(count)}`;
  }
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = latestUpdateTs
      ? `Ostatnia aktualizacja: ${formatTimestamp(latestUpdateTs)}`
      : 'Ostatnia aktualizacja: -';
  }
}

function render() {
  const filtered = items.filter((sale) => computeDiscountPercent(sale) >= minDiscount);
  updateStats(filtered);

  itemsEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Brak pozycji spelniajacych wybrane kryteria. Sprobuj obnizyc wymagany poziom znizki.';
    itemsEl.appendChild(empty);
    return;
  }

  const recent = filtered.slice(-200).reverse();
  for (const sale of recent) {
    const card = document.createElement('article');
    card.className = 'item';

    const name = sale?.marketName || sale?.name || sale?.title || '-';
    const salePriceInfo = getSalePriceInfo(sale);
    const saleCurrency = salePriceInfo.currency || normalizeCurrencyCode(sale?.priceInsights?.saleCurrency) || 'EUR';
    const salePriceTarget = convertToTarget(salePriceInfo.value, saleCurrency);
    const salePriceText = formatMoney(salePriceTarget, targetCurrency, salePriceInfo.raw ?? '-');
    const prevRaw = sale?.previousPrice || sale?.oldPrice || sale?.normalPrice || sale?.suggestedPrice;
    const prevParsed = parsePriceText(prevRaw);

    const header = document.createElement('div');
    header.className = 'item-header';

    if (sale?.image) {
      const imageContainer = document.createElement('div');
      imageContainer.className = 'item-image';
      const img = document.createElement('img');
      img.src = sale.image;
      img.alt = name;
      img.loading = 'lazy';
      imageContainer.appendChild(img);
      card.appendChild(imageContainer);
    }

    const headerLeft = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = name;
    headerLeft.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const discount = computeDiscountPercent(sale);
    if (discount) {
      const pill = document.createElement('span');
      pill.className = `pill ${discount >= 25 ? 'discount-high' : 'discount-low'}`;
      pill.textContent = `-${discount}%`;
      meta.appendChild(pill);
    }
    if (sale?.className) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = sale.className;
      meta.appendChild(pill);
    }
    if (sale?.phase) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = sale.phase;
      meta.appendChild(pill);
    }
    if (meta.children.length > 0) {
      headerLeft.appendChild(meta);
    }

    header.appendChild(headerLeft);
    card.appendChild(header);

    // --- Trzy rowne sekcje cenowe: Skinport, Steam, CSFloat ---
    const comparisons = sale?.priceInsights?.comparisons || {};
    const itemUrl = sale?.itemUrl || sale?.priceInsights?.itemUrl || sale?.url;

    const prices = document.createElement('div');
    prices.className = 'prices';

    // Wyznacz najtansze zrodlo (zielony), reszta czerwona
    const stEntry = comparisons.steam;
    const cfEntry = comparisons.csfloat;
    const stLowVal = stEntry && !stEntry.error ? convertToTarget(stEntry.lowestPrice, stEntry.currency) : null;
    const cfLowVal = cfEntry && !cfEntry.error ? convertToTarget(cfEntry.lowestPrice, cfEntry.currency) : null;
    const candidates = [
      { key: 'skinport', value: salePriceTarget },
      { key: 'steam', value: stLowVal },
      { key: 'csfloat', value: cfLowVal }
    ].filter((c) => c.value != null && !Number.isNaN(c.value));
    const minVal = candidates.length ? Math.min(...candidates.map((c) => c.value)) : null;
    const stateFor = (value) => {
      if (value == null || Number.isNaN(value) || minVal == null) return 'none';
      return value <= minVal + 1e-9 ? 'cheapest' : 'other';
    };

    // Skinport: cena tej oferty + najnizsza na rynku
    const sp = comparisons.skinport;
    const spMinTarget = sp && !sp.error ? convertToTarget(sp.lowestPrice, sp.currency) : null;
    let spNote = null;
    if (spMinTarget != null) {
      spNote = `${formatMoney(spMinTarget, targetCurrency, spMinTarget)}${sp.quantity != null ? ` (${sp.quantity} ofert)` : ''}`;
    } else if (sp && sp.error) {
      spNote = sp.error;
    }
    prices.appendChild(makePriceSection({
      label: 'Skinport',
      mainText: salePriceText,
      state: stateFor(salePriceTarget),
      secondaryLabel: 'Min',
      secondaryText: spNote,
      sourceUrl: itemUrl || (sp && sp.sourceUrl) || null,
      diffBase: salePriceTarget,
      diffValue: spMinTarget
    }));

    // Steam: najnizsza + mediana
    const stMed = stEntry && !stEntry.error ? convertToTarget(stEntry.medianPrice, stEntry.currency) : null;
    prices.appendChild(makePriceSection({
      label: 'Steam',
      mainText: stLowVal != null ? formatMoney(stLowVal, targetCurrency, stLowVal) : (stEntry && stEntry.error ? stEntry.error : '--'),
      mainIsError: !!(stEntry && stEntry.error),
      state: stateFor(stLowVal),
      secondaryLabel: 'Mediana',
      secondaryText: stMed != null ? formatMoney(stMed, targetCurrency, stMed) : null,
      sourceUrl: stEntry && stEntry.sourceUrl,
      diffBase: salePriceTarget,
      diffValue: stLowVal
    }));

    // CSFloat: najnizsza
    prices.appendChild(makePriceSection({
      label: 'CSFloat',
      mainText: cfLowVal != null ? formatMoney(cfLowVal, targetCurrency, cfLowVal) : (cfEntry && cfEntry.error ? cfEntry.error : '--'),
      mainIsError: !!(cfEntry && cfEntry.error),
      state: stateFor(cfLowVal),
      sourceUrl: cfEntry && cfEntry.sourceUrl,
      diffBase: salePriceTarget,
      diffValue: cfLowVal
    }));

    card.appendChild(prices);
    itemsEl.appendChild(card);
  }
}

socket.on('saleFeed', (result) => {
  if (!result) return;
  const entries = Array.isArray(result?.sales)
    ? result.sales
    : Array.isArray(result)
    ? result
    : [];

  if (!entries.length) return;

  for (const sale of entries) {
    items.push(sale);
  }

  latestUpdateTs = Date.now();

  if (items.length > 1000) {
    items = items.slice(-1000);
  }

  render();
});

render();

