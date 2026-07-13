// 폼 자동 채우기 스모크 테스트
//   node test/fill.smoke.mjs
// (CHROMIUM_PATH 환경변수로 크로미움 경로를 지정할 수 있음)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fillLibraryForm, findRequestLinks } from '../lib/form-fill.mjs';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const book = {
  title: '우리한과수업',
  author: '홍길동',
  publisher: '한과출판',
  isbn: '9791100000000',
  year: '2026',
  note: '지역 주민으로서 대출 이용을 희망합니다.',
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage();
await page.goto('file://' + path.join(__dirname, 'mock-form.html'));

const links = await page.evaluate(findRequestLinks);
assert.equal(links.length, 1, '희망도서 링크 1개를 찾아야 함');
assert.match(links[0].href, /hope-list\.html$/);

const result = await page.evaluate(fillLibraryForm, book);
const values = await page.evaluate(() =>
  Object.fromEntries([...document.querySelectorAll('input[name], textarea[name]')]
    .map(el => [el.name, el.value])));

assert.equal(values.reqTitle, book.title, '서명');
assert.equal(values.reqAuthor, book.author, '저자');
assert.equal(values.pubComp, book.publisher, '출판사');
assert.equal(values.isbnNo, book.isbn, 'ISBN');
assert.equal(values.pubYear, book.year, '발행년');
assert.equal(values.etcContent, book.note, '신청사유');
assert.ok(result.submitCandidates >= 1, '제출 후보 버튼을 강조해야 함');

const submitClicked = await page.evaluate(() => document.querySelector('input[type=submit]').style.outline);
assert.match(submitClicked, /solid/, '제출 버튼은 강조만 되어야 함');

console.log('채운 항목:', result.filled.map(f => f.field).join(', '));
console.log('제출 후보 버튼:', result.submitCandidates, '개 (강조만, 클릭 안 함)');
console.log('✅ 스모크 테스트 통과');
await browser.close();
