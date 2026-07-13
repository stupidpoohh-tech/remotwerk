/**
 * 브라우저 페이지 안에서 실행되는 희망도서 신청 폼 자동 채우기 함수.
 *
 * Playwright 의 frame.evaluate(fillLibraryForm, book) 로 직렬화되어
 * 페이지 컨텍스트에서 실행되므로, 이 함수는 외부 스코프를 참조하면 안 된다.
 *
 * 국내 도서관 사이트 폼은 대부분 <table> 기반(th 에 항목명)이거나
 * label/placeholder 를 쓰므로, 입력 요소 주변 텍스트를 모아
 * 항목명을 추정한 뒤 책 정보를 채운다. 제출 버튼은 절대 누르지 않고
 * 빨간 테두리로 강조만 한다.
 */
export function fillLibraryForm(book) {
  const FIELD_PATTERNS = [
    ['isbn', /isbn/i],
    ['title', /서\s*명|도서\s*명|자료\s*명|책\s*(이름|제목)|제\s*목|title/i],
    ['author', /저\s*자|저작자|글쓴이|지은이|작가|author/i],
    ['publisher', /출판사|발행처|발행자|publisher/i],
    ['year', /발행\s*[년일]|출판\s*[년일]|출간|발행연도|pub/i],
    ['price', /가\s*격|정\s*가|price/i],
    ['note', /비\s*고|사\s*유|신청\s*사유|요청\s*사항|의\s*견|내\s*용|remark/i],
  ];

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function labelTextFor(el) {
    let t = '';
    if (el.labels && el.labels.length) t += ' ' + [...el.labels].map(l => l.textContent).join(' ');
    t += ' ' + (el.getAttribute('placeholder') || '');
    t += ' ' + (el.getAttribute('title') || '');
    t += ' ' + (el.name || '') + ' ' + (el.id || '');
    const cell = el.closest('td');
    if (cell) {
      const row = cell.closest('tr');
      const header = row && (row.querySelector('th') || cell.previousElementSibling);
      if (header) t += ' ' + header.textContent;
    }
    const dd = el.closest('dd');
    if (dd && dd.previousElementSibling) t += ' ' + dd.previousElementSibling.textContent;
    return t.replace(/\s+/g, ' ');
  }

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const filled = [];
  const used = new Set();
  const inputs = [...document.querySelectorAll('input, textarea')].filter(el => {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !el.disabled && !el.readOnly && visible(el) &&
      (el.tagName === 'TEXTAREA' || ['text', 'search', 'number', 'tel'].includes(type));
  });

  for (const el of inputs) {
    const label = labelTextFor(el);
    for (const [field, pattern] of FIELD_PATTERNS) {
      if (used.has(field) || !book[field] || !pattern.test(label)) continue;
      setValue(el, String(book[field]));
      used.add(field);
      filled.push({ field, label: label.trim().slice(0, 60) });
      break;
    }
  }

  const SUBMIT_RE = /신\s*청|등\s*록|저\s*장|제\s*출|확\s*인|submit/i;
  let submitCandidates = 0;
  for (const el of document.querySelectorAll('button, input[type=submit], input[type=button], input[type=image], a')) {
    const text = (el.textContent || el.value || el.getAttribute('title') || el.getAttribute('alt') || '').trim();
    if (text.length <= 10 && SUBMIT_RE.test(text) && visible(el)) {
      el.style.outline = '3px solid #e11d48';
      el.style.outlineOffset = '2px';
      submitCandidates++;
    }
  }

  return { filled, inputCount: inputs.length, submitCandidates };
}

/** 페이지에서 희망도서 신청으로 보이는 링크의 절대 URL 목록을 찾는다. (page.evaluate 용) */
export function findRequestLinks() {
  const KEYWORD = /희망\s*도서|희망\s*자료|비치\s*희망|구입\s*신청|희망\s*책/;
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const text = (a.textContent || '') + ' ' + (a.getAttribute('title') || '');
    if (!KEYWORD.test(text)) continue;
    const href = a.href;
    if (!href || href.startsWith('javascript:') || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: text.replace(/\s+/g, ' ').trim().slice(0, 50) });
  }
  return out;
}
