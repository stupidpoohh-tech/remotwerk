#!/usr/bin/env node
/**
 * 전국 도서관 목록 수집기
 *
 * 도서관 정보나루(data4library.kr) Open API 로 전국 도서관의
 * 이름·주소·전화·홈페이지를 수집하고, 옵션에 따라 각 도서관
 * 홈페이지에서 '희망도서 신청' 페이지 링크를 자동 탐색한다.
 *
 * 출력: output/libraries.json, output/libraries.csv(엑셀용 BOM 포함),
 *       output/index.html(검색·필터 가능한 정적 사이트)
 *
 * 사용법:
 *   node collect-libraries.mjs --key <정보나루 인증키> [--find-request-links]
 *   (인증키는 환경변수 DATA4LIBRARY_KEY 로도 지정 가능)
 *
 * 옵션:
 *   --key <key>            정보나루 API 인증키
 *   --out <dir>            출력 디렉터리 (기본: ./output)
 *   --page-size <n>        API 페이지 크기 (기본: 200)
 *   --limit <n>            최대 수집 개수 (테스트용)
 *   --find-request-links   각 홈페이지에서 희망도서 신청 링크 탐색
 *   --concurrency <n>      링크 탐색 동시 요청 수 (기본: 4)
 *   --delay <ms>           링크 탐색 요청 간 지연 (기본: 300)
 *   --base-url <url>       API 베이스 URL (기본: https://data4library.kr)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    key: process.env.DATA4LIBRARY_KEY || '',
    out: path.join(__dirname, 'output'),
    pageSize: 200,
    limit: Infinity,
    findRequestLinks: false,
    concurrency: 4,
    delay: 300,
    baseUrl: 'https://data4library.kr',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--key': opts.key = argv[++i]; break;
      case '--out': opts.out = path.resolve(argv[++i]); break;
      case '--page-size': opts.pageSize = Number(argv[++i]); break;
      case '--limit': opts.limit = Number(argv[++i]); break;
      case '--find-request-links': opts.findRequestLinks = true; break;
      case '--concurrency': opts.concurrency = Number(argv[++i]); break;
      case '--delay': opts.delay = Number(argv[++i]); break;
      case '--base-url': opts.baseUrl = argv[++i].replace(/\/$/, ''); break;
      default:
        console.error(`알 수 없는 옵션: ${a}`);
        process.exit(1);
    }
  }
  return opts;
}

async function fetchWithRetry(url, init = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        return res;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

/** 정보나루 libSrch API 를 페이지 끝까지 순회하며 도서관 목록을 모은다. */
async function fetchAllLibraries(opts) {
  const libs = [];
  let pageNo = 1;
  let numFound = Infinity;
  while (libs.length < Math.min(numFound, opts.limit)) {
    const url = `${opts.baseUrl}/api/libSrch?authKey=${encodeURIComponent(opts.key)}&pageNo=${pageNo}&pageSize=${opts.pageSize}&format=json`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`libSrch HTTP ${res.status}`);
    const json = await res.json();
    const r = json?.response;
    if (!r) throw new Error(`API 응답 형식 오류: ${JSON.stringify(json).slice(0, 300)}`);
    if (r.error) throw new Error(`API 오류: ${r.error} (인증키를 확인하세요)`);
    numFound = Number(r.numFound ?? 0);
    const page = (r.libs ?? []).map(x => x.lib ?? x);
    if (page.length === 0) break;
    libs.push(...page);
    process.stdout.write(`\r도서관 목록 수집 중… ${Math.min(libs.length, numFound)}/${numFound}`);
    pageNo++;
  }
  process.stdout.write('\n');
  return libs.slice(0, opts.limit === Infinity ? undefined : opts.limit).map(normalizeLib);
}

function normalizeLib(lib) {
  const address = String(lib.address ?? '').trim();
  return {
    libCode: String(lib.libCode ?? ''),
    libName: String(lib.libName ?? '').trim(),
    sido: address.split(/\s+/)[0] ?? '',
    address,
    tel: String(lib.tel ?? '').trim(),
    homepage: String(lib.homepage ?? '').trim(),
    closed: String(lib.closed ?? '').trim(),
    operatingTime: String(lib.operatingTime ?? '').trim(),
    latitude: String(lib.latitude ?? ''),
    longitude: String(lib.longitude ?? ''),
    requestLink: '',
    requestLinkStatus: '',
  };
}

