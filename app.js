/*************************************************
 * 설정
 *************************************************/
const DATA_URL = "./data/workday_employees_by_org.json";

/*************************************************
 * 한글 초성 처리
 *************************************************/
const CHOSUNG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

function isHangulSyllable(code) {
  return code >= 0xac00 && code <= 0xd7a3;
}

function getChosungString(str) {
  const s = (str ?? "").toString();
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (isHangulSyllable(code)) {
      const idx = Math.floor((code - 0xac00) / 588);
      out += CHOSUNG[idx] || "";
    } else if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toLowerCase();
    } else if (/[ㄱ-ㅎ]/.test(ch)) {
      out += ch;
    } else {
      // ignore
    }
  }
  return out;
}

/*************************************************
 * 정규화 / 유틸
 *************************************************/
function normBasic(s) {
  return (s ?? "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

function onlyDigits(s) {
  return (s ?? "").toString().replace(/\D+/g, "");
}

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlight(text, q) {
  const t = (text ?? "").toString();
  if (!q) return escapeHtml(t);

  // 초성-only 검색어는 하이라이트 생략
  const isChosungQuery = /^[ㄱ-ㅎ]+$/.test(q);
  if (isChosungQuery) return escapeHtml(t);

  const idx = t.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return escapeHtml(t);

  const before = escapeHtml(t.slice(0, idx));
  const mid = escapeHtml(t.slice(idx, idx + q.length));
  const after = escapeHtml(t.slice(idx + q.length));
  return `${before}<span class="hl">${mid}</span>${after}`;
}

function hasHangulSyllables(s) {
  return /[가-힣]/.test((s ?? "").toString());
}

/*************************************************
 * ✅ 조직명 표시 포맷: "Advantech >> " 제거
 *************************************************/
function stripOrgPrefix(org) {
  const s = (org ?? "").toString().trim();
  // "Advantech >>" 뒤 공백/특수공백까지 허용
  return s.replace(/^Advantech\s*>>\s*/i, "").trim();
}

/*************************************************
 * 전화번호 표시 포맷
 * - "582 x400" / "582x400" => "400"
 * - "+82 10-5755-2576" => "010-5755-2576"
 *************************************************/
function formatKoreanMobile(digits) {
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function formatPhoneForDisplay(rawPhone) {
  const raw = (rawPhone ?? "").toString().trim();
  if (!raw) return "";

  // 내선: 582 x400 / 582x400 -> "400"
  const mExt = raw.match(/^\s*582\s*[xX]\s*([0-9A-Za-z-]+)\s*$/);
  if (mExt) return mExt[1];

  // +82 제거 + 10 -> 010
  const rawNoSpace = raw.replace(/\s+/g, " ").trim();
  if (/^\+82\b/.test(rawNoSpace)) {
    let rest = rawNoSpace.replace(/^\+82\s*/i, "").trim();
    let d = onlyDigits(rest);
    if (d.startsWith("10")) d = "0" + d; // 10xxxxxxxxx -> 010xxxxxxxxx
    if (d.startsWith("010")) return formatKoreanMobile(d);
    return d;
  }

  const d = onlyDigits(raw);
  if (d.startsWith("010") && (d.length === 10 || d.length === 11))
    return formatKoreanMobile(d);

  return raw;
}

/*************************************************
 * 검색 인덱스 (iid 제외)
 *************************************************/
function buildEmployeeSearchIndex(e) {
  const name = (e.name ?? "").toString();

  const orgRaw = (e.organization ?? "").toString();
  const orgDisplay = e.__orgDisplay ?? stripOrgPrefix(orgRaw);

  const title = (e.title ?? "").toString();
  const phoneRaw = (e.phone ?? "").toString();
  const phoneDisplay = e.__phoneDisplay ?? formatPhoneForDisplay(phoneRaw);

  // ✅ 조직은 원본/표시용 둘 다 인덱스에 넣어 검색 유지
  // ✅ iid는 포함하지 않음
  const basicKey = normBasic(
    [name, orgRaw, orgDisplay, title, phoneRaw, phoneDisplay].join(" | ")
  );
  const digitsKey = onlyDigits(phoneRaw);

  const chosungKey =
    getChosungString(name) +
    " " +
    getChosungString(orgRaw) +
    " " +
    getChosungString(orgDisplay) +
    " " +
    getChosungString(title);

  const nameNorm = normBasic(name);
  const orgRawNorm = normBasic(orgRaw);
  const orgDispNorm = normBasic(orgDisplay);
  const titleNorm = normBasic(title);
  const phoneDispNorm = normBasic(phoneDisplay);

  return {
    basicKey,
    digitsKey,
    chosungKey,
    nameNorm,
    orgRawNorm,
    orgDispNorm,
    titleNorm,
    phoneDispNorm,
  };
}

/*************************************************
 * ✅ 핵심: 초성 매칭은 "초성-only" 입력일 때만
 *************************************************/
function matchesEmployee(e, idx, qRaw) {
  const q = (qRaw ?? "").toString().trim();
  if (!q) return true;

  // 1) 숫자(전화) 우선
  const qDigits = onlyDigits(q);
  if (qDigits.length >= 2) {
    if (idx.digitsKey.includes(qDigits)) return true;
  }

  // 2) 초성-only 입력이면 초성으로만 매칭
  const isChosungQuery = /^[ㄱ-ㅎ]+$/.test(q);
  if (isChosungQuery) {
    return idx.chosungKey.replace(/\s+/g, "").includes(q);
  }

  // 3) 한글 음절 포함(예: "최지원")이면 정확 문자열 포함만
  const qNorm = normBasic(q);
  if (!qNorm) return true;

  if (hasHangulSyllables(qNorm)) {
    if (idx.nameNorm.includes(qNorm)) return true;
    if (idx.orgRawNorm.includes(qNorm)) return true;
    if (idx.orgDispNorm.includes(qNorm)) return true;
    if (idx.titleNorm.includes(qNorm)) return true;
    if (idx.phoneDispNorm.includes(qNorm)) return true;
    if (idx.basicKey.includes(qNorm)) return true;
    return false;
  }

  // 4) 영문/기타는 basicKey 부분일치
  if (idx.basicKey.includes(qNorm)) return true;

  return false;
}

/*************************************************
 * flat(JSON) -> organization 그룹핑
 *************************************************/
function normalizeOrgName(org) {
  const s = (org ?? "").toString().trim();
  return s ? s : "(No Organization)";
}

function orgKeyOf(orgName) {
  return normBasic(orgName) || "(no_organization)";
}

function groupEmployeesByOrg(employees) {
  const map = new Map();

  for (const e of employees) {
    const orgRaw = normalizeOrgName(e.organization);
    const orgDisplay = stripOrgPrefix(orgRaw);
    const key = e.organizationKey ? e.organizationKey : orgKeyOf(orgRaw);

    if (!map.has(key)) {
      map.set(key, {
        orgKey: key,
        orgName: orgRaw,
        orgDisplayName: orgDisplay,
        employees: [],
      });
    }

    const phoneRaw = e.phone ?? "";
    const phoneDisplay = formatPhoneForDisplay(phoneRaw);

    map.get(key).employees.push({
      iid: e.iid ?? "", // UI/검색에서 iid는 사용 안 함
      name: e.name ?? "",
      organization: orgRaw,
      __orgDisplay: orgDisplay,
      organizationKey: key,
      title: e.title ?? "",
      phone: phoneRaw,
      __phoneDisplay: phoneDisplay,
    });
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) =>
    (a.orgDisplayName || "").localeCompare(b.orgDisplayName || "", "ko")
  );

  for (const g of groups) {
    g.employees.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "ko")
    );
  }

  return groups.map((g) => ({
    orgKey: g.orgKey,
    orgName: g.orgName,
    orgDisplayName: g.orgDisplayName,
    count: g.employees.length,
    employees: g.employees,
  }));
}

