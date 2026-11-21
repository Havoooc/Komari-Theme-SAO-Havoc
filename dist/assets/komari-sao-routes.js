(() => {
  const CARRIERS = [
    ['telecom', '电信'],
    ['unicom', '联通'],
    ['mobile', '移动']
  ];
  const STALE_MS = 72 * 3600 * 1000;

  let routeData = {};

  function resolveCell(record, carrier) {
    const meta = record?.carrier_meta?.[carrier];
    const value = record?.[carrier];
    if (!value) {
      const attemptText = meta?.last_attempt_at
        ? `最近探测未得到有效结果：${new Date(meta.last_attempt_at).toLocaleString('zh-CN')}`
        : '尚未探测';
      return [meta?.last_attempt_at ? '未识别' : '待检测', 'pending', attemptText];
    }
    const time = meta?.probed_at;
    const ageMs = time ? Date.now() - Date.parse(time) : Infinity;
    const stale = !time || ageMs > STALE_MS;
    const transientFail = meta?.status === 'failed' && ageMs <= 24 * 3600 * 1000;
    const status = stale
      ? '已过期'
      : transientFail
        ? '最近复测临时超时（沿用 24h 内上次成功结果）'
        : meta?.status === 'failed'
          ? '最近探测失败'
          : meta?.status === 'held'
            ? '变化待确认'
            : '正常';
    const partial = meta?.destination_reached === false || meta?.path_incomplete === true;
    const quality =
      meta?.quality === 'excellent' || meta?.quality === 'good' || meta?.quality === 'standard'
        ? meta.quality
        : /^(国内|CN2|9929|CMIN2)/i.test(value)
          ? 'excellent'
          : /(10099|CMI)/i.test(value)
            ? 'good'
            : 'standard';
    const tone = stale || (meta?.status !== 'ok' && !transientFail) ? 'pending' : quality;
    const viaNote = meta?.via ? `（${meta.via}）` : '';
    const partialNote = partial ? ' · 末跳未完整响应' : '';
    const timeStr = time ? new Date(time).toLocaleString('zh-CN') : '未知';
    let reasonText = meta?.reason || '';
    if (reasonText === 'route_change_requires_two_daily_observations') {
      reasonText = meta?.pending_value ? `新观测到 ${meta.pending_value}，待下轮复测确认` : '路由变化待下轮复测确认';
    }
    const reasonStr = reasonText ? `；${reasonText}` : '';
    const SHORT_MAP = { '国内电信': '直连电信', '国内联通': '直连联通', '国内移动': '直连移动' };
    const displayVal = SHORT_MAP[value] || value;
    const isTight = (/[\u4e00-\u9fa5]/.test(displayVal) && displayVal.length >= 4) || displayVal.length >= 5;
    return [
      displayVal,
      tone + (isTight ? ' is-tight' : ''),
      `${status}${viaNote}${partialNote}；最近成功：${timeStr}${reasonStr}`
    ];
  }

  function extractNodeId(card) {
    const link = card.querySelector('a[href*="/instance/"]');
    const hrefId = link?.getAttribute('href')?.split('/instance/')[1]?.split(/[?#]/)[0];
    if (hrefId) return decodeURIComponent(hrefId);
    if (card.id && card.id.startsWith('node-card-')) {
      return card.id.slice('node-card-'.length);
    }
    return '';
  }

  function detectCarrier(row, fallbackIdx) {
    const nameText = row.querySelector('.multi-ping-name')?.textContent || row.getAttribute('title') || '';
    if (nameText.includes('电信')) return ['telecom', '电信'];
    if (nameText.includes('联通')) return ['unicom', '联通'];
    if (nameText.includes('移动')) return ['mobile', '移动'];
    return CARRIERS[fallbackIdx] || null;
  }

  function upsertChip(head, dirKey, arrow, carrier, label, record) {
    const [value, tone, detail] = resolveCell(record, carrier);
    const dirDesc = dirKey === 'forward' ? '浙江第三方探测点 → VPS' : 'VPS → 浙江三网探测点';
    const title = `${label}${dirKey === 'forward' ? '去程' : '回程'}（${dirDesc}）：${detail}`;
    const sig = `${carrier}|${dirKey}|${value}|${tone}|${title}`;

    let chip = head.querySelector(`.sao-rt-chip[data-dir="${dirKey}"]`);
    const isNew = !chip;
    if (isNew) {
      chip = document.createElement('span');
      chip.dataset.dir = dirKey;
      const arrowEl = document.createElement('span');
      arrowEl.className = 'sao-rt-chip-arrow';
      arrowEl.textContent = arrow;
      const valEl = document.createElement('span');
      valEl.className = 'sao-rt-chip-val';
      chip.append(arrowEl, valEl);
    }

    if (dirKey === 'forward') {
      const nameEl = head.querySelector('.multi-ping-name');
      if (nameEl) {
        if (nameEl.nextElementSibling !== chip) nameEl.after(chip);
      } else if (isNew) {
        head.prepend(chip);
      }
    } else if (head.firstElementChild !== chip) {
      head.prepend(chip);
    }

    if (chip.dataset.sig === sig) return;
    chip.className = `sao-rt-chip is-${tone}`;
    chip.title = title;
    chip.querySelector('.sao-rt-chip-val').textContent = value;
    chip.dataset.sig = sig;
  }

  function upsertDot(head, carrier) {
    let dot = head.querySelector('.sao-rt-carrier-dot');
    const desiredClass = `sao-rt-carrier-dot is-${carrier}`;
    if (!dot) {
      dot = document.createElement('i');
      dot.className = desiredClass;
      dot.setAttribute('aria-hidden', 'true');
    } else if (dot.className !== desiredClass) {
      dot.className = desiredClass;
    }
    const nameEl = head.querySelector('.multi-ping-name');
    if (nameEl) {
      if (dot.nextElementSibling !== nameEl) nameEl.before(dot);
    } else if (!dot.parentElement) {
      head.prepend(dot);
    }
  }


  function detectCurrencyFlag(text) {
    const t = String(text || "").trim();
    if (/^(C\$|CA\$|CAD)/i.test(t) || /\bCAD\b/i.test(t)) return "ca";
    if (/^(HK\$|HKD)/i.test(t) || /\bHKD\b/i.test(t)) return "hk";
    if (/^(€|EUR)/i.test(t) || /\bEUR\b/i.test(t)) return "eu";
    if (/^(£|GBP)/i.test(t) || /\bGBP\b/i.test(t)) return "gb";
    if (/\bJPY\b/i.test(t)) return "jp";
    if (/^(¥|￥|CNY|RMB)/i.test(t) || /\b(CNY|RMB)\b/i.test(t)) return "cn";
    if (/^(\$|US\$|USD)/i.test(t) || /\bUSD\b/i.test(t)) return "us";
    return "us";
  }

  const TILE_ICONS = {
    cpu: '<svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="5" y="5" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v3M9 2v3M15 19v3M9 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
    ram: '<svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9M2 15h20"/><rect width="20" height="10" x="2" y="6" rx="2"/></svg>',
    disk: '<svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
    load: '<svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
  };

  const TILE_CAPTIONS = {
    cpu: "核心规格",
    ram: "已用",
    disk: "空间",
    load: "Load 1m",
  };

  function detectHealthMetric(label, idx) {
    const t = String(label || "").trim().toLowerCase();
    if (t.includes("cpu")) return "cpu";
    if (t.includes("内存") || t.includes("mem") || t.includes("ram")) return "ram";
    if (t.includes("磁盘") || t.includes("disk") || t.includes("storage")) return "disk";
    if (t.includes("负载") || t.includes("load")) return "load";
    return ["cpu", "ram", "disk", "load"][idx] || "cpu";
  }

  function shortUnit(unit) {
    const u = String(unit || "").toUpperCase();
    if (u === "TB") return "T";
    if (u === "GB") return "G";
    if (u === "MB") return "M";
    if (u === "KB") return "K";
    return u;
  }

  function formatTileSpec(metricKey, detail, numVal, cpuCores) {
    if (metricKey === "load") {
      const ratio = numVal / Math.max(1, cpuCores);
      if (ratio < 0.7) return "空闲平稳";
      if (ratio <= 1.2) return "中等负载";
      return "高负载";
    }
    const d = String(detail || "").trim();
    if (!d) return "\u00A0";
    const m = d.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)\s*\/\s*([\d.]+)\s*(TB|GB|MB|KB|B)$/i);
    if (m) {
      const [, v1, u1, v2, u2] = m;
      const up1 = u1.toUpperCase();
      const up2 = u2.toUpperCase();
      return up1 === up2 ? `${v1} / ${v2} ${up2}` : `${v1}${shortUnit(u1)} / ${v2}${shortUnit(u2)}`;
    }
    return d;
  }

  function createTileCell() {
    const cell = document.createElement("div");
    cell.className = "sao-tile-cell";

    const head = document.createElement("div");
    head.className = "sao-tile-head";

    const left = document.createElement("span");
    left.className = "sao-tile-left";
    const chip = document.createElement("span");
    chip.className = "sao-tile-chip";
    const name = document.createElement("span");
    name.className = "sao-tile-name";
    left.append(chip, name);

    const val = document.createElement("span");
    val.className = "sao-tile-val tabular";
    const numSpan = document.createElement("span");
    numSpan.className = "sao-tile-num";
    const unitSpan = document.createElement("span");
    unitSpan.className = "sao-tile-unit";
    val.append(numSpan, unitSpan);

    head.append(left, val);

    const track = document.createElement("div");
    track.className = "sao-tile-track";
    const fill = document.createElement("div");
    fill.className = "sao-tile-fill";
    track.appendChild(fill);

    const foot = document.createElement("div");
    foot.className = "sao-tile-foot";
    const subK = document.createElement("span");
    subK.className = "sao-tile-sub-k";
    const subV = document.createElement("span");
    subV.className = "sao-tile-sub-v tabular";
    foot.append(subK, subV);

    cell.append(head, track, foot);
    return cell;
  }

  function decorateHealthTiles() {
    const grids = document.querySelectorAll(".server-metric-grid");
    for (const grid of grids) {
      const items = grid.querySelectorAll(":scope > .metric-item");
      if (items.length === 0) continue;

      let cpuCores = 1;
      items.forEach((it, idx) => {
        const head = it.querySelector(":scope > div:first-child");
        const lbl = head?.querySelector("span.font-medium")?.textContent || "";
        if (detectHealthMetric(lbl, idx) === "cpu") {
          const dtEl = it.querySelector(":scope > .metric-detail");
          const dt = dtEl?.dataset.empty === "true" ? "" : (dtEl?.textContent || "");
          const cm = dt.match(/(\d+)\s*(?:核|cores?|vcpu)/i);
          if (cm) cpuCores = Math.max(1, parseInt(cm[1], 10));
        }
      });

      items.forEach((item, idx) => {
        const head = item.querySelector(":scope > div:first-child");
        const labelEl = head?.querySelector("span.font-medium") || head?.firstElementChild?.querySelector("span:last-child");
        const valWrap = head?.querySelector(".tabular");
        const detailEl = item.querySelector(":scope > .metric-detail");
        if (!labelEl || !valWrap) return;

        const labelText = (labelEl.textContent || "").trim();
        const metricKey = detectHealthMetric(labelText, idx);
        const rawVal = (valWrap.querySelector("span:first-child")?.textContent || valWrap.textContent || "").trim();
        const rawUnit = (valWrap.children.length > 1 ? valWrap.children[1].textContent : "").trim();
        const rawDetail = (detailEl?.dataset.empty === "true" ? "" : (detailEl?.textContent || "")).replace(/\u00a0/g, "").trim();

        const numVal = parseFloat(rawVal);
        const safeNum = Number.isFinite(numVal) ? numVal : 0;
        const rawPct = metricKey === "load" ? (safeNum / cpuCores) * 100 : safeNum;
        const pct = Math.max(0, Math.min(100, rawPct));
        const fillPct = pct <= 0 ? 0 : +(Math.min(100, Math.max(pct, 3.5))).toFixed(2);

        const dispVal = rawVal || (metricKey === "load" ? "0.00" : "0");
        const caption = TILE_CAPTIONS[metricKey] || "";
        const specVal = formatTileSpec(metricKey, rawDetail, safeNum, cpuCores);
        const sig = `${metricKey}|${labelText}|${dispVal}|${rawUnit}|${fillPct}|${specVal}`;

        if (item.dataset.saoMetric !== metricKey) item.dataset.saoMetric = metricKey;
        if (!item.classList.contains("has-sao-tile")) item.classList.add("has-sao-tile");
        item.classList.remove("has-sao-ring");

        let cell = item.querySelector(":scope > .sao-tile-cell");
        if (!cell) {
          cell = createTileCell();
          item.appendChild(cell);
        }
        if (cell.dataset.sig === sig) return;
        cell.dataset.sig = sig;

        const chip = cell.querySelector(".sao-tile-chip");
        if (chip.dataset.iconKey !== metricKey) {
          chip.dataset.iconKey = metricKey;
          chip.innerHTML = TILE_ICONS[metricKey] || TILE_ICONS.cpu;
        }
        cell.querySelector(".sao-tile-name").textContent = labelText;
        cell.querySelector(".sao-tile-num").textContent = dispVal;

        const unitNode = cell.querySelector(".sao-tile-unit");
        unitNode.textContent = rawUnit;
        unitNode.style.display = rawUnit ? "" : "none";

        cell.querySelector(".sao-tile-fill").style.width = `${fillPct}%`;
        cell.querySelector(".sao-tile-sub-k").textContent = caption;

        const subV = cell.querySelector(".sao-tile-sub-v");
        subV.textContent = specVal;
        cell.querySelector(".sao-tile-foot").title = rawDetail || (metricKey === "load" ? `Load 1m: ${dispVal} (${cpuCores} 核)` : "");
      });
    }
  }

  function decoratePriceChips() {
    const chips = document.querySelectorAll(".dstatus-tags-row:not(.dstatus-tags-measure) .dstatus-price-chip:not(.has-sao-flag)");
    for (const chip of chips) {
      const code = detectCurrencyFlag(chip.textContent);
      const img = document.createElement("img");
      img.className = "sao-cur-flag";
      img.src = `/assets/flags/${code}.svg`;
      img.alt = code.toUpperCase();
      img.loading = "lazy";
      img.draggable = false;
      chip.prepend(img);
      chip.classList.add("has-sao-flag");
    }
  }

  function render() {
    decorateHealthTiles();
    decoratePriceChips();
    const cards = document.querySelectorAll('.server-card, .compact-node-card, .mini-node-card');
    for (const card of cards) {
      const id = extractNodeId(card);
      if (!id) continue;

      const cols = card.querySelectorAll('.multi-ping-columns > .multi-ping-metric-column');
      if (cols.length < 2) continue;

      const node = routeData[id] || {};
      const latencyRows = cols[0].querySelectorAll('.multi-ping-metric-row');
      const lossRows = cols[1].querySelectorAll('.multi-ping-metric-row');

      latencyRows.forEach((row, idx) => {
        const matched = detectCarrier(row, idx);
        if (!matched) return;
        const [carrier, label] = matched;
        const lHead = row.querySelector('.multi-ping-metric-head');
        if (lHead) {
          lHead.classList.add('has-sao-route');
          upsertDot(lHead, carrier);
          upsertChip(lHead, 'forward', '↗', carrier, label, node.forward);
        }
        const rHead = lossRows[idx]?.querySelector('.multi-ping-metric-head');
        if (rHead) {
          rHead.classList.add('has-sao-route');
          upsertChip(rHead, 'return', '↙', carrier, label, node.return);
        }
      });
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/routes/api', { credentials: 'same-origin', cache: 'no-store' });
      routeData = res.ok ? await res.json() : {};
    } catch {
      routeData = {};
    }
    render();
  }

  let queued = false;
  new MutationObserver((mutations) => {
    if (mutations.every((m) => {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      return Boolean(el && el.closest(".sao-tile-cell"));
    })) return;
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        render();
      });
    }
  }).observe(document.getElementById('root') || document.body, { childList: true, subtree: true, characterData: true });

  refresh();
  setInterval(refresh, 60000);
})();