/** 응답 바이트를 charset(EUC-KR 포함)에 맞게 문자열로 디코딩한다. */
async function decodeBody(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  let charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    charset = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

const REQUEST_KEYWORD = /희망\s*도서|희망\s*자료|비치\s*희망|구입\s*신청|희망\s*책/;
const LINK_RE = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

/** HTML 에서 희망도서 신청으로 보이는 첫 번째 링크를 절대 URL 로 반환. */
export function findRequestLinkInHtml(html, baseUrl) {
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(html))) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
    const text = m[4].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    const titleAttr = /title\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? '';
    if (REQUEST_KEYWORD.test(text) || REQUEST_KEYWORD.test(titleAttr)) {
      try {
        return new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function probeRequestLink(lib, opts) {
  if (!/^https?:\/\//i.test(lib.homepage)) {
    lib.requestLinkStatus = lib.homepage ? '홈페이지 주소 형식 오류' : '홈페이지 없음';
    return;
  }
  try {
    const res = await fetchWithRetry(lib.homepage, {
      timeoutMs: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; library-tools/0.1; one-time library list check)' },
      redirect: 'follow',
    }, 2);
    if (!res.ok) {
      lib.requestLinkStatus = `HTTP ${res.status}`;
      return;
    }
    const html = await decodeBody(res);
    const link = findRequestLinkInHtml(html, res.url || lib.homepage);
    if (link) {
      lib.requestLink = link;
      lib.requestLinkStatus = '확인됨';
    } else {
      lib.requestLinkStatus = '메인에서 못 찾음(로그인 후 메뉴일 수 있음)';
    }
  } catch (e) {
    lib.requestLinkStatus = `접속 실패(${e.name === 'AbortError' ? '시간 초과' : e.message})`;
  }
}

async function probeAll(libs, opts) {
  let done = 0;
  const queue = [...libs];
  async function worker() {
    while (queue.length) {
      const lib = queue.shift();
      await probeRequestLink(lib, opts);
      done++;
      process.stdout.write(`\r희망도서 링크 탐색 중… ${done}/${libs.length}`);
      await new Promise(r => setTimeout(r, opts.delay));
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  process.stdout.write('\n');
}

function toCsv(libs) {
  const header = ['도서관코드', '도서관명', '시도', '주소', '전화', '홈페이지', '희망도서신청링크', '링크상태', '휴관일', '운영시간', '위도', '경도'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = libs.map(l => [
    l.libCode, l.libName, l.sido, l.address, l.tel, l.homepage,
    l.requestLink, l.requestLinkStatus, l.closed, l.operatingTime, l.latitude, l.longitude,
  ].map(esc).join(','));
  return '﻿' + [header.map(esc).join(','), ...rows].join('\r\n');
}

function toHtml(libs) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const data = JSON.stringify(libs).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>전국 도서관 목록 — 희망도서 신청 안내</title>
<style>
  :root { color-scheme: light dark; --line: #d0d4dc; --muted: #6b7280; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) { :root { --line: #3a3f4a; --muted: #9aa2b1; --accent: #7ba3f5; } }
  * { box-sizing: border-box; }
  body { font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; margin: 0; padding: 24px; max-width: 1100px; margin-inline: auto; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: .9rem; margin-bottom: 16px; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  input[type=search], select { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: .95rem; background: transparent; color: inherit; }
  input[type=search] { flex: 1; min-width: 220px; }
  label.chk { display: flex; align-items: center; gap: 6px; font-size: .9rem; color: var(--muted); }
  .count { font-size: .85rem; color: var(--muted); margin-bottom: 8px; }
  .tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { position: sticky; top: 0; background: Canvas; }
  tr:last-child td { border-bottom: none; }
  a.btn { display: inline-block; padding: 3px 10px; border: 1px solid var(--accent); color: var(--accent); border-radius: 999px; text-decoration: none; font-size: .82rem; white-space: nowrap; }
  a.btn:hover { background: var(--accent); color: Canvas; }
  .muted { color: var(--muted); font-size: .82rem; }
  .notice { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; font-size: .85rem; color: var(--muted); margin-bottom: 16px; }
</style>
</head>
<body>
<h1>전국 도서관 목록</h1>
<p class="sub">도서관 정보나루 Open API 기준 · ${generatedAt} 생성 · 희망도서 신청은 각 도서관 회원(대개 해당 지역 거주자)만 가능합니다.</p>
<div class="notice">희망도서 신청 링크는 각 도서관 메인 페이지에서 자동 탐색한 결과라 없거나 부정확할 수 있습니다. 링크가 없으면 홈페이지에서 「희망도서」·「구입신청」 메뉴를 찾아보세요.</div>
<div class="controls">
  <input id="q" type="search" placeholder="도서관명·주소 검색">
  <select id="sido"><option value="">전체 지역</option></select>
  <label class="chk"><input id="onlyLink" type="checkbox"> 신청 링크 확인된 곳만</label>
</div>
<div class="count" id="count"></div>
<div class="tablewrap">
<table>
  <thead><tr><th>도서관명</th><th>주소</th><th>전화</th><th>바로가기</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
</div>
<script>
const DATA = ${data};
const q = document.getElementById('q');
const sidoSel = document.getElementById('sido');
const onlyLink = document.getElementById('onlyLink');
const rowsEl = document.getElementById('rows');
const countEl = document.getElementById('count');
[...new Set(DATA.map(d => d.sido).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')).forEach(s => {
  const o = document.createElement('option'); o.value = s; o.textContent = s; sidoSel.appendChild(o);
});
function esc(s) { const d = document.createElement('span'); d.textContent = s ?? ''; return d.innerHTML; }
function render() {
  const kw = q.value.trim().toLowerCase();
  const sido = sidoSel.value;
  const list = DATA.filter(d =>
    (!sido || d.sido === sido) &&
    (!onlyLink.checked || d.requestLink) &&
    (!kw || (d.libName + ' ' + d.address).toLowerCase().includes(kw)));
  countEl.textContent = list.length + '개 도서관 (전체 ' + DATA.length + '개)';
  rowsEl.innerHTML = list.slice(0, 1500).map(d => '<tr><td>' + esc(d.libName) + '</td>'
    + '<td>' + esc(d.address) + (d.closed ? '<div class="muted">휴관: ' + esc(d.closed) + '</div>' : '') + '</td>'
    + '<td>' + esc(d.tel) + '</td>'
    + '<td>' + (d.homepage ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(d.homepage) + '">홈페이지</a> ' : '')
    + (d.requestLink ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(d.requestLink) + '">희망도서 신청</a>' : '<span class="muted">' + esc(d.requestLinkStatus || '링크 미탐색') + '</span>')
    + '</td></tr>').join('');
}
q.addEventListener('input', render);
sidoSel.addEventListener('change', render);
onlyLink.addEventListener('change', render);
render();
</script>
</body>
</html>
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.key) {
    console.error('정보나루 API 인증키가 필요합니다. --key 옵션 또는 DATA4LIBRARY_KEY 환경변수로 지정하세요.');
    console.error('인증키 발급: https://www.data4library.kr/apiUtilization (무료, 회원가입 후 신청)');
    process.exit(1);
  }
  const libs = await fetchAllLibraries(opts);
  console.log(`총 ${libs.length}개 도서관 수집 완료`);

  if (opts.findRequestLinks) {
    await probeAll(libs, opts);
    const found = libs.filter(l => l.requestLink).length;
    console.log(`희망도서 신청 링크 확인: ${found}/${libs.length}`);
  }

  await fs.mkdir(opts.out, { recursive: true });
  await fs.writeFile(path.join(opts.out, 'libraries.json'), JSON.stringify(libs, null, 2));
  await fs.writeFile(path.join(opts.out, 'libraries.csv'), toCsv(libs));
  await fs.writeFile(path.join(opts.out, 'index.html'), toHtml(libs));
  console.log(`출력 완료: ${opts.out}/libraries.csv (엑셀), libraries.json, index.html (브라우저로 열기)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('\n실패:', e.message); process.exit(1); });
}