function coerceToGroups(data) {
  // by_org 형식이면 그대로 (표시용만 보강)
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    Array.isArray(data[0]?.employees)
  ) {
    return data.map((g) => {
      const orgRaw = normalizeOrgName(g.orgName);
      const orgDisplay = stripOrgPrefix(orgRaw);
      const key = g.orgKey || orgKeyOf(orgRaw);

      const emps = (Array.isArray(g.employees) ? g.employees : []).map((e) => {
        const eOrgRaw = normalizeOrgName(e.organization ?? orgRaw);
        const eOrgDisp = stripOrgPrefix(eOrgRaw);
        return {
          iid: e.iid ?? "",
          name: e.name ?? "",
          organization: eOrgRaw,
          __orgDisplay: eOrgDisp,
          organizationKey: e.organizationKey ?? key,
          title: e.title ?? "",
          phone: e.phone ?? "",
          __phoneDisplay: formatPhoneForDisplay(e.phone ?? ""),
        };
      });

      return {
        orgKey: key,
        orgName: orgRaw,
        orgDisplayName: orgDisplay,
        employees: emps,
      };
    });
  }

  // flat 형식(네 파일)
  if (Array.isArray(data)) return groupEmployeesByOrg(data);

  // 래퍼 객체 대응
  if (data && typeof data === "object") {
    if (Array.isArray(data.groups)) return coerceToGroups(data.groups);
    if (Array.isArray(data.data)) return coerceToGroups(data.data);
    if (Array.isArray(data.items)) return coerceToGroups(data.items);
  }

  return [];
}

/*************************************************
 * 렌더링
 *************************************************/
let RAW_GROUPS = [];
let STATE = { query: "", expandAllMatches: false };

function setStatus(text) {
  document.getElementById("statusPill").textContent = text;
}

function computeStats(groups) {
  let people = 0;
  for (const g of groups) people += g?.employees?.length || 0;
  return { orgs: groups.length, people };
}

