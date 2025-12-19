(() => {
  // 팝업 2개(순차 표시). 각 팝업마다 "오늘 하루 열지 않기" key가 다름.
  const POPUPS = [
    { id: "p1", storageKey: "sp_hideDate_p1" },
    { id: "p2", storageKey: "sp_hideDate_p2" },
  ];

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const body = document.body;

  const qsOverlay = (id) =>
    document.querySelector(`.sp-overlay[data-sp="${id}"]`);

  const lockScroll = () => {
    // 배경 스크롤 방지(쇼핑몰 팝업 느낌 핵심)
    body.dataset.spScrollLock = "1";
    body._spPrevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
  };

  const unlockScroll = () => {
    delete body.dataset.spScrollLock;
    body.style.overflow = body._spPrevOverflow || "";
    delete body._spPrevOverflow;
  };

  const open = (overlay) => {
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    lockScroll();
  };

  const close = (overlay) => {
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    // 현재 열려있는 팝업이 더 없으면 스크롤 해제
    const anyOpen = Array.from(document.querySelectorAll(".sp-overlay")).some(
      (el) => !el.hidden
    );
    if (!anyOpen) unlockScroll();
  };

  const isHiddenToday = (key) => localStorage.getItem(key) === today;

  function showSequential(index) {
    if (index >= POPUPS.length) return;

    const p = POPUPS[index];
    const overlay = qsOverlay(p.id);
    if (!overlay) return showSequential(index + 1);

    if (isHiddenToday(p.storageKey)) {
      return showSequential(index + 1);
    }

    open(overlay);
    overlay._next = () => showSequential(index + 1);
  }

  // 버튼 클릭 처리
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sp-action][data-sp-target]");
    if (!btn) return;

    const action = btn.getAttribute("data-sp-action");
    const target = btn.getAttribute("data-sp-target");

    const popup = POPUPS.find((x) => x.id === target);
    const overlay = qsOverlay(target);
    if (!popup || !overlay) return;

    if (action === "hide-today") {
      localStorage.setItem(popup.storageKey, today);
      close(overlay);
      if (overlay._next) overlay._next();
      return;
    }

    if (action === "close") {
      close(overlay);
      if (overlay._next) overlay._next();
      return;
    }
  });

  // ESC로 닫기(보통 쇼핑몰 팝업 UX)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openOverlay = Array.from(
      document.querySelectorAll(".sp-overlay")
    ).find((el) => !el.hidden);
    if (!openOverlay) return;
    close(openOverlay);
    if (openOverlay._next) openOverlay._next();
  });

  // 딤 클릭으로 닫는 동작은 스샷 느낌에선 보통 "안 닫히게" 해두는 경우가 많아서 넣지 않았음.
  // 원하면 바로 추가 가능.

  // 시작(페이지 진입 시 표시)
  showSequential(0);
})();
