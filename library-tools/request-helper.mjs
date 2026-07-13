#!/usr/bin/env node
/**
 * 희망도서 신청 반자동 도우미
 *
 * config.json 에 등록한 "내가 회원인 도서관" 목록을 순회하며:
 *   1. 브라우저(크로미움)를 띄워 도서관 홈페이지/신청 페이지를 연다
 *   2. 로그인은 사람이 직접 한다 (프로필이 저장되므로 다음 실행 때 유지)
 *   3. 'f' 를 입력하면 신청 폼에 책 정보를 자동으로 채운다
 *   4. 제출 버튼은 절대 자동으로 누르지 않는다 — 빨간 테두리로 강조만 하고
 *      최종 확인·제출은 사람이 한다
 *
 * 사용법:
 *   cp config.example.json config.json   # 책 정보와 도서관 목록 수정
 *   npm install && npx playwright install chromium
 *   node request-helper.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { fillLibraryForm, findRequestLinks } from './lib/form-fill.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  let raw;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    console.error('config.json 이 없습니다. 먼저 만들어 주세요:');
    console.error('  cp config.example.json config.json');
    console.error('그리고 책 정보(ISBN 등)와 회원 가입된 도서관 목록을 채워 주세요.');
    process.exit(1);
  }
  const config = JSON.parse(raw);
  if (!config.book?.title) {
    console.error('config.json 의 book.title 이 비어 있습니다.');
    process.exit(1);
  }
  if (!Array.isArray(config.libraries) || config.libraries.length === 0) {
    console.error('config.json 의 libraries 에 도서관을 1개 이상 등록해 주세요.');
    process.exit(1);
  }
  return config;
}

async function fillAllFrames(page, book) {
  let total = { filled: [], submitCandidates: 0 };
  for (const frame of page.frames()) {
    try {
      const r = await frame.evaluate(fillLibraryForm, book);
      total.filled.push(...r.filled);
      total.submitCandidates += r.submitCandidates;
    } catch {
      // 크로스 오리진 iframe 등 접근 불가 프레임은 건너뜀
    }
  }
  return total;
}

async function main() {
  const config = await loadConfig();
  const { chromium } = await import('playwright');

  const userDataDir = path.join(__dirname, 'user-data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    ...(config.chromiumPath || process.env.CHROMIUM_PATH
      ? { executablePath: config.chromiumPath || process.env.CHROMIUM_PATH }
      : {}),
  });
  const page = context.pages()[0] ?? await context.newPage();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('─'.repeat(60));
  console.log(`신청 도서: ${config.book.title}`
    + (config.book.author ? ` / ${config.book.author}` : '')
    + (config.book.publisher ? ` / ${config.book.publisher}` : '')
    + (config.book.isbn ? ` / ISBN ${config.book.isbn}` : ''));
  console.log(`대상 도서관: ${config.libraries.length}곳`);
  console.log('로그인 세션은 user-data/ 에 저장되어 다음 실행 때 유지됩니다.');
  console.log('─'.repeat(60));

  outer:
  for (const [i, lib] of config.libraries.entries()) {
    console.log(`\n[${i + 1}/${config.libraries.length}] ${lib.name}`);
    const startUrl = lib.requestUrl || lib.url;
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`  ⚠ 페이지 열기 실패: ${e.message} — 브라우저에서 직접 이동해 주세요.`);
    }

    if (!lib.requestUrl) {
      try {
        const links = await page.evaluate(findRequestLinks);
        if (links.length > 0) {
          console.log(`  희망도서 링크 발견 → 이동: ${links[0].text} (${links[0].href})`);
          await page.goto(links[0].href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
          console.log('  희망도서 링크를 못 찾았습니다. 브라우저에서 직접 신청 메뉴로 이동해 주세요.');
        }
      } catch { /* 이동 실패 시 사용자가 직접 탐색 */ }
    }

    console.log('  브라우저에서 로그인하고 신청 폼 화면까지 이동한 뒤 명령을 입력하세요.');
    while (true) {
      const cmd = (await rl.question('  명령 [f=폼 채우기 / n=다음 도서관 / q=종료] > ')).trim().toLowerCase();
      if (cmd === 'f') {
        const r = await fillAllFrames(page, config.book);
        if (r.filled.length === 0) {
          console.log('  ⚠ 채운 항목이 없습니다. 신청 폼 화면이 맞는지 확인해 주세요.');
        } else {
          for (const f of r.filled) console.log(`  ✔ ${f.field}: "${f.label}"`);
          console.log(`  제출 후보 버튼 ${r.submitCandidates}개를 빨간 테두리로 표시했습니다.`);
          console.log('  내용을 확인하고 제출 버튼은 직접 눌러 주세요. 끝나면 n 을 입력하세요.');
        }
      } else if (cmd === 'n' || cmd === '') {
        break;
      } else if (cmd === 'q') {
        break outer;
      }
    }
  }

  rl.close();
  await context.close();
  console.log('\n완료. 신청 결과(승인/반려)는 각 도서관 마이페이지에서 확인하세요.');
}

main().catch(e => { console.error('실패:', e); process.exit(1); });
