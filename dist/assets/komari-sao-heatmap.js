(() => {
  const WEEKS = 38;
  const DAYS = WEEKS * 7;
  const STORAGE_KEY = "komari-sao-traffic-history-v1";
  const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  let currentMode = "daily"; // "daily" | "weekly" | "cumulative"
  let dailyMap = loadHistory();
  let backupData = null;
  let lastTrafficFetchTs = 0;
  let lastBackupFetchTs = 0;
  let lastDomSyncTs = 0;
  let tipEl = null;

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toLocalKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatBytes(bytes) {
    const v = Number(bytes) || 0;
    if (v <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let idx = 0;
    let num = v;
    while (num >= 1024 && idx < units.length - 1) {
      num /= 1024;
      idx++;
    }
    if (idx === 0) return `${Math.round(num)} B`;
    return `${num >= 100 ? num.toFixed(0) : num >= 10 ? num.toFixed(1) : num.toFixed(2)} ${units[idx]}`;
  }

  function parseBytesText(text) {
    if (!text) return 0;
    const m = String(text).replace(/,/g, "").match(/([\d.]+)\s*(B|KB|MB|GB|TB|PB|KiB|MiB|GiB|TiB)/i);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    if (!Number.isFinite(val)) return 0;
    const unit = m[2].toUpperCase();
    const mult = {
      B: 1, KB: 1024, KIB: 1024,
      MB: 1024 ** 2, MIB: 1024 ** 2,
      GB: 1024 ** 3, GIB: 1024 ** 3,
      TB: 1024 ** 4, TIB: 1024 ** 4,
      PB: 1024 ** 5,
    }[unit] || 1;
    return Math.round(val * mult);
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveHistory(map) {
    try {
      const keys = Object.keys(map).sort();
      if (keys.length > 420) {
        const trimmed = {};
        for (const k of keys.slice(-420)) trimmed[k] = map[k];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
      }
    } catch {}
  }

  function readDomTodayTrafficBytes() {
    const cards = document.querySelectorAll(".mao-dashboard-hero .mao-stat-grid .mao-stat-card");
    for (const card of cards) {
      const text = card.textContent || "";
      if (text.includes("今日流量") || text.toLowerCase().includes("today")) {
        const b = parseBytesText(text);
        if (b > 0) return b;
      }
    }
    return 0;
  }

  function buildCalendarSlots() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayKey = toLocalKey(today);
    const todayDowMon = (today.getDay() + 6) % 7;

    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (6 - todayDowMon));

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - (DAYS - 1));

    const slots = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const key = toLocalKey(d);
      const isFuture = d.getTime() > today.getTime();
      const rec = dailyMap[key] || { up: 0, down: 0 };
      const up = Number(rec.up) || 0;
      const down = Number(rec.down) || 0;
      const total = Math.max(Number(rec.total) || 0, up + down);
      slots.push({
        index: i,
        weekIndex: Math.floor(i / 7),
        date: d,
        key,
        dow: d.getDay(),
        isFuture,
        isToday: key === todayKey,
        up,
        down,
        total,
      });
    }
    return { slots, todayKey };
  }

  function computeLevels(values) {
    const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (nonZero.length === 0) return () => 0;
    const maxVal = nonZero[nonZero.length - 1];
    const q1 = nonZero.length >= 4 ? nonZero[Math.floor(nonZero.length * 0.25)] : maxVal * 0.25;
    const q2 = nonZero.length >= 4 ? nonZero[Math.floor(nonZero.length * 0.5)] : maxVal * 0.5;
    const q3 = nonZero.length >= 4 ? nonZero[Math.floor(nonZero.length * 0.75)] : maxVal * 0.75;
    return (v) => {
      if (v <= 0) return 0;
      if (v <= q1 && q1 < maxVal) return 1;
      if (v <= q2 && q2 < maxVal) return 2;
      if (v <= q3 && q3 < maxVal) return 3;
      return 4;
    };
  }

  function ensureTooltip() {
    if (tipEl && document.body.contains(tipEl)) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "sao-hm-tip";
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function showTooltip(target, html) {
    if (!html) return;
    const tip = ensureTooltip();
    tip.innerHTML = html;
    tip.classList.add("is-show");
    const rect = target.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 8;
    if (left < 8) left = 8;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tipRect.width - 8;
    }
    if (top < 8) top = rect.bottom + 8;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    if (tipEl) tipEl.classList.remove("is-show");
  }

  let earlyHeatmapConsumed = false;

  function applyTrafficArchiveDays(days) {
    if (!days || typeof days !== "object") return false;
    const nextMap = { ...dailyMap };
    let changed = false;
    for (const [dayKey, vals] of Object.entries(days)) {
      if (!vals || typeof vals !== "object") continue;
      const prev = nextMap[dayKey] || { up: 0, down: 0, total: 0 };
      const up = Math.max(Number(prev.up) || 0, Number(vals.up) || 0);
      const down = Math.max(Number(prev.down) || 0, Number(vals.down) || 0);
      const total = Math.max(Number(prev.total) || 0, Number(vals.total) || 0, up + down);
      if (up !== prev.up || down !== prev.down || total !== prev.total) {
        nextMap[dayKey] = { up, down, total };
        changed = true;
      }
    }
    if (changed) {
      dailyMap = nextMap;
      saveHistory(dailyMap);
    }
    return changed;
  }

  async function fetchHeatmapRemoteData(force = false) {
    if (!force && document.hidden) return;
    const now = Date.now();
    if (!force && now - lastTrafficFetchTs < 60_000) return;
    lastTrafficFetchTs = now;
    lastBackupFetchTs = now;
    try {
      let combined = null;
      if (!earlyHeatmapConsumed && window.__EARLY_DATA__?.routes_all) {
        earlyHeatmapConsumed = true;
        combined = await window.__EARLY_DATA__.routes_all;
      } else {
        earlyHeatmapConsumed = true;
        const res = await fetch("/routes/api?kind=all", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (res.ok) combined = await res.json();
      }
      if (!combined || typeof combined !== "object") return;
      let shouldRender = false;
      if (applyTrafficArchiveDays(combined.traffic?.days)) shouldRender = true;
      if (combined.backup && typeof combined.backup === "object") {
        backupData = combined.backup;
        shouldRender = true;
      }
      if (shouldRender) renderHeatmapCard();
    } catch {}
  }

  function syncDomTodayOnly() {
    const domToday = readDomTodayTrafficBytes();
    if (domToday <= 0) return false;
    const todayKey = toLocalKey(new Date());
    const cur = dailyMap[todayKey] || { up: 0, down: 0, total: 0 };
    if (domToday > cur.total) {
      dailyMap[todayKey] = { up: cur.up, down: cur.down, total: domToday };
      saveHistory(dailyMap);
      return true;
    }
    return false;
  }

  function buildMonthLabels(slots) {
    const spans = Array(WEEKS).fill("");
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const d = slots[w * 7].date;
      const m = d.getMonth();
      if (m !== lastMonth) {
        if (w === 0 || w - spans.findLastIndex((x) => x !== "") >= 3) {
          spans[w] = `${m + 1}月`;
          lastMonth = m;
        }
      }
    }
    return spans;
  }

  function renderHeatmapCard() {
    const card = document.querySelector(".sao-hm-card");
    if (!card) return;

    syncDomTodayOnly();
    const { slots, todayKey } = buildCalendarSlots();

    const weeklyTotals = Array.from({ length: WEEKS }, () => ({ up: 0, down: 0, total: 0, start: "", end: "" }));
    for (const s of slots) {
      const w = weeklyTotals[s.weekIndex];
      if (!w.start) w.start = s.key;
      w.end = s.key;
      if (!s.isFuture) {
        w.up += s.up;
        w.down += s.down;
        w.total += s.total;
      }
    }

    let runningTotal = 0;
    const cumulativeTotals = slots.map((s) => {
      if (!s.isFuture) runningTotal += s.total;
      return runningTotal;
    });

    const activeValues =
      currentMode === "weekly"
        ? slots.map((s) => (s.isFuture ? 0 : weeklyTotals[s.weekIndex].total))
        : currentMode === "cumulative"
          ? slots.map((s, idx) => (s.isFuture ? 0 : cumulativeTotals[idx]))
          : slots.map((s) => (s.isFuture ? 0 : s.total));

    const getLv = computeLevels(activeValues);

    const subEl = card.querySelector(".sao-hm-sub");
    const summaryEl = card.querySelector(".sao-hm-summary");
    const todaySlot = slots.find((s) => s.key === todayKey);
    const todayTotal = todaySlot ? todaySlot.total : 0;

    let activeDays = 0;
    let peakSlot = null;
    for (const s of slots) {
      if (!s.isFuture && s.total > 0) {
        activeDays++;
        if (!peakSlot || s.total > peakSlot.total) peakSlot = s;
      }
    }

    if (currentMode === "weekly") {
      const peakWeek = weeklyTotals.reduce((best, w, idx) => (w.total > best.total ? { ...w, idx } : best), { total: -1, idx: 0 });
      subEl.textContent = `近 ${WEEKS} 周每周汇总 · 今日已用 ${formatBytes(todayTotal)}`;
      summaryEl.innerHTML =
        peakWeek.total > 0
          ? `峰值周：<strong>${peakWeek.start.slice(5)} ~ ${peakWeek.end.slice(5)} · ${formatBytes(peakWeek.total)}</strong> · 活跃 ${activeDays} 天`
          : `今日实时：<strong>${formatBytes(todayTotal)}</strong> · 等待更多周数据累积`;
    } else if (currentMode === "cumulative") {
      subEl.textContent = `统计期累计总流量 ${formatBytes(runningTotal)} · 含全站上行与下行`;
      summaryEl.innerHTML = `近 ${WEEKS} 周累计：<strong>${formatBytes(runningTotal)}</strong> · 今日新增 <strong>${formatBytes(todayTotal)}</strong>`;
    } else {
      subEl.textContent = `近 ${WEEKS} 周每日总流量 · 今日已用 ${formatBytes(todayTotal)}`;
      summaryEl.innerHTML =
        peakSlot && peakSlot.total > 0
          ? `峰值日：<strong>${peakSlot.key} · ${formatBytes(peakSlot.total)}</strong> · 共活跃 ${activeDays} 天`
          : `今日已用：<strong>${formatBytes(todayTotal)}</strong> · 历史每日数据将持续自动累积`;
    }

    card.querySelectorAll(".sao-hm-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === currentMode);
    });

    // In-place diff update for 38 backup track dots (zero DOM rebuild)
    const bkHistory = backupData && typeof backupData.history === "object" ? backupData.history : {};
    const bkTrackEl = card.querySelector(".sao-hm-bk-track");
    if (bkTrackEl) {
      if (bkTrackEl.children.length !== WEEKS) {
        const frag = document.createDocumentFragment();
        for (let w = 0; w < WEEKS; w++) frag.appendChild(document.createElement("span"));
        bkTrackEl.replaceChildren(frag);
      }
      for (let w = 0; w < WEEKS; w++) {
        const dot = bkTrackEl.children[w];
        const monSlot = slots[w * 7];
        const rec = bkHistory[monSlot.key];
        if (rec && (rec.status === "ok" || rec.status === "failed")) {
          const isOk = rec.status === "ok";
          const cls = "sao-hm-bk-dot " + (isOk ? "is-ok" : "is-fail");
          if (dot.className !== cls) dot.className = cls;
          const sz = rec.size_bytes ? ` · ${formatBytes(rec.size_bytes)}` : "";
          const atText = rec.at ? String(rec.at).replace("T", " ").slice(0, 16) : monSlot.key;
          dot.dataset.tip = `<div>${monSlot.key} 周一 · Google Drive 备份</div><div><span class="${isOk ? "is-bk-ok" : "is-bk-fail"}">${isOk ? "同步成功" : "同步失败"}${sz}</span></div><div>执行时间：${atText}</div>`;
        } else {
          if (dot.className !== "sao-hm-bk-dot") dot.className = "sao-hm-bk-dot";
          if (dot.dataset.tip) delete dot.dataset.tip;
        }
      }
    }

    // In-place diff update for 266 heatmap cells (zero DOM rebuild)
    const gridEl = card.querySelector(".sao-hm-grid");
    if (gridEl.children.length !== DAYS) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < DAYS; i++) frag.appendChild(document.createElement("div"));
      gridEl.replaceChildren(frag);
    }

    const currentWeekIdx = todaySlot ? todaySlot.weekIndex : WEEKS - 1;
    for (let idx = 0; idx < DAYS; idx++) {
      const s = slots[idx];
      const cell = gridEl.children[idx];
      const lv = s.isFuture ? 0 : getLv(activeValues[idx]);
      const isHighlight =
        currentMode === "weekly"
          ? s.weekIndex === currentWeekIdx && !s.isFuture
          : s.isToday;
      const cls = "sao-hm-cell" + (s.isFuture ? " is-future" : "") + (isHighlight ? " is-today" : "");
      if (cell.className !== cls) cell.className = cls;
      if (lv > 0) {
        if (cell.dataset.lv !== String(lv)) cell.dataset.lv = String(lv);
      } else if (cell.dataset.lv) {
        delete cell.dataset.lv;
      }

      if (!s.isFuture) {
        const monKey = slots[s.weekIndex * 7].key;
        const bkRec = s.dow === 1 ? bkHistory[monKey] : null;
        const bkLine =
          bkRec && (bkRec.status === "ok" || bkRec.status === "failed")
            ? `<div><span class="${bkRec.status === "ok" ? "is-bk-ok" : "is-bk-fail"}">☁️ GDrive 备份${bkRec.status === "ok" ? "成功" : "失败"}${bkRec.size_bytes ? ` · ${formatBytes(bkRec.size_bytes)}` : ""}</span></div>`
            : "";

        let tipHtml = "";
        if (currentMode === "weekly") {
          const w = weeklyTotals[s.weekIndex];
          const sumSplit = w.up + w.down;
          const detail = sumSplit > 0 && sumSplit >= w.total * 0.85 ? ` (↑${formatBytes(w.up)} / ↓${formatBytes(w.down)})` : "";
          tipHtml = `<div>${w.start} ~ ${w.end} · 第 ${s.weekIndex + 1} 周</div><div>周总流量 <b>${formatBytes(w.total)}</b>${detail}</div>${bkLine}`;
        } else if (currentMode === "cumulative") {
          tipHtml = `<div>截至 ${s.key} · ${WEEKDAYS_ZH[s.dow]}</div><div>累计消耗 <b>${formatBytes(cumulativeTotals[idx])}</b> · 当日 ${formatBytes(s.total)}</div>${bkLine}`;
        } else {
          const sumSplit = s.up + s.down;
          const detail = sumSplit > 0 && sumSplit >= s.total * 0.85 ? ` (↑${formatBytes(s.up)} / ↓${formatBytes(s.down)})` : "";
          tipHtml = `<div>${s.key} · ${WEEKDAYS_ZH[s.dow]}${s.isToday ? "（今天）" : ""}</div><div>消耗流量 <b>${formatBytes(s.total)}</b>${detail}</div>${bkLine}`;
        }
        cell.dataset.tip = tipHtml;
      } else if (cell.dataset.tip) {
        delete cell.dataset.tip;
      }
    }

    // In-place month labels
    const monthsEl = card.querySelector(".sao-hm-months");
    const labels = buildMonthLabels(slots);
    const sig = labels.join("|");
    if (monthsEl.dataset.sig !== sig) {
      monthsEl.dataset.sig = sig;
      monthsEl.innerHTML = labels.map((m) => `<span>${m}</span>`).join("");
    }

    const scroller = card.querySelector(".sao-hm-scroll");
    if (scroller && !scroller.dataset.scrolledInit) {
      requestAnimationFrame(() => {
        if (scroller.scrollWidth > scroller.clientWidth) {
          scroller.scrollLeft = scroller.scrollWidth;
          scroller.dataset.scrolledInit = "1";
        }
      });
    }
  }

  function createHeatmapCard() {
    const card = document.createElement("section");
    card.className = "sao-hm-card";
    card.setAttribute("aria-label", "流量消耗热力图");
    card.innerHTML = `
      <div class="sao-hm-head">
        <div class="sao-hm-title-wrap">
          <div class="sao-hm-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <div class="sao-hm-title">消耗流量热力图</div>
            <div class="sao-hm-sub">正在同步流量数据...</div>
          </div>
        </div>
        <div class="sao-hm-tabs" role="tablist">
          <button type="button" class="sao-hm-tab is-active" data-mode="daily">每天</button>
          <button type="button" class="sao-hm-tab" data-mode="weekly">每周</button>
          <button type="button" class="sao-hm-tab" data-mode="cumulative">累计总量</button>
        </div>
      </div>
      <div class="sao-hm-body">
        <div class="sao-hm-scroll">
          <div class="sao-hm-bk-track"></div>
          <div class="sao-hm-grid"></div>
          <div class="sao-hm-months"></div>
        </div>
      </div>
      <div class="sao-hm-foot">
        <div class="sao-hm-summary">正在汇总...</div>
        <div class="sao-hm-legend">
          <span>少</span>
          <i></i>
          <i data-lv="1"></i>
          <i data-lv="2"></i>
          <i data-lv="3"></i>
          <i data-lv="4"></i>
          <span>多</span>
        </div>
      </div>
    `;

    card.querySelectorAll(".sao-hm-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentMode = btn.dataset.mode || "daily";
        hideTooltip();
        renderHeatmapCard();
      });
    });

    // Event delegation for both heatmap cells & backup track dots (3 listeners total instead of ~800)
    const scroller = card.querySelector(".sao-hm-scroll");
    scroller.addEventListener("mouseover", (e) => {
      const target = e.target.closest(".sao-hm-cell, .sao-hm-bk-dot");
      if (target && target.dataset.tip) {
        showTooltip(target, target.dataset.tip);
      }
    });
    scroller.addEventListener("mouseout", (e) => {
      const target = e.target.closest(".sao-hm-cell, .sao-hm-bk-dot");
      if (target) hideTooltip();
    });
    scroller.addEventListener("click", (e) => {
      const target = e.target.closest(".sao-hm-cell, .sao-hm-bk-dot");
      if (target && target.dataset.tip) {
        e.stopPropagation();
        showTooltip(target, target.dataset.tip);
      }
    });

    return card;
  }

  function mountIfNeeded() {
    if (document.hidden) return;
    const heroMain = document.querySelector(".mao-dashboard-hero .mao-hero-main");
    if (!heroMain) return;
    if (!heroMain.querySelector(".sao-hm-card")) {
      const card = createHeatmapCard();
      heroMain.appendChild(card);
      renderHeatmapCard();
      fetchHeatmapRemoteData(true);
    } else {
      const now = Date.now();
      if (now - lastDomSyncTs >= 10000) {
        lastDomSyncTs = now;
        if (syncDomTodayOnly()) renderHeatmapCard();
      }
    }
  }

  function init() {
    mountIfNeeded();
    const obs = new MutationObserver((mutations) => {
      if (document.hidden) return;
      if (mutations.every((m) => {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        return Boolean(el && (el.closest(".sao-hm-card") || el.closest(".sao-tile-cell") || el.closest(".sao-net-console")));
      })) return;
      mountIfNeeded();
    });
    const root = document.getElementById("root") || document.body;
    obs.observe(root, { childList: true, subtree: true });

    document.addEventListener("click", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && document.querySelector(".sao-hm-card")) {
        fetchHeatmapRemoteData(false);
      }
    });

    setInterval(() => {
      if (!document.hidden && document.querySelector(".sao-hm-card")) {
        fetchHeatmapRemoteData(false);
      }
    }, 180_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
