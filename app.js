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

// 검색어에 한글 음절(가-힣)이 들어있는지
function hasHangulSyllables(s) {
  return /[가-힣]/.test((s ?? "").toString());
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
 * 검색 인덱스 (✅ iid 제외)
 *************************************************/
function buildEmployeeSearchIndex(e) {
  const name = (e.name ?? "").toString();
  const org = (e.organization ?? "").toString();
  const title = (e.title ?? "").toString();
  const phoneRaw = (e.phone ?? "").toString();
  const phoneDisplay = e.__phoneDisplay ?? formatPhoneForDisplay(phoneRaw);

  // ✅ iid는 검색 대상에서 제외
  const basicKey = normBasic(
    [name, org, title, phoneRaw, phoneDisplay].join(" | ")
  );
  const digitsKey = onlyDigits(phoneRaw);

  // 초성 키(이름/조직/직함)
  const chosungKey =
    getChosungString(name) +
    " " +
    getChosungString(org) +
    " " +
    getChosungString(title);

  // "정확 문자열 매칭용" 원문 필드도 따로 유지(오매칭 줄이기)
  const nameNorm = normBasic(name);
  const orgNorm = normBasic(org);
  const titleNorm = normBasic(title);
  const phoneDispNorm = normBasic(phoneDisplay);

  return {
    basicKey,
    digitsKey,
    chosungKey,
    nameNorm,
    orgNorm,
    titleNorm,
    phoneDispNorm,
  };
}

/*************************************************
 * ✅ 핵심 수정: 초성 매칭은 "초성-only" 입력일 때만 적용
 *************************************************/
function matchesEmployee(e, idx, qRaw) {
  const q = (qRaw ?? "").toString().trim();
  if (!q) return true;

  // 1) 숫자 포함이면 전화 digits 우선
  const qDigits = onlyDigits(q);
  if (qDigits.length >= 2) {
    if (idx.digitsKey.includes(qDigits)) return true;
    // 숫자 섞인 검색어라도 아래 일반 매칭도 진행
  }

  // 2) 초성-only 검색일 때만 초성 매칭
  const isChosungQuery = /^[ㄱ-ㅎ]+$/.test(q);
  if (isChosungQuery) {
    return idx.chosungKey.replace(/\s+/g, "").includes(q);
  }

  // 3) 일반 검색: 한글 음절이 포함된 경우(예: "최지원")는
  //    초성으로 절대 보조매칭하지 않고, 실제 문자열 포함만 본다.
  const qNorm = normBasic(q);
  if (!qNorm) return true;

  if (hasHangulSyllables(qNorm)) {
    // 정확 문자열 포함(이름/조직/직함/표시전화)
    if (idx.nameNorm.includes(qNorm)) return true;
    if (idx.orgNorm.includes(qNorm)) return true;
    if (idx.titleNorm.includes(qNorm)) return true;
    if (idx.phoneDispNorm.includes(qNorm)) return true;
    // fallback: 합친 basicKey에도 포함되면 true
    if (idx.basicKey.includes(qNorm)) return true;
    return false;
  }

  // 4) 영문/그 외는 기존처럼 basicKey 부분일치
  if (idx.basicKey.includes(qNorm)) return true;

  // ✅ 이전에 있던 "qChos 혼합 입력 대응" 로직은 오매칭의 원인이라 제거함.
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
    const orgName = normalizeOrgName(e.organization);
    const key = e.organizationKey ? e.organizationKey : orgKeyOf(orgName);

    if (!map.has(key)) map.set(key, { orgKey: key, orgName, employees: [] });

    const phoneRaw = e.phone ?? "";
    const phoneDisplay = formatPhoneForDisplay(phoneRaw);

    map.get(key).employees.push({
      // iid는 데이터에 남겨도 되지만 UI/검색에 사용하지 않음
      iid: e.iid ?? "",
      name: e.name ?? "",
      organization: orgName,
      organizationKey: key,
      title: e.title ?? "",
      phone: phoneRaw,
      __phoneDisplay: phoneDisplay,
    });
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) => (a.orgName || "").localeCompare(b.orgName || "", "ko"));

  for (const g of groups) {
    g.employees.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "ko")
    );
  }

  return groups.map((g) => ({
    orgKey: g.orgKey,
    orgName: g.orgName,
    count: g.employees.length,
    employees: g.employees,
  }));
}

function coerceToGroups(data) {
  // by_org 형식이면 그대로
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    Array.isArray(data[0]?.employees)
  ) {
    return data.map((g) => ({
      orgKey: g.orgKey || orgKeyOf(g.orgName),
      orgName: normalizeOrgName(g.orgName),
      employees: (Array.isArray(g.employees) ? g.employees : []).map((e) => ({
        iid: e.iid ?? "",
        name: e.name ?? "",
        organization: normalizeOrgName(e.organization ?? g.orgName),
        organizationKey: e.organizationKey ?? (g.orgKey || orgKeyOf(g.orgName)),
        title: e.title ?? "",
        phone: e.phone ?? "",
        __phoneDisplay: formatPhoneForDisplay(e.phone ?? ""),
      })),
    }));
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

    const orgName = document.createElement("div");
    orgName.className = "orgName";
    orgName.innerHTML = highlight(
      g.orgName || "(No Organization)",
      STATE.query
    );

    const sub = document.createElement("div");
    sub.className = "orgSub";
    sub.textContent = `검색 매칭: ${g.count}명`;

    left.appendChild(orgName);
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
