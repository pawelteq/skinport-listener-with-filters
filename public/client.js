// Client-side logic for Sale Feed Viewer
const socket = io();
const statusEl = document.getElementById('status');
const itemsEl = document.getElementById('items');
const minDiscountInput = document.getElementById('minDiscount');
const itemsCountEl = document.getElementById('itemsCount');
const lastUpdatedEl = document.getElementById('lastUpdated');

let minDiscount = Number(minDiscountInput.value) || 0;
let items = [];
let latestUpdateTs = null;

minDiscountInput.addEventListener('input', () => {
  minDiscount = Number(minDiscountInput.value) || 0;
  render();
});

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

function buildComparisonElement(sourceKey, entry, saleCurrency) {
  if (!entry) return null;
  const container = document.createElement('div');
  container.className = 'comparison neutral';

  const labelMap = {
    steam: 'Steam',
    csfloat: 'CSFloat'
  };

  const left = document.createElement('div');
  const sourceEl = document.createElement('div');
  sourceEl.className = 'source';
  sourceEl.textContent = labelMap[sourceKey] || sourceKey.toUpperCase();
  left.appendChild(sourceEl);

  if (entry.error) {
    const errorEl = document.createElement('div');
    errorEl.className = 'notes';
    errorEl.textContent = entry.error;
    left.appendChild(errorEl);
    container.appendChild(left);
    return container;
  }

  const currency = normalizeCurrencyCode(entry.currency) || saleCurrency;
  const valueEl = document.createElement('div');
  valueEl.className = 'value';
  valueEl.textContent = entry.lowestPrice != null
    ? formatMoney(entry.lowestPrice, currency, entry.lowestPrice)
    : '--';
  left.appendChild(valueEl);

  if (sourceKey === 'steam' && entry.medianPrice != null && !Number.isNaN(entry.medianPrice)) {
    const medianEl = document.createElement('div');
    medianEl.className = 'notes';
    medianEl.textContent = `Mediana: ${formatMoney(entry.medianPrice, currency, entry.medianPrice)}`;
    left.appendChild(medianEl);
  }

  container.appendChild(left);

  const diffEl = document.createElement('div');
  diffEl.className = 'diff';
  if (entry.diff != null && !Number.isNaN(entry.diff)) {
    container.classList.remove('neutral');
    if (entry.diff < 0) {
      container.classList.add('positive');
    } else if (entry.diff > 0) {
      container.classList.add('negative');
    } else {
      container.classList.add('neutral');
    }
    diffEl.textContent = formatDiffText(entry.diff, entry.diffPercent, currency || saleCurrency);
  }
  container.appendChild(diffEl);

  if (entry.sourceUrl) {
    const linkEl = document.createElement('a');
    linkEl.className = 'meta-link';
    linkEl.href = entry.sourceUrl;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = 'Zrodlo';
    container.appendChild(linkEl);
  }

  return container;
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
    const salePriceText = formatMoney(salePriceInfo.value, saleCurrency, salePriceInfo.raw ?? '-');
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

    const priceRow = document.createElement('div');
    priceRow.className = 'price-row';

    const priceChip = document.createElement('span');
    priceChip.className = 'price-chip';
    priceChip.textContent = `Skinport: ${salePriceText}`;
    priceRow.appendChild(priceChip);
    card.appendChild(priceRow);

    const comparisons = sale?.priceInsights?.comparisons || {};
    const comparisonGrid = document.createElement('div');
    comparisonGrid.className = 'comparison-grid';

    const comparisonKeys = Object.keys(comparisons);
    if (comparisonKeys.length === 0) {
      const waitingEl = document.createElement('div');
      waitingEl.className = 'notes';
      waitingEl.textContent = 'Brak danych cenowych dla tego przedmiotu.';
      comparisonGrid.appendChild(waitingEl);
    } else {
      for (const sourceKey of comparisonKeys) {
        const element = buildComparisonElement(sourceKey, comparisons[sourceKey], saleCurrency);
        if (element) {
          comparisonGrid.appendChild(element);
        }
      }
    }

    card.appendChild(comparisonGrid);
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

