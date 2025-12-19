/*************************************************
 * 설정
 *************************************************/
const DATA_URL = "./data/workday_employees_min (3).json";

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
  return s.replace(/^Advantech\s*>>\s*/i, "").trim();
}

/*************************************************
 * 전화번호 표시 포맷
 * - "582 x400" / "582x400" => "400"
 * - "+82 10-5755-2576" / "+8210..." => "010-5755-2576"
 *************************************************/
function formatKoreanMobile(digits) {
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function isExtRaw(rawPhone) {
  const raw = (rawPhone ?? "").toString().trim();
  return /^\s*582\s*[xX]\s*/.test(raw);
}

function extractExt(rawPhone) {
  const raw = (rawPhone ?? "").toString().trim();
  const m = raw.match(/^\s*582\s*[xX]\s*([0-9A-Za-z-]+)\s*$/);
  return m ? m[1] : "";
}

/**
 * 표시용 "숫자 포맷"만 반환(라벨 없음)
 * - 내선이면 ext 숫자만
 * - +82 휴대폰이면 010-xxxx-xxxx
 * - 010이면 010-xxxx-xxxx
 */
function formatPhoneForDisplay(rawPhone) {
  const raw = (rawPhone ?? "").toString().trim();
  if (!raw) return "";

  // 내선
  const ext = extractExt(raw);
  if (ext) return ext;

  // +82 제거 + 10 -> 010
  const rawNoSpace = raw.replace(/\s+/g, " ").trim();

  // ✅ FIX: "+8210..."도 매칭되도록 \b 제거
  if (/^\+82/.test(rawNoSpace)) {
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

/**
 * 화면 라벨 포함 문자열 생성
 * - 내선: EXT : 310
 * - 010: Phone : 010-1234-5678
 * - 그 외: 그대로
 */
function buildPhoneLabel(rawPhone) {
  const raw = (rawPhone ?? "").toString().trim();
  if (!raw) return "";

  if (isExtRaw(raw)) {
    const ext = extractExt(raw);
    return ext ? `EXT : ${ext}` : "";
  }

  const disp = formatPhoneForDisplay(raw);
  if (!disp) return "";

  if (disp.startsWith("010")) return `Phone : ${disp}`;
  return disp;
}

/**
 * mobilePhone도 동일 규칙으로 표시(라벨은 Phone 로 통일 요청대로)
 */
function buildMobileLabel(rawMobile) {
  const raw = (rawMobile ?? "").toString().trim();
  if (!raw) return "";

  const disp = formatPhoneForDisplay(raw);
  if (!disp) return "";

  if (disp.startsWith("010")) return `Phone : ${disp}`;
  return disp;
}

/**
 * 중복 판단용 canonical (숫자만 / ext는 EXT:값)
 */
function phoneCanonical(raw) {
  const r = (raw ?? "").toString().trim();
  if (!r) return "";
  if (isExtRaw(r)) return `EXT:${extractExt(r)}`;
  // +82/공백/하이픈 등 다 제거 → 숫자만
  return onlyDigits(r.startsWith("+82") ? r.replace(/^\+82/, "") : r);
}

/**
 * 모바일 표시 여부:
 * - phone이 내선이면: mobile 무조건 표시
 * - phone과 mobile이 같은 번호면: mobile 숨김
 * - 그 외: 표시
 */
function shouldShowMobile(e) {
  const m = (e.mobilePhone ?? "").toString().trim();
  if (!m) return false;

  const p = (e.phone ?? "").toString().trim();

  if (isExtRaw(p)) return true;

  const pc = phoneCanonical(p);
  const mc = phoneCanonical(m);

  if (pc && mc && pc === mc) return false;

  return true;
}

/*************************************************
 * 검색 인덱스 (iid 제외) - ✅ mobile 포함
 *************************************************/
function buildEmployeeSearchIndex(e) {
  const name = (e.name ?? "").toString();

  const orgRaw = (e.organization ?? "").toString();
  const orgDisplay = e.__orgDisplay ?? stripOrgPrefix(orgRaw);

  const title = (e.title ?? "").toString();

  const phoneRaw = (e.phone ?? "").toString();
  const phoneLabel = buildPhoneLabel(phoneRaw);
  const phoneDigits = onlyDigits(phoneCanonical(phoneRaw));

  const mobileRaw = (e.mobilePhone ?? "").toString();
  const mobileLabel = buildMobileLabel(mobileRaw);
  const mobileDigits = onlyDigits(phoneCanonical(mobileRaw));

  const basicKey = normBasic(
    [
      name,
      orgRaw,
      orgDisplay,
      title,
      phoneRaw,
      phoneLabel,
      mobileRaw,
      mobileLabel,
    ].join(" | ")
  );

  const digitsKey = [phoneDigits, mobileDigits].filter(Boolean).join("|");

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
  const phoneDispNorm = normBasic(phoneLabel);
  const mobileDispNorm = normBasic(mobileLabel);

  return {
    basicKey,
    digitsKey,
    chosungKey,
    nameNorm,
    orgRawNorm,
    orgDispNorm,
    titleNorm,
    phoneDispNorm,
    mobileDispNorm,
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

  // 3) 한글 음절 포함이면 정확 문자열 포함만
  const qNorm = normBasic(q);
  if (!qNorm) return true;

  if (hasHangulSyllables(qNorm)) {
    if (idx.nameNorm.includes(qNorm)) return true;
    if (idx.orgRawNorm.includes(qNorm)) return true;
    if (idx.orgDispNorm.includes(qNorm)) return true;
    if (idx.titleNorm.includes(qNorm)) return true;
    if (idx.phoneDispNorm.includes(qNorm)) return true;
    if (idx.mobileDispNorm.includes(qNorm)) return true;
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

    map.get(key).employees.push({
      iid: e.iid ?? "",
      name: e.name ?? "",
      organization: orgRaw,
      __orgDisplay: orgDisplay,
      organizationKey: key,
      title: e.title ?? "",
      phone: e.phone ?? "",
      // ✅ 추가: mobilePhone 유지
      mobilePhone: e.mobilePhone ?? "",
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
          // ✅ 추가: mobilePhone 유지
          mobilePhone: e.mobilePhone ?? "",
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

      // ✅ phone 1줄
      const phoneLabel = buildPhoneLabel(e.phone ?? "");
      let html = "";
      if (phoneLabel) {
        html += `<div>${highlight(phoneLabel, STATE.query)}</div>`;
      }

      // ✅ mobile 2줄 (조건부)
      if (shouldShowMobile(e)) {
        const mobileLabel = buildMobileLabel(e.mobilePhone ?? "");
        if (mobileLabel) {
          html += `<div>${highlight(mobileLabel, STATE.query)}</div>`;
        }
      }

      ph.innerHTML = html;

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
