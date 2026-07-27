'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  buildNotionProperties,
  cleanText,
  normalizeAuthor,
  normalizeExternalUrl,
} = require('./lib/book-utils');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const NOTION_VERSION = '2026-03-11';
const SEARCH_PAGE_SIZE = 5;

class PublicError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!process.env[name]) {
      process.env[name] = value;
    }
  }
}

loadDotEnv(path.join(ROOT, '.env'));

function requireConfig(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PublicError(
      503,
      'configuration_missing',
      `${name} is not configured in .env.`,
    );
  }
  return value;
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) {
      throw new PublicError(413, 'body_too_large', 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new PublicError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new PublicError(504, 'upstream_timeout', 'The external API timed out.');
    }
    throw new PublicError(502, 'upstream_unavailable', 'The external API is unavailable.');
  } finally {
    clearTimeout(timer);
  }
}

async function aladinSearch(query, page) {
  const ttbKey = requireConfig('ALADIN_TTB_KEY');
  const url = new URL('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx');
  url.search = new URLSearchParams({
    ttbkey: ttbKey,
    Query: query,
    QueryType: 'Title',
    MaxResults: String(SEARCH_PAGE_SIZE),
    start: String(page),
    SearchTarget: 'Book',
    output: 'js',
    Version: '20131101',
    Cover: 'Big',
  }).toString();

  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new PublicError(502, 'aladin_error', 'Aladin search failed.');
  }

  let data;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new PublicError(502, 'aladin_invalid_response', 'Aladin returned invalid JSON.');
  }

  if (data.errorCode || data.errorMessage) {
    throw new PublicError(
      502,
      'aladin_error',
      cleanText(data.errorMessage) || 'Aladin search failed.',
    );
  }

  return data;
}

async function aladinLookup(book) {
  const ttbKey = requireConfig('ALADIN_TTB_KEY');
  const itemId = book.isbn13 || book.itemId;
  if (!itemId) {
    return { ...book, pages: null };
  }

  const url = new URL('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx');
  url.search = new URLSearchParams({
    ttbkey: ttbKey,
    itemIdType: book.isbn13 ? 'ISBN13' : 'ItemId',
    ItemId: itemId,
    output: 'js',
    Version: '20131101',
    Cover: 'Big',
  }).toString();

  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new PublicError(502, 'aladin_lookup_error', 'Aladin detail lookup failed.');
  }

  let data;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new PublicError(
      502,
      'aladin_invalid_response',
      'Aladin returned invalid detail JSON.',
    );
  }

  if (data.errorCode || data.errorMessage) {
    throw new PublicError(
      502,
      'aladin_lookup_error',
      cleanText(data.errorMessage) || 'Aladin detail lookup failed.',
    );
  }

  const detail = Array.isArray(data.item) ? data.item[0] : null;
  if (!detail) {
    return { ...book, pages: null };
  }

  return {
    ...book,
    title: detail.title || book.title,
    author: detail.author || book.author,
    publisher: detail.publisher || book.publisher,
    categoryName: detail.categoryName || book.categoryName,
    description: detail.description || book.description,
    link: normalizeExternalUrl(detail.link || book.link),
    cover: detail.cover || book.cover,
    isbn13: String(detail.isbn13 || book.isbn13 || '').trim(),
    itemId: String(detail.itemId || book.itemId || '').trim(),
    pages: Number(detail.subInfo?.itemPage) || null,
  };
}

function normalizeSearchItems(items) {
  return items.map((item) => {
    return {
      title: cleanText(item.title),
      author: normalizeAuthor(item.author),
      publisher: cleanText(item.publisher),
      categoryName: cleanText(item.categoryName),
      description: item.description || '',
      link: normalizeExternalUrl(item.link),
      cover: String(item.cover || '').trim(),
      isbn13: String(item.isbn13 || '').trim(),
      itemId: String(item.itemId || '').trim(),
    };
  });
}

