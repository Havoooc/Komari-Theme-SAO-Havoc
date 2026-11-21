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
    const stale = !time || Date.now() - Date.parse(time) > STALE_MS;
    const status = stale
      ? '已过期'
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
    const tone = stale || meta?.status !== 'ok' ? 'pending' : quality;
    const viaNote = meta?.via ? `（${meta.via}）` : '';
    const partialNote = partial ? ' · 末跳未完整响应' : '';
    const timeStr = time ? new Date(time).toLocaleString('zh-CN') : '未知';
    const reasonStr = meta?.reason ? `；${meta.reason}` : '';
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

  function render() {
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
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        render();
      });
    }
  }).observe(document.getElementById('root') || document.body, { childList: true, subtree: true });

  refresh();
  setInterval(refresh, 60000);
})();
