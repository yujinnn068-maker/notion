'use strict';

const form = document.querySelector('#search-form');
const queryInput = document.querySelector('#query');
const grid = document.querySelector('#book-grid');
const statePanel = document.querySelector('#state-panel');
const resultCount = document.querySelector('#result-count');
const toastRegion = document.querySelector('#toast-region');

const state = {
  query: '',
  loading: false,
};

function escapeText(value) {
  return String(value ?? '');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function showPanel(message, mark = '⌕') {
  statePanel.hidden = false;
  statePanel.replaceChildren();
  const icon = document.createElement('div');
  icon.className = 'empty-mark';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = mark;
  const text = document.createElement('p');
  text.textContent = message;
  statePanel.append(icon, text);
  grid.replaceChildren();
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = escapeText(text);
  return element;
}

function createBookCard(book) {
  const article = makeElement('article', 'book-card');
  article.dataset.state = 'idle';

  const button = makeElement('button', 'book-select');
  button.type = 'button';
  button.setAttribute('aria-label', `${book.title}을 Notion에 추가`);

  const coverWrap = makeElement('div', 'cover-wrap');
  if (book.cover) {
    const image = document.createElement('img');
    image.src = book.cover;
    image.alt = `${book.title} 표지`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.replaceWith(makeElement('div', 'cover-fallback', book.title));
    });
    coverWrap.append(image);
  } else {
    coverWrap.append(makeElement('div', 'cover-fallback', book.title));
  }

  const cardState = makeElement('div', 'card-state', 'Notion에 추가');
  coverWrap.append(cardState);

  button.append(
    coverWrap,
    makeElement('h3', 'book-title', book.title),
    makeElement('p', 'book-meta', `${book.author || '저자 미상'} · ${book.publisher || '출판사 미상'}`),
  );

  button.addEventListener('click', async () => {
    if (article.dataset.state !== 'idle') return;
    article.dataset.state = 'loading';
    button.disabled = true;
    cardState.textContent = '등록 중…';

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn13: book.isbn13,
          itemId: book.itemId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || '등록하지 못했습니다.');
      }

      article.dataset.state = data.status;
      cardState.textContent = data.status === 'duplicate' ? '이미 등록됨' : '등록 완료';
      showToast(
        data.status === 'duplicate'
          ? `${data.title}은 이미 등록되어 있습니다.`
          : `${data.title}을 등록했습니다.`,
      );
    } catch (error) {
      article.dataset.state = 'error';
      cardState.textContent = '등록 실패';
      button.disabled = false;
      showToast(error.message, 'error');
      window.setTimeout(() => {
        article.dataset.state = 'idle';
        cardState.textContent = 'Notion에 추가';
      }, 2200);
    }
  });

  article.append(button);

  return article;
}

async function search() {
  const query = queryInput.value.trim();
  if (!query) {
    queryInput.focus();
    return;
  }

  state.loading = true;
  state.query = query;
  resultCount.textContent = '';
  showPanel('알라딘에서 책을 찾고 있습니다…', '···');

  try {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`/api/search?${params}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || '검색하지 못했습니다.');
    }

    statePanel.hidden = true;
    grid.replaceChildren(...data.items.map(createBookCard));
    resultCount.textContent = `${data.items.length.toLocaleString('ko-KR')}권`;

    if (!data.items.length) {
      showPanel('검색 결과가 없습니다. 다른 제목으로 검색해 보세요.', '0');
    }
  } catch (error) {
    showPanel(error.message, '!');
    showToast(error.message, 'error');
  } finally {
    state.loading = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  search();
});