async function notionRequest(endpoint, options = {}) {
  const token = requireConfig('NOTION_TOKEN');
  const response = await fetchWithTimeout(`https://api.notion.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      'Notion-Version': NOTION_VERSION,
      ...options.headers,
    },
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // An empty or non-JSON response is represented by an empty object.
  }

  if (!response.ok) {
    const status = [401, 403, 404, 409, 429].includes(response.status)
      ? response.status
      : 502;
    throw new PublicError(
      status,
      data.code || 'notion_error',
      cleanText(data.message) || 'Notion request failed.',
    );
  }
  return data;
}

async function importBook(book, iconUrl = '') {
  const dataSourceId = requireConfig('NOTION_DATA_SOURCE_ID');
  const properties = buildNotionProperties(book);
  const normalizedUrl = properties.URL.url;

  const duplicate = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: 100,
      filter: {
        property: 'URL',
        url: { equals: normalizedUrl },
      },
    }),
  });

  const activeDuplicate = duplicate.results?.find(
    (page) => !page.archived && !page.in_trash,
  );
  if (activeDuplicate) {
    return {
      status: 'duplicate',
      notionUrl: activeDuplicate.url,
      title: properties.Title.title[0].text.content,
    };
  }

  const pagePayload = {
    parent: { data_source_id: dataSourceId },
    properties,
  };
  if (iconUrl.startsWith('https://')) {
    pagePayload.icon = {
      type: 'external',
      external: { url: iconUrl },
    };
  }

  const created = await notionRequest('/v1/pages', {
    method: 'POST',
    body: JSON.stringify(pagePayload),
  });

  return {
    status: 'created',
    notionUrl: created.url,
    title: properties.Title.title[0].text.content,
  };
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    const page = 1;
    if (!query || query.length > 100) {
      throw new PublicError(400, 'invalid_query', 'Enter a title between 1 and 100 characters.');
    }
    const data = await aladinSearch(query, page);
    const items = normalizeSearchItems(Array.isArray(data.item) ? data.item : []);
    jsonResponse(response, 200, {
      query,
      page,
      pageSize: SEARCH_PAGE_SIZE,
      totalResults: Number(data.totalResults || 0),
      items,
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/import') {
    const body = await readJsonBody(request);
    const isbn13 = String(body.isbn13 || '').trim();
    const itemId = String(body.itemId || '').trim();
    if (!isbn13 && !itemId) {
      throw new PublicError(
        400,
        'invalid_book_id',
        'The selected book does not have an Aladin identifier.',
      );
    }

    const detailedBook = await aladinLookup({ isbn13, itemId });
    const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim();
    const protocol = forwardedProtocol || url.protocol.replace(':', '');
    const iconUrl = `${protocol}://${request.headers.host}/book2.png`;
    const result = await importBook(detailedBook, iconUrl);
    jsonResponse(response, 200, result);
    return true;
  }

  return false;
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/book2.png', ['book2.png', 'image/png']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function serveStatic(response, pathname) {
  const entry = staticFiles.get(pathname);
  if (!entry) {
    return false;
  }
  const [fileName, contentType] = entry;
  const body = fs.readFileSync(path.join(PUBLIC_DIR, fileName));
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': body.length,
    'Content-Type': contentType,
  });
  response.end(body);
  return true;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(request, response, url))) {
        jsonResponse(response, 404, { error: { code: 'not_found', message: 'Not found.' } });
      }
      return;
    }

    if (!serveStatic(response, url.pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
    }
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500;
    const code = error instanceof PublicError ? error.code : 'internal_error';
    const message =
      error instanceof PublicError ? error.message : 'An unexpected server error occurred.';
    if (!(error instanceof PublicError)) {
      console.error(error);
    }
    jsonResponse(response, status, { error: { code, message, details: error.details } });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Reading DB importer: http://${HOST}:${PORT}`);
  });
}

module.exports = {
  PublicError,
  aladinLookup,
  aladinSearch,
  handleRequest,
  importBook,
  loadDotEnv,
  normalizeSearchItems,
  server,
};
