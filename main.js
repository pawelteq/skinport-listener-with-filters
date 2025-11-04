const clientId = '759dff2198174ba28c5e44113a4a104d';
const clientSecret = 'SECRETID';

// Combine Client ID and Client Secret with a colon
const encodedData = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

// Generate the Authorization header
const authorizationHeaderString = `Authorization: Basic ${encodedData}`;

console.log(authorizationHeaderString);

require('dotenv').config();

// This file now functions as two parts:
// 1) a socket.io-client connection to the external sale feed (skinport)
// 2) a small Express + socket.io server that serves a static page and
//    broadcasts incoming sale events to connected browsers.

const express = require('express');
const http = require('http');
const path = require('path');
// use clientIo to avoid shadowing the server-side `io` variable
const { io: clientIo } = require('socket.io-client');
// Use the project's preferred msgpack parser (same as in main1.js)
// Prefer the installed `socket.io-msgpack-parser` if available on the system
const parser = require('socket.io-msgpack-parser');
const { Server } = require('socket.io');

const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args)));

const PRICE_REQUEST_TIMEOUT_MS = 5000;
const STEAM_APP_ID = '730';
const DEFAULT_PRICE_CURRENCY = 'EUR';
const STEAM_PRICEOVERVIEW_ENDPOINT = 'https://steamcommunity.com/market/priceoverview/';

const STEAM_CURRENCY_PARAM_MAP = {
  USD: '1',
  GBP: '2',
  EUR: '3',
  CHF: '4',
  RUB: '5',
  PLN: '6',
  BRL: '7',
  NOK: '9',
  MXN: '10',
  CAD: '20',
  AUD: '21',
  NZD: '22',
  SEK: '23',
  DKK: '24',
  JPY: '27',
  KRW: '34'
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function normalizeCurrency(raw) {
  if (raw == null) return null;
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

function normalizeNumericCentValue(numericValue, referenceValue) {
  if (!Number.isFinite(numericValue)) return numericValue;
  if (!Number.isInteger(numericValue) || numericValue === 0) return numericValue;
  const scaled = numericValue / 100;
  const reference = Number.isFinite(referenceValue) ? referenceValue : null;
  if (reference != null) {
    const diffScaled = Math.abs(scaled - reference);
    const diffOriginal = Math.abs(numericValue - reference);
    if (diffScaled + 1e-6 < diffOriginal) {
      return scaled;
    }
    return numericValue;
  }
  if (numericValue >= 1000 && scaled < numericValue) {
    return scaled;
  }
  return numericValue;
}

function extractNumericPart(str) {
  if (!str) return null;
  const cleaned = String(str).trim().replace(/\s+/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/-?[0-9.,]+/);
  return match ? match[0] : cleaned;
}

function parsePrice(input) {
  if (input == null) {
    return { value: null, currency: null, raw: input };
  }
  if (typeof input === 'number') {
    // The external feed sometimes provides prices as integer cents (e.g. 12345 -> 123.45).
    // Normalize integer values by dividing by 100 so downstream logic works with floats.
    let numeric = input;
    if (Number.isInteger(numeric)) {
      numeric = numeric / 100;
    }
    return { value: numeric, currency: null, raw: input };
  }
  const rawStr = String(input).trim();
  if (!rawStr) {
    return { value: null, currency: null, raw: input };
  }

  const currencyPart = rawStr.replace(/[0-9.,\s+-]/g, '') || null;
  const numericCandidate = extractNumericPart(rawStr) || rawStr;

  let normalizedNumeric = numericCandidate;
  const lastComma = numericCandidate.lastIndexOf(',');
  const lastDot = numericCandidate.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalizedNumeric = normalizedNumeric.replace(/\.(?=\d{3}(,|$))/g, '');
      normalizedNumeric = normalizedNumeric.replace(',', '.');
    } else {
      normalizedNumeric = normalizedNumeric.replace(/,(?=\d{3}(\.|$))/g, '');
    }
  } else if (lastComma !== -1) {
    normalizedNumeric = normalizedNumeric.replace(/\.(?=\d{3}(,|$))/g, '');
    normalizedNumeric = normalizedNumeric.replace(',', '.');
  } else {
    normalizedNumeric = normalizedNumeric.replace(/,(?=\d{3}(\.|$))/g, '');
  }
  normalizedNumeric = normalizedNumeric.replace(/[^0-9.\-]/g, '');
  let value = parseFloat(normalizedNumeric);
  // If the original numeric candidate had no decimal separators and looks like an integer
  // with at least 3 digits, treat it as cents (divide by 100). E.g. "247" -> 2.47
  if (value != null && Number.isFinite(value)) {
    const hasDecimalSeparator = /[.,]/.test(numericCandidate);
    const onlyDigits = /^[0-9]+$/.test(numericCandidate.replace(/\s+/g, ''));
    if (!hasDecimalSeparator && onlyDigits && String(numericCandidate).length >= 3) {
      value = value / 100;
    }
  }
  return {
    value: Number.isFinite(value) ? value : null,
    currency: normalizeCurrency(currencyPart),
    raw: input
  };
}

