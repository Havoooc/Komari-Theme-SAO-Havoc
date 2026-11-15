(() => {
  const WEEKS = 38;
  const DAYS = WEEKS * 7;
  const STORAGE_KEY = "komari-sao-traffic-history-v1";
  const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  let currentMode = "daily"; // "daily" | "weekly" | "cumulative"
  let dailyMap = loadHistory();
  let backupData = null;
  let lastFetchTs = 0;
  let lastDomSyncTs = 0;
  let lastBackupFetchTs = 0;
  let fetching = false;
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
      B: 1,
      KB: 1024,
      KIB: 1024,
      MB: 1024 ** 2,
      MIB: 1024 ** 2,
      GB: 1024 ** 3,
      GIB: 1024 ** 3,
      TB: 1024 ** 4,
      TIB: 1024 ** 4,
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
      // Keep up to 420 recent days
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
    // Monday-first week index: Mon=0 .. Sun=6
    const todayDowMon = (today.getDay() + 6) % 7;

    // End of grid is Sunday of the current week
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
    return { slots, startDate, endDate, todayKey };
  }

  function computeLevels(values) {
    const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (nonZero.length === 0) return () => 0;
    const maxVal = nonZero[nonZero.length - 1];
    // Use quantile-aware thresholds when multiple active days exist, otherwise proportional
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

  function showTooltip(cell, html) {
    const tip = ensureTooltip();
    tip.innerHTML = html;
    tip.classList.add("is-show");
    const rect = cell.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 8;
    if (left < 8) left = 8;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tipRect.width - 8;
    }
    if (top < 8) {
      top = rect.bottom + 8;
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    if (tipEl) tipEl.classList.remove("is-show");
  }

  async function fetchMetrics() {
    if (fetching) return;
    const now = Date.now();
    if (now - lastFetchTs < 60_000) return;
    fetching = true;

    try {
      const { startDate } = buildCalendarSlots();
      const endDate = new Date(now + 24 * 3600 * 1000);
      const res = await fetch("/api/rpc2", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "public:queryMetrics",
          params: {
            metric_keys: ["traffic.up", "traffic.down"],
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            max_points: 500,
            aggregation_by_metric: {
              "traffic.up": "sum",
              "traffic.down": "sum",
            },
            fill_empty: false,
          },
        }),
      });

      if (!res.ok) return;
      const payload = await res.json();
      const seriesList = payload?.result?.series;
      if (!Array.isArray(seriesList)) return;

      const freshByDay = {};
      for (const s of seriesList) {
        const mKey = s?.metric_key;
        if (mKey !== "traffic.up" && mKey !== "traffic.down") continue;
        const pts = Array.isArray(s.points) ? s.points : [];
        for (const p of pts) {
          const val = Number(p?.value);
          if (!Number.isFinite(val) || val <= 0 || !p?.time) continue;
          const dt = new Date(p.time);
          if (Number.isNaN(dt.getTime())) continue;
          const dayKey = toLocalKey(dt);
          if (!freshByDay[dayKey]) freshByDay[dayKey] = { up: 0, down: 0 };
          if (mKey === "traffic.up") freshByDay[dayKey].up += val;
          else freshByDay[dayKey].down += val;
        }
      }

      const nextMap = { ...dailyMap };
      for (const [dayKey, vals] of Object.entries(freshByDay)) {
        const prev = nextMap[dayKey] || { up: 0, down: 0, total: 0 };
        const up = Math.max(Number(prev.up) || 0, Math.round(vals.up));
        const down = Math.max(Number(prev.down) || 0, Math.round(vals.down));
        nextMap[dayKey] = { up, down, total: up + down };
      }

      // Sync with today's DOM total as minimum bound
      const domToday = readDomTodayTrafficBytes();
      const todayKey = toLocalKey(new Date());
      if (domToday > 0) {
        const cur = nextMap[todayKey] || { up: 0, down: 0, total: 0 };
        if (domToday > cur.total) {
          nextMap[todayKey] = {
            up: cur.up,
            down: cur.down,
            total: domToday,
          };
        }
      }

      dailyMap = nextMap;
      saveHistory(dailyMap);
      lastFetchTs = Date.now();
      renderHeatmapCard();
    } catch {
      // Keep cached/DOM values silently
    } finally {
      fetching = false;
    }
  }

  async function fetchBackupStatus() {
    const now = Date.now();
    if (now - lastBackupFetchTs < 60_000) return;
    lastBackupFetchTs = now;
    try {
      const res = await fetch("/routes/api?kind=backup", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json && typeof json === "object") {
        backupData = json;
        renderHeatmapCard();
      }
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
        // Avoid crowded label right next to previous month at column 0/1
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

    // Precompute weekly & cumulative series
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

    let activeValues;
    if (currentMode === "weekly") {
      activeValues = slots.map((s) => (s.isFuture ? 0 : weeklyTotals[s.weekIndex].total));
    } else if (currentMode === "cumulative") {
      activeValues = slots.map((s, idx) => (s.isFuture ? 0 : cumulativeTotals[idx]));
    } else {
      activeValues = slots.map((s) => (s.isFuture ? 0 : s.total));
    }

    const getLv = computeLevels(activeValues);

    // Sub-headline & summary stats
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

    // Tabs active state
    card.querySelectorAll(".sao-hm-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === currentMode);
    });

    // Render Google Drive Weekly Sync Track (aligned with Monday column)
    const bkHistory = backupData && typeof backupData.history === "object" ? backupData.history : {};
    const bkTrackEl = card.querySelector(".sao-hm-bk-track");

    if (bkTrackEl) {
      const dotFrag = document.createDocumentFragment();
      for (let w = 0; w < WEEKS; w++) {
        const monSlot = slots[w * 7];
        const rec = bkHistory[monSlot.key];
        const dot = document.createElement("span");
        if (rec && (rec.status === "ok" || rec.status === "failed")) {
          const isOk = rec.status === "ok";
          dot.className = "sao-hm-bk-dot " + (isOk ? "is-ok" : "is-fail");
          const sz = rec.size_bytes ? ` · ${formatBytes(rec.size_bytes)}` : "";
          const atText = rec.at ? String(rec.at).replace("T", " ").slice(0, 16) : monSlot.key;
          const tipHtml = `<div>${monSlot.key} 周一 · Google Drive 备份</div><div><span class="${isOk ? "is-bk-ok" : "is-bk-fail"}">${isOk ? "同步成功" : "同步失败"}${sz}</span></div><div>执行时间：${atText}</div>`;
          dot.addEventListener("mouseenter", () => showTooltip(dot, tipHtml));
          dot.addEventListener("mouseleave", hideTooltip);
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            showTooltip(dot, tipHtml);
          });
        } else {
          dot.className = "sao-hm-bk-dot";
        }
        dotFrag.appendChild(dot);
      }
      bkTrackEl.replaceChildren(dotFrag);
    }

    // Render Grid Cells
    const gridEl = card.querySelector(".sao-hm-grid");
    const frag = document.createDocumentFragment();

    slots.forEach((s, idx) => {
      const cell = document.createElement("div");
      const val = activeValues[idx];
      const lv = s.isFuture ? 0 : getLv(val);
      cell.className = "sao-hm-cell" + (s.isFuture ? " is-future" : "") + (s.isToday ? " is-today" : "");
      if (lv > 0) cell.dataset.lv = String(lv);

      if (!s.isFuture) {
        let tipHtml = "";
        const monKey = slots[s.weekIndex * 7].key;
        const bkRec = s.dow === 1 ? bkHistory[monKey] : null;
        const bkLine =
          bkRec && (bkRec.status === "ok" || bkRec.status === "failed")
            ? `<div><span class="${bkRec.status === "ok" ? "is-bk-ok" : "is-bk-fail"}">☁️ GDrive 备份${bkRec.status === "ok" ? "成功" : "失败"}${bkRec.size_bytes ? ` · ${formatBytes(bkRec.size_bytes)}` : ""}</span></div>`
            : "";

        if (currentMode === "weekly") {
          const w = weeklyTotals[s.weekIndex];
          const sumSplit = w.up + w.down;
          const detail =
            sumSplit > 0 && sumSplit >= w.total * 0.85
              ? ` (↑${formatBytes(w.up)} / ↓${formatBytes(w.down)})`
              : "";
          tipHtml = `<div>${w.start} ~ ${w.end} · 第 ${s.weekIndex + 1} 周</div><div>周总流量 <b>${formatBytes(w.total)}</b>${detail}</div>${bkLine}`;
        } else if (currentMode === "cumulative") {
          tipHtml = `<div>截至 ${s.key} · ${WEEKDAYS_ZH[s.dow]}</div><div>累计消耗 <b>${formatBytes(cumulativeTotals[idx])}</b> · 当日 ${formatBytes(s.total)}</div>${bkLine}`;
        } else {
          const sumSplit = s.up + s.down;
          const detail =
            sumSplit > 0 && sumSplit >= s.total * 0.85
              ? ` (↑${formatBytes(s.up)} / ↓${formatBytes(s.down)})`
              : "";
          tipHtml = `<div>${s.key} · ${WEEKDAYS_ZH[s.dow]}${s.isToday ? "（今天）" : ""}</div><div>消耗流量 <b>${formatBytes(s.total)}</b>${detail}</div>${bkLine}`;
        }
        cell.addEventListener("mouseenter", () => showTooltip(cell, tipHtml));
        cell.addEventListener("mouseleave", hideTooltip);
        cell.addEventListener("click", (e) => {
          e.stopPropagation();
          showTooltip(cell, tipHtml);
        });
      }

      frag.appendChild(cell);
    });

    gridEl.replaceChildren(frag);

    // Month labels (38-column grid aligned with week columns)
    const monthsEl = card.querySelector(".sao-hm-months");
    monthsEl.innerHTML = buildMonthLabels(slots)
      .map((m) => `<span>${m}</span>`)
      .join("");

    // Keep mobile scroller aligned to latest dates on right
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

    return card;
  }

  function mountIfNeeded() {
    const heroMain = document.querySelector(".mao-dashboard-hero .mao-hero-main");
    if (!heroMain) return;
    if (!heroMain.querySelector(".sao-hm-card")) {
      const card = createHeatmapCard();
      heroMain.appendChild(card);
      renderHeatmapCard();
      // Scroll mobile heatmap to latest right edge
      const scroller = card.querySelector(".sao-hm-scroll");
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollLeft = scroller.scrollWidth;
      }
      fetchMetrics();
      fetchBackupStatus();
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
    const obs = new MutationObserver(() => {
      mountIfNeeded();
    });
    const root = document.getElementById("root") || document.body;
    obs.observe(root, { childList: true, subtree: true });

    document.addEventListener("click", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);

    setInterval(() => {
      if (document.querySelector(".sao-hm-card")) {
        fetchMetrics();
        fetchBackupStatus();
      }
    }, 120_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
