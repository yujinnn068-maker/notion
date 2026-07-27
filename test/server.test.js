'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NOTION_TOKEN = 'test-token';
process.env.NOTION_DATA_SOURCE_ID = 'test-data-source';

const { importBook } = require('../server');

test('importBook applies the default Notion template without overriding its icon', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const payload = String(url).endsWith('/query')
      ? { results: [] }
      : { url: 'https://notion.so/new-book' };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await importBook({
      title: '테스트 책',
      author: '테스트 저자',
      publisher: '테스트 출판사',
      categoryName: '국내도서>소설',
      description: '',
      link: 'https://example.com/book',
    });

    const createRequest = requests.find((request) =>
      request.url.endsWith('/v1/pages'),
    );
    const body = JSON.parse(createRequest.options.body);

    assert.equal(result.status, 'created');
    assert.deepEqual(body.template, {
      type: 'default',
      timezone: 'Asia/Seoul',
    });
    assert.equal(body.icon, undefined);
    assert.equal(body.properties.Title.title[0].text.content, '테스트 책');
  } finally {
    global.fetch = originalFetch;
  }
});