function findFirstNumeric(input) {
  if (input == null) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string') {
    const numericString = extractNumericPart(input);
    if (numericString != null) {
      const normalized = numericString.replace(/,(?=\d{3}(\.|$))/g, '').replace(',', '.');
      const parsed = parseFloat(normalized.replace(/[^0-9.\-]/g, ''));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findFirstNumeric(item);
      if (value != null) return value;
    }
    return null;
  }
  if (typeof input === 'object') {
    const preferredKeys = [
      'lowest',
      'lowest_price',
      'median',
      'median_price',
      'mean',
      'average',
      'price',
      'value',
      'amount'
    ];
    for (const key of preferredKeys) {
      if (key in input) {
        const value = findFirstNumeric(input[key]);
        if (value != null) return value;
      }
    }
    for (const key of Object.keys(input)) {
      const value = findFirstNumeric(input[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function buildSteamRecord(asset, targetCurrency) {
  if (!asset) return null;
  const name = asset.market_hash_name || asset.market_name || asset.name || asset.type;
  if (!name) return null;
  const prices = asset.prices || {};
  const currencyKey = (targetCurrency || '').toUpperCase();
  const priceEntry = prices[currencyKey] || prices[targetCurrency] || Object.values(prices)[0];
  const numericValue = findFirstNumeric(priceEntry);
  if (numericValue == null) return null;

  const entryCurrency =
    normalizeCurrency(priceEntry && priceEntry.currency) ||
    normalizeCurrency(currencyKey) ||
    normalizeCurrency(targetCurrency) ||
    targetCurrency;

  return {
    key: name.toLowerCase(),
    value: {
      marketHashName: name,
      lowestPrice: numericValue,
      medianPrice: numericValue,
      currency: entryCurrency || DEFAULT_PRICE_CURRENCY,
      sourceUrl: `https://steamcommunity.com/market/listings/${STEAM_APP_ID}/${encodeURIComponent(name)}`
    }
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PRICE_REQUEST_TIMEOUT_MS, timeoutMessage) {
  const controller = new AbortController();
  const merged = { ...options, signal: controller.signal };
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, merged);
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new Error(timeoutMessage || 'Request aborted');
    }
    throw err;
  }
}

function resolveSteamCurrencyConfig(desiredCurrency) {
  const normalized = normalizeCurrency(desiredCurrency) || DEFAULT_PRICE_CURRENCY;
  const currencyParam = STEAM_CURRENCY_PARAM_MAP[normalized] || STEAM_CURRENCY_PARAM_MAP.EUR || '3';
  return { normalizedCurrency: normalized, currencyParam };
}

async function fetchSteamPriceLive(marketHashName, desiredCurrency) {
  if (!marketHashName) {
    throw new Error('Brak nazwy przedmiotu');
  }

  const { normalizedCurrency, currencyParam } = resolveSteamCurrencyConfig(desiredCurrency);
  const params = new URLSearchParams({
    appid: STEAM_APP_ID,
    market_hash_name: marketHashName,
    currency: currencyParam
  });

  const response = await fetchWithTimeout(
    `${STEAM_PRICEOVERVIEW_ENDPOINT}?${params.toString()}`,
    { headers: { Accept: 'application/json' } },
    PRICE_REQUEST_TIMEOUT_MS,
    'Steam priceoverview timeout'
  );

  if (!response.ok) {
    throw new Error(`Steam priceoverview HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data || data.success === false) {
    throw new Error('Steam priceoverview returned error');
  }

  const lowest = parsePrice(data.lowest_price);
  const median = parsePrice(data.median_price);
  const normalizedLowest = lowest.value != null ? normalizeNumericCentValue(lowest.value, null) : null;
  const normalizedMedian = median.value != null ? normalizeNumericCentValue(median.value, normalizedLowest) : null;

  return {
    lowestPrice: normalizedLowest,
    medianPrice: normalizedMedian,
    currency: lowest.currency || median.currency || normalizedCurrency,
    sourceUrl: `https://steamcommunity.com/market/listings/${STEAM_APP_ID}/${encodeURIComponent(marketHashName)}`,
    raw: data
  };
}

// Individual item price fetching is handled by fetchSteamPriceLive

async function getPriceComparisons(marketName, saleCurrency) {
  const normalizedSaleCurrency = normalizeCurrency(saleCurrency) || DEFAULT_PRICE_CURRENCY;
  const result = { fetchedAt: new Date().toISOString() };

  if (!marketName) {
    return result;
  }

  try {
    const liveEntry = await fetchSteamPriceLive(marketName, normalizedSaleCurrency);
    result.steam = liveEntry;
  } catch (err) {
    result.steam = { error: err && err.message ? err.message : 'Brak danych ze Steam' };
  }

  return result;
}

async function enrichSale(sale, defaultCurrency) {
  if (!sale || typeof sale !== 'object') {
    return sale;
  }

  const cloned = { ...sale };
  
  // Add Steam community image URL if classid is available
  if (sale.classid) {
    cloned.image = `https://community.steamstatic.com/economy/image/class/730/${sale.classid}`;
  }

  const salePriceRaw =
    sale.price ?? sale.currentPrice ?? sale.value ?? sale.salePrice ?? sale.buyPrice ?? null;
  const priceParsed = parsePrice(salePriceRaw);
  if (priceParsed && priceParsed.value != null) {
    priceParsed.value = normalizeNumericCentValue(priceParsed.value, null);
  }
  const saleCurrency =
    normalizeCurrency(sale.currency || sale.currencyCode || sale.priceCurrency) ||
    priceParsed.currency ||
    normalizeCurrency(defaultCurrency);

  // Normalize common price fields so downstream consumers (UI/client) see floats
  // instead of integer cents. Overwrite canonical numeric fields with parsed values
  if (priceParsed && priceParsed.value != null) {
    // keep original raw in case it's needed
    cloned._rawPrice = salePriceRaw;
    // canonical price field
    cloned.price = priceParsed.value;
    cloned.currentPrice = priceParsed.value;
    cloned.value = priceParsed.value;
  }

  // Normalize typical "previous" price fields if present
  const prevKeys = ['previousPrice', 'oldPrice', 'normalPrice', 'previous_price', 'previous_price_raw', 'previousprice', 'old_price'];
  for (const k of prevKeys) {
    const rawPrev = Object.prototype.hasOwnProperty.call(sale, k) ? sale[k] : cloned[k];
    if (rawPrev == null) continue;
    const parsedPrev = parsePrice(rawPrev);
    if (parsedPrev && parsedPrev.value != null) {
      const normalizedPrev = normalizeNumericCentValue(parsedPrev.value, priceParsed.value);
      cloned[k] = normalizedPrev;
    }
  }

  let comparisons = {};
  const marketName = sale.marketName || sale.market_hash_name || sale.name || sale.title;
  if (marketName) {
    try {
      comparisons = await getPriceComparisons(marketName, saleCurrency || priceParsed.currency);
    } catch (err) {
      comparisons = { error: err && err.message ? err.message : 'Blad podczas pobierania danych porownawczych' };
    }
  }

  if (priceParsed.value != null && comparisons && typeof comparisons === 'object') {
    const steamEntry = comparisons.steam;
    if (steamEntry && !steamEntry.error) {
      const entryCurrency = normalizeCurrency(steamEntry.currency) || saleCurrency || priceParsed.currency;
      steamEntry.currency = entryCurrency;
      if (
        steamEntry.lowestPrice != null &&
        saleCurrency &&
        entryCurrency &&
        entryCurrency === saleCurrency
      ) {
        const diff = steamEntry.lowestPrice - priceParsed.value;
        const diffRounded = Math.round(diff * 100) / 100;
        steamEntry.diff = diffRounded;
        steamEntry.diffPercent = priceParsed.value > 0
          ? Math.round(((steamEntry.lowestPrice / priceParsed.value - 1) * 100) * 100) / 100
          : null;
      }
    }
  }

  cloned.priceInsights = {
    salePrice: {
      raw: salePriceRaw,
      value: priceParsed.value,
      currency: saleCurrency || priceParsed.currency || null
    },
    saleCurrency: saleCurrency || priceParsed.currency || null,
    comparisons,
    lastUpdated: new Date().toISOString()
  };

  return cloned;
}

async function enrichSaleFeedPayload(payload) {
  if (!payload) return payload;

  const baseCurrency = normalizeCurrency(payload.currency || payload.saleCurrency || DEFAULT_PRICE_CURRENCY);

  if (Array.isArray(payload)) {
    const enrichedArray = await Promise.all(payload.map((sale) => enrichSale(sale, baseCurrency)));
    return enrichedArray;
  }

  if (Array.isArray(payload.sales)) {
    const enrichedSales = await Promise.all(payload.sales.map((sale) => enrichSale(sale, baseCurrency)));
    return { ...payload, sales: enrichedSales };
  }

  return payload;
}

// Serve the static UI from /public
app.use(express.static(path.join(__dirname, 'public')));

// Connect to the external websocket (skinport) using the local parser
const socket = clientIo('wss://skinport.com', {
  transports: ['websocket'],
  parser
  // Optionally set extraHeaders if the external endpoint requires Authorization header
  // extraHeaders: { Authorization: `Basic ${encodedData}` }
});

// When we receive sale feed data from external source, broadcast to browsers
socket.on('saleFeed', async (result) => {
  let payload = result;
  try {
    payload = await enrichSaleFeedPayload(result);
  } catch (err) {
    console.error('Blad wzbogacania danych sprzedazy', err);
    payload = result;
  }

  try {
    const firstSale = Array.isArray(payload && payload.sales) ? payload.sales[0] : null;
    if (firstSale && firstSale.marketName) {
      const priceInfo = firstSale.priceInsights && firstSale.priceInsights.salePrice;
      const priceStr = priceInfo && priceInfo.value != null
        ? `${priceInfo.value} ${priceInfo.currency || ''}`.trim()
        : firstSale.price || firstSale.currentPrice || '';
      console.log(`[SALE] ${firstSale.marketName} @ ${priceStr}`);
    }
  } catch (err) {
    // ignore logging errors
  }

  io.emit('saleFeed', payload);
});

socket.on('connect', () => console.log('connected to external sale feed'));
socket.on('connect_error', (err) => console.error('external socket connect_error', err));

// Join Sale Feed with parameters.
socket.emit('saleFeedJoin', { currency: 'EUR', locale: 'en', appid: 730 });

// Browser socket.io connections
io.on('connection', (socket) => {
  console.log('browser connected', socket.id);
  socket.on('disconnect', () => console.log('browser disconnected', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));



