'use strict';

const MAX_RICH_TEXT_LENGTH = 2000;
const FIXED_GENRES = Object.freeze([
  '문학',
  '에세이',
  '인문',
  '역사',
  '사회',
  '경제경영',
  '자기계발',
  '과학',
  '예술',
  '종교',
  '건강',
  '여행',
  '청소년',
  '교육',
  '만화',
]);

const ALADIN_TOP_LEVEL_MAP = Object.freeze({
  '건강/취미': '건강',
  경제경영: '경제경영',
  '공무원 수험서': '교육',
  과학: '과학',
  '달력/기타': '건강',
  대학교재: '교육',
  '만화/라이트노벨': '만화',
  만화: '만화',
  사회과학: '사회',
  '소설/시/희곡': '문학',
  '수험서/자격증': '교육',
  어린이: '청소년',
  에세이: '에세이',
  여행: '여행',
  역사: '역사',
  '예술/대중문화': '예술',
  외국어: '교육',
  '요리/살림': '건강',
  유아: '청소년',
  인문학: '인문',
  자기계발: '자기계발',
  잡지: '에세이',
  장르소설: '문학',
  '전집/중고전집': '청소년',
  '종교/역학': '종교',
  좋은부모: '교육',
  청소년: '청소년',
  '컴퓨터/모바일': '과학',
  초등학교참고서: '교육',
  초등참고서: '교육',
  중학교참고서: '교육',
  중등참고서: '교육',
  고등학교참고서: '교육',
  고등참고서: '교육',
});

const GENRE_KEYWORDS = Object.freeze([
  ['문학', ['소설', '문학', '시집', '희곡', '장르소설']],
  ['에세이', ['에세이', '수필', '산문', '잡지']],
  ['인문', ['인문', '철학', '심리', '언어학', '독서', '글쓰기']],
  ['역사', ['역사', '한국사', '세계사', '고고학']],
  ['사회', ['사회', '정치', '법학', '법률', '시사']],
  ['경제경영', ['경제', '경영', '재테크', '투자', '마케팅', '창업']],
  ['자기계발', ['자기계발', '성공', '처세', '능력계발']],
  ['과학', ['과학', '수학', '공학', '기술', '컴퓨터', '모바일', '의학', '인공지능']],
  ['예술', ['예술', '대중문화', '음악', '미술', '영화', '디자인', '사진']],
  ['종교', ['종교', '역학', '명상', '기독교', '가톨릭', '불교']],
  ['건강', ['건강', '취미', '요리', '살림', '생활', '스포츠', '육아']],
  ['여행', ['여행', '관광', '지리']],
  ['청소년', ['청소년', '어린이', '유아', '동화', '전집']],
  ['교육', ['교육', '수험', '자격', '참고서', '외국어', '대학교재', '학습', '교재', '공무원']],
  ['만화', ['만화', '라이트노벨', '그래픽노블', '웹툰']],
]);

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return String(value ?? '').replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity) => {
      if (entity[0] === '#') {
        const isHex = entity[1].toLowerCase() === 'x';
        const raw = entity.slice(isHex ? 2 : 1);
        const codePoint = Number.parseInt(raw, isHex ? 16 : 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return named[entity.toLowerCase()] ?? match;
    },
  );
}

function cleanText(value) {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAuthor(value) {
  const raw = cleanText(value);
  if (!raw) return '';

  const contributors = raw
    .split(/\s*,\s*/)
    .map((entry) => {
      const roleMatch = entry.match(/\(([^)]+)\)\s*$/);
      return {
        name: entry.replace(/\s*\([^)]+\)\s*$/, '').trim(),
        role: roleMatch ? roleMatch[1].trim() : '',
      };
    })
    .filter((entry) => entry.name);

  const explicitWriters = contributors.filter((entry) => entry.role === '지은이');
  if (explicitWriters.length) {
    return explicitWriters.map((entry) => entry.name).join(', ');
  }

  const alternateWriters = contributors.filter((entry) =>
    ['글', '원작'].includes(entry.role),
  );
  if (alternateWriters.length) {
    return alternateWriters.map((entry) => entry.name).join(', ');
  }

  const hasAnyRole = contributors.some((entry) => entry.role);
  if (hasAnyRole) return '';
  return contributors.map((entry) => entry.name).join(', ');
}

function truncateText(value, maxLength = MAX_RICH_TEXT_LENGTH) {
  const text = cleanText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeGenre(value) {
  const category = cleanText(value);
  if (!category) return '인문';

  const segments = category
    .split('>')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const topLevel = segments.find(
    (segment) => !['국내도서', '전자책', 'eBook'].includes(segment),
  );
  if (topLevel && ALADIN_TOP_LEVEL_MAP[topLevel]) {
    return ALADIN_TOP_LEVEL_MAP[topLevel];
  }

  let bestGenre = '인문';
  let bestScore = 0;
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    const score = keywords.reduce(
      (total, keyword) => total + (category.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestGenre = genre;
      bestScore = score;
    }
  }
  return bestGenre;
}

function koreaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeExternalUrl(value) {
  return decodeHtmlEntities(String(value ?? '')).trim();
}

function buildNotionProperties(book, date = new Date()) {
  const title = cleanText(book.title);
  const author = normalizeAuthor(book.author);
  const publisher = cleanText(book.publisher);
  const genre = normalizeGenre(book.categoryName);
  const url = normalizeExternalUrl(book.link);
  const summary = truncateText(book.description);

  if (!title || !author || !publisher || !isHttpUrl(url)) {
    throw new Error('Book data is missing a title, author, publisher, or valid URL.');
  }

  const properties = {
    Title: {
      title: [{ text: { content: title } }],
    },
    Date: {
      date: { start: koreaDate(date) },
    },
    Author: {
      rich_text: [{ text: { content: author } }],
    },
    Publisher: {
      rich_text: [{ text: { content: publisher } }],
    },
    Genre: {
      select: { name: genre },
    },
    URL: {
      url,
    },
  };

  if (summary) {
    properties.Summary = {
      rich_text: [{ text: { content: summary } }],
    };
  }

  if (isHttpsUrl(book.cover)) {
    properties.Cover = {
      files: [
        {
          name: `${title.slice(0, 80)} cover`,
          type: 'external',
          external: { url: String(book.cover) },
        },
      ],
    };
  }

  const pages = Number(book.pages);
  if (Number.isFinite(pages) && pages > 0) {
    properties.Pages = {
      number: Math.trunc(pages),
    };
  }

  return properties;
}

module.exports = {
  ALADIN_TOP_LEVEL_MAP,
  FIXED_GENRES,
  MAX_RICH_TEXT_LENGTH,
  buildNotionProperties,
  cleanText,
  isHttpUrl,
  koreaDate,
  normalizeAuthor,
  normalizeExternalUrl,
  normalizeGenre,
  truncateText,
};
