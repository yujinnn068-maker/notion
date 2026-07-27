'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALADIN_TOP_LEVEL_MAP,
  FIXED_GENRES,
  MAX_RICH_TEXT_LENGTH,
  buildNotionProperties,
  cleanText,
  koreaDate,
  normalizeAuthor,
  normalizeExternalUrl,
  normalizeGenre,
  truncateText,
} = require('../lib/book-utils');

test('cleanText removes HTML and decodes common entities', () => {
  assert.equal(cleanText('<b>책 &amp; 사람</b><br>둘째 줄'), '책 & 사람 둘째 줄');
});

test('normalizeAuthor keeps writers and removes translators and role labels', () => {
  assert.equal(
    normalizeAuthor('헤르만 헤세 (지은이), 전영애 (옮긴이)'),
    '헤르만 헤세',
  );
  assert.equal(
    normalizeAuthor('김하나 (지은이), 황선우 (지은이), 홍길동 (해설)'),
    '김하나, 황선우',
  );
});

test('normalizeAuthor falls back to writing roles but not unrelated roles', () => {
  assert.equal(normalizeAuthor('백희나 (글), 백희나 (그림)'), '백희나');
  assert.equal(normalizeAuthor('작가 A (원작), 작가 B (옮긴이)'), '작가 A');
  assert.equal(normalizeAuthor('번역가 (옮긴이), 화가 (그림)'), '');
  assert.equal(normalizeAuthor('역할 없는 작가'), '역할 없는 작가');
});

test('normalizeExternalUrl decodes Aladin HTML entities', () => {
  assert.equal(
    normalizeExternalUrl(
      'https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=260084&amp;partner=openAPI',
    ),
    'https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=260084&partner=openAPI',
  );
});

test('normalizeGenre maps Aladin paths to the fixed Reading DB taxonomy', () => {
  assert.equal(normalizeGenre('국내도서>경제경영>재테크/투자'), '경제경영');
  assert.equal(normalizeGenre('국내도서>소설/시/희곡>독일소설'), '문학');
  assert.equal(normalizeGenre('국내도서>과학>천문학'), '과학');
  assert.equal(normalizeGenre('국내도서>인문학>심리학/정신분석학'), '인문');
  assert.equal(normalizeGenre('국내도서>예술/대중문화>미술'), '예술');
  assert.equal(normalizeGenre('국내도서>어린이>어린이 문학'), '청소년');
  assert.ok(FIXED_GENRES.includes(normalizeGenre('국내도서>과학>물리학')));
});

test('normalizeGenre uses the top-level category before lower-level keywords', () => {
  assert.equal(normalizeGenre('국내도서>인문학>서양철학'), '인문');
  assert.equal(normalizeGenre('국내도서>청소년>청소년 철학'), '청소년');
  assert.equal(normalizeGenre('국내도서>대학교재>자연과학'), '교육');
});

test('normalizeGenre classifies future categories by nearest keywords', () => {
  assert.equal(normalizeGenre('국내도서>새분야>인공지능과 로봇공학'), '과학');
  assert.equal(normalizeGenre('국내도서>새분야>정치와 법률'), '사회');
  assert.equal(normalizeGenre('국내도서>완전히 새로운 분야'), '인문');
});

test('every current Aladin top-level category maps to one of 15 fixed genres', () => {
  assert.equal(FIXED_GENRES.length, 15);
  for (const genre of Object.values(ALADIN_TOP_LEVEL_MAP)) {
    assert.ok(FIXED_GENRES.includes(genre));
  }
});

test('truncateText observes the Notion rich text limit', () => {
  const result = truncateText('가'.repeat(3000));
  assert.equal(result.length, MAX_RICH_TEXT_LENGTH);
  assert.ok(result.endsWith('…'));
});

test('koreaDate uses the Asia/Seoul calendar date', () => {
  assert.equal(koreaDate(new Date('2026-07-26T16:00:00.000Z')), '2026-07-27');
});

test('buildNotionProperties maps Aladin fields to Reading DB properties', () => {
  const properties = buildNotionProperties(
    {
      title: '테스트 책',
      author: '테스트 저자',
      publisher: '테스트 출판사',
      categoryName: '국내도서 > 소설',
      description: '<p>책 소개</p>',
      link: 'https://www.aladin.co.kr/shop/book.aspx?id=1',
      cover: 'https://image.aladin.co.kr/product/1/cover.jpg',
      pages: 248,
    },
    new Date('2026-07-26T16:00:00.000Z'),
  );

  assert.equal(properties.Title.title[0].text.content, '테스트 책');
  assert.equal(properties.Date.date.start, '2026-07-27');
  assert.equal(properties.Genre.select.name, '문학');
  assert.equal(properties.Summary.rich_text[0].text.content, '책 소개');
  assert.equal(
    properties.Cover.files[0].external.url,
    'https://image.aladin.co.kr/product/1/cover.jpg',
  );
  assert.equal(properties.Pages.number, 248);
});

test('buildNotionProperties omits invalid optional cover URLs', () => {
  const properties = buildNotionProperties({
    title: '테스트 책',
    author: '저자',
    publisher: '출판사',
    categoryName: '',
    description: '',
    link: 'https://example.com/book',
    cover: 'http://example.com/cover.jpg',
  });

  assert.equal(properties.Genre.select.name, '인문');
  assert.equal(properties.Cover, undefined);
  assert.equal(properties.Summary, undefined);
});