function filterGroups(groups, query) {
  const out = [];
  let matchedPeople = 0;

  for (const g of groups) {
    const employees = Array.isArray(g.employees) ? g.employees : [];
    const filtered = [];

    for (const e of employees) {
      const idx = e.__idx || (e.__idx = buildEmployeeSearchIndex(e));
      if (matchesEmployee(e, idx, query)) filtered.push(e);
    }

    if (filtered.length > 0) {
      out.push({
        orgKey: g.orgKey,
        orgName: g.orgName,
        orgDisplayName: g.orgDisplayName ?? stripOrgPrefix(g.orgName),
        count: filtered.length,
        employees: filtered,
      });
      matchedPeople += filtered.length;
    }
  }

  return { groups: out, matchedPeople };
}

function render(groups, query, matchedPeople) {
  const app = document.getElementById("app");
  app.innerHTML = "";

  document.getElementById("matchedPeople").textContent =
    matchedPeople.toString();

  if (groups.length === 0) {
    app.innerHTML = `<div class="small">검색 결과가 없습니다.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const g of groups) {
    const details = document.createElement("details");
    details.className = "org";
    details.open = !!STATE.query && STATE.expandAllMatches;

    const summary = document.createElement("summary");
    summary.className = "orgHead";

    const left = document.createElement("div");
    left.className = "orgTitle";

    const orgNameEl = document.createElement("div");
    orgNameEl.className = "orgName";

    // ✅ 표시용: Advantech >> 제거된 이름
    const displayOrg = g.orgDisplayName ?? stripOrgPrefix(g.orgName);
    orgNameEl.innerHTML = highlight(
      displayOrg || "(No Organization)",
      STATE.query
    );

    const sub = document.createElement("div");
    sub.className = "orgSub";
    sub.textContent = `검색 매칭: ${g.count}명`;

    left.appendChild(orgNameEl);
    left.appendChild(sub);

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = `${g.count}명`;

    summary.appendChild(left);
    summary.appendChild(badge);

    const body = document.createElement("div");
    body.className = "orgBody";

    const list = document.createElement("div");
    list.className = "list";

    for (const e of g.employees) {
      const row = document.createElement("div");
      row.className = "row";

      const l = document.createElement("div");
      l.className = "left";

      const nm = document.createElement("div");
      nm.className = "name";
      nm.innerHTML = highlight(e.name || "", STATE.query);

      const tt = document.createElement("div");
      tt.className = "title";
      tt.innerHTML = highlight(e.title || "", STATE.query);

      const ph = document.createElement("div");
      ph.className = "phone";
      const phoneDisplay =
        e.__phoneDisplay ?? formatPhoneForDisplay(e.phone ?? "");
      ph.innerHTML = highlight(phoneDisplay || "", STATE.query);

      l.appendChild(nm);
      l.appendChild(tt);
      l.appendChild(ph);

      row.appendChild(l);
      list.appendChild(row);
    }

    body.appendChild(list);

    details.appendChild(summary);
    details.appendChild(body);

    frag.appendChild(details);
  }

  app.appendChild(frag);
}

/*************************************************
 * 로드 & 이벤트
 *************************************************/
async function loadData() {
  setStatus("JSON 로딩중…");
  const err = document.getElementById("err");
  err.style.display = "none";
  err.textContent = "";

  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const data = await res.json();
    RAW_GROUPS = coerceToGroups(data);

    const st = computeStats(RAW_GROUPS);
    document.getElementById("totalPeople").textContent = st.people.toString();
    document.getElementById("totalOrgs").textContent = st.orgs.toString();

    setStatus(`준비완료 · ${st.people}명`);
    applySearch();
  } catch (e) {
    setStatus("로딩 실패");
    err.style.display = "block";
    err.textContent =
      `데이터 로딩 실패: ${e?.message || e}\n` +
      `확인: 1) ${DATA_URL} 경로/파일명 2) file:// 말고 http로 열기(GitHub Pages 또는 로컬 서버)`;
  }
}

function applySearch() {
  const q = document.getElementById("q").value || "";
  STATE.query = q.trim();

  const { groups, matchedPeople } = filterGroups(RAW_GROUPS, STATE.query);
  render(groups, STATE.query, matchedPeople);
}

function bindUI() {
  const input = document.getElementById("q");
  const btnClear = document.getElementById("btnClear");
  const btnExpand = document.getElementById("btnExpand");

  input.addEventListener("input", () => applySearch());

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      input.value = "";
      STATE.expandAllMatches = false;
      btnExpand.textContent = "결과 펼치기";
      applySearch();
    }
  });

  btnClear.addEventListener("click", () => {
    input.value = "";
    STATE.expandAllMatches = false;
    btnExpand.textContent = "결과 펼치기";
    applySearch();
    input.focus();
  });

  btnExpand.addEventListener("click", () => {
    STATE.expandAllMatches = !STATE.expandAllMatches;
    btnExpand.textContent = STATE.expandAllMatches
      ? "결과 접기"
      : "결과 펼치기";
    applySearch();
  });
}

bindUI();
loadData();
