/* A-share rotation dashboard — Claude UI, vanilla JS, no CDN chart lib */
(function () {
  "use strict";

  const STOCK_NAMES = {
    "000002": "万科A",
    "000157": "中联重科",
    "000166": "申万宏源",
    "000338": "潍柴动力",
    "000617": "中油资本",
    "000708": "中信特钢",
    "000776": "广发证券",
    "000792": "盐湖股份",
    "000807": "云铝股份",
  };

  const REASON_LABELS = {
    rebalance: "再平衡",
    below_ma20: "跌破MA20",
    industry_dead: "行业死叉",
    take_profit: "止盈",
    stop_loss: "止损",
    trailing_stop: "移动止损",
    deep_v_entry: "深V入场",
    cost_fail: "未站上成本",
    below_ma5: "跌破MA5",
  };

  const STRATEGY_CARDS = [
    {
      title: "1. 个股入场（三信号）",
      body: [
        "缩量筑底：近20日价格在60日区间下三分之一，或接近摆动低点；量能收缩。",
        "温和放量突破：收盘突破近20日高点，量能倍数 ∈ [1.2, 2.5]。",
        "金叉确认：近5日 MA5 上穿 MA20 或 MACD 金叉，且收盘在 MA20 上方。",
      ],
    },
    {
      title: "2. 宏观叠加：沪深300",
      body: [
        "趋势（risk-on）：close > MA60 且 MA20 > MA60 → 目标权益约 90%。",
        "避险（risk-off）：close < MA60 或 MA20 < MA60 → 目标权益约 30%。",
        "滞回：模式切换需连续 2 个交易日确认。",
      ],
    },
    {
      title: "3. 行业死叉预警",
      body: [
        "近10日 MA20 下穿 MA60，或 MA20 < MA60 且下行。",
        "预警行业禁止新开仓；已持仓卖出优先 / 半仓。",
      ],
    },
    {
      title: "4. 组合轮动与退出",
      body: [
        "股票池默认沪深300；最多 20 只等权；周五信号 → 次日开盘调仓。",
        "退出：连续3日收盘低于 MA20 / 行业死叉 / 止损 -8% / 可选止盈 +25%。",
        "成本：佣金万三双边 + 印花税万五卖出 + 滑点 0.1%。",
      ],
    },
  ];

  const TAB_IDS = ["overview", "holdings", "trades", "strategy"];

  const state = {
    metrics: null,
    equity: [],
    trades: [],
    holdings: [],
    stockNames: STOCK_NAMES,
    holdingsRange: { preset: "all", start: null, end: null },
    tradesRange: { preset: "all", start: null, end: null },
    compare: [],
    strategyId: "default",
    strategyCache: {},
  };
  const $ = (sel) => document.querySelector(sel);

  function padCode(code) {
    const s = String(code == null ? "" : code).trim();
    if (/^\d+$/.test(s)) return s.padStart(6, "0");
    return s;
  }

  function stockName(code) {
    const c = padCode(code);
    const map = state.stockNames || STOCK_NAMES;
    return map[c] || map[code] || "";
  }

  /** "潍柴动力 000338" */
  function stockLabel(code) {
    const c = padCode(code);
    const n = stockName(c);
    return n ? n + " " + c : c;
  }

  /** Two-line HTML: name prominent + code muted mono */
  function stockCellHtml(code) {
    const c = padCode(code);
    const n = stockName(c);
    if (n) {
      return (
        '<div class="stock-cell"><span class="name">' +
        escapeHtml(n) +
        '</span><span class="code">' +
        escapeHtml(c) +
        "</span></div>"
      );
    }
    return '<div class="stock-cell"><span class="name mono">' + escapeHtml(c) + "</span></div>";
  }

  function chipHtml(code, accent) {
    const c = padCode(code);
    const n = stockName(c);
    return (
      '<span class="name">' +
      escapeHtml(n || c) +
      '</span><span class="code' +
      (accent ? " accent" : "") +
      '">' +
      escapeHtml(c) +
      "</span>"
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(n, digits) {
    if (digits == null) digits = 2;
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtPct(n, digits) {
    if (digits == null) digits = 2;
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + Number(n).toFixed(digits) + "%";
  }

  function reasonLabel(r) {
    return REASON_LABELS[r] || r || "—";
  }

  function matchesCodeOrName(code, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const c = padCode(code);
    if (c.includes(q) || String(code).toLowerCase().includes(q)) return true;
    const n = stockName(c);
    if (n && n.toLowerCase().includes(q)) return true;
    return false;
  }

  /** YYYY-MM-DD from a Date (local calendar) */
  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  /** Parse YYYY-MM-DD or Date-like; return comparable string or null */
  function normalizeDateStr(v) {
    if (!v) return null;
    const s = String(v).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  }

  /**
   * Resolve inclusive [start, end] from a range state.
   * Presets are relative to the latest date in the given items (or today).
   */
  function resolveRange(rangeState, items) {
    let endAnchor = null;
    if (items && items.length) {
      for (let i = items.length - 1; i >= 0; i--) {
        const d = normalizeDateStr(items[i].date);
        if (d) {
          endAnchor = d;
          break;
        }
      }
    }
    if (!endAnchor) endAnchor = toISODate(new Date());

    const preset = rangeState.preset || "all";
    if (preset === "custom") {
      return {
        start: normalizeDateStr(rangeState.start),
        end: normalizeDateStr(rangeState.end),
      };
    }
    if (preset === "all") {
      return { start: null, end: null };
    }

    const end = new Date(endAnchor + "T12:00:00");
    const start = new Date(end);
    if (preset === "1w") start.setDate(start.getDate() - 7);
    else if (preset === "1m") start.setMonth(start.getMonth() - 1);
    else if (preset === "1y") start.setFullYear(start.getFullYear() - 1);
    else return { start: null, end: null };

    return { start: toISODate(start), end: endAnchor };
  }

  function inDateRange(dateStr, range) {
    const d = normalizeDateStr(dateStr);
    if (!d) return false;
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  }

  /**
   * Enrich trades with pnl / pnl_pct / pnl_label using average-cost basis.
   * Prefer server-provided fields when present on sell rows.
   */
  function enrichTradesWithPnl(trades) {
    const book = Object.create(null); // code -> { shares, costBasis }
    return trades.map(function (t) {
      const row = Object.assign({}, t);
      const code = padCode(t.code);
      const side = String(t.side || "").toLowerCase();
      const shares = Number(t.shares) || 0;
      const price = Number(t.price) || 0;

      if (side === "buy") {
        const prev = book[code];
        if (!prev || prev.shares <= 1e-9) {
          book[code] = { shares: shares, costBasis: shares * price };
        } else {
          const ns = prev.shares + shares;
          const nb = prev.costBasis + shares * price;
          book[code] = { shares: ns, costBasis: nb };
        }
        if (row.pnl == null) {
          row.pnl = null;
          row.pnl_pct = null;
          row.pnl_label = null;
        }
        return row;
      }

      if (side === "sell") {
        const prev = book[code];
        let avgCost = 0;
        if (prev && prev.shares > 1e-9) {
          avgCost = prev.costBasis / prev.shares;
          const sellShares = Math.min(shares, prev.shares);
          const remain = prev.shares - sellShares;
          if (remain <= 1e-6) {
            delete book[code];
          } else {
            book[code] = {
              shares: remain,
              costBasis: prev.costBasis * (remain / prev.shares),
            };
          }
        }

        if (row.pnl != null && row.pnl_pct != null && row.pnl_label) {
          return row;
        }

        // Prefer amount vs cost basis; fallback price * shares
        const sellAmount =
          t.amount != null && !Number.isNaN(Number(t.amount))
            ? Number(t.amount)
            : price * shares;
        const costAmount = avgCost * shares;
        const pnl = sellAmount - costAmount;
        const pnlPct = costAmount > 1e-9 ? (pnl / costAmount) * 100 : null;
        row.pnl = Math.round(pnl * 100) / 100;
        row.pnl_pct =
          pnlPct == null ? null : Math.round(pnlPct * 100) / 100;
        row.pnl_label =
          pnl > 0.005 ? "挣了" : pnl < -0.005 ? "赔了" : "持平";
        row._avg_cost = Math.round(avgCost * 1e6) / 1e6;
        return row;
      }

      return row;
    });
  }

  async function loadJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Failed to load " + path);
    return res.json();
  }

  function renderKPIs(m) {
    const items = [
      { label: "CAGR", value: m.cagr_pct, cls: "pos" },
      { label: "最大回撤", value: m.max_dd_pct, cls: "neg" },
      { label: "Sharpe", value: String(m.sharpe), cls: "neu" },
      { label: "胜率", value: m.win_rate_pct, cls: "pos" },
      { label: "年化换手", value: String(m.turnover), cls: "neu" },
      { label: "累计收益", value: m.total_return_pct, cls: "pos" },
    ];
    $("#kpi-grid").innerHTML = items
      .map(
        (it) =>
          '<div class="kpi-card"><div class="kpi-label">' +
          it.label +
          '</div><div class="kpi-value ' +
          it.cls +
          '">' +
          it.value +
          "</div></div>"
      )
      .join("");
  }

  function renderSnapshot(m) {
    $("#one-liner").textContent = m.one_liner || "";
    $("#period-badge").textContent = m.start_date + " → " + m.end_date;
    const rows = [
      ["起始资金", fmtNum(m.start_nav, 0)],
      ["期末净值", fmtNum(m.final_nav, 2)],
      ["累计收益", m.total_return_pct],
      ["交易笔数", String(m.trade_count)],
      ["买入 / 卖出", m.buy_count + " / " + m.sell_count],
      ["交易日数", String(m.n_days)],
    ];
    $("#snapshot-dl").innerHTML = rows
      .map(
        (r) =>
          '<div class="row"><dt>' +
          r[0] +
          "</dt><dd>" +
          r[1] +
          "</dd></div>"
      )
      .join("");
  }

  function drawEquityChart(equity) {
    const canvas = $("#equity-chart");
    if (!canvas || !equity.length) return;
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent.clientWidth || 640;
    const cssH = parent.clientHeight || 320;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = { t: 16, r: 16, b: 36, l: 54 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;
    const startNav = equity[0].nav || 1;
    const rets = equity.map((d) => ((d.nav / startNav) - 1) * 100);
    let min = Math.min.apply(null, rets);
    let max = Math.max.apply(null, rets);
    // include zero baseline when possible
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    const span = max - min || 1;
    min -= span * 0.08;
    max += span * 0.08;

    const xAt = (i) => pad.l + (w * i) / Math.max(equity.length - 1, 1);
    const yAt = (v) => pad.t + h * (1 - (v - min) / (max - min));

    ctx.clearRect(0, 0, cssW, cssH);

    // warm grid
    ctx.strokeStyle = "rgba(232, 228, 220, 0.95)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#9a9590";
    ctx.font = "11px JetBrains Mono, monospace";
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = min + ((max - min) * i) / ticks;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const label = (v >= 0 ? "+" : "") + v.toFixed(0) + "%";
      ctx.fillText(label, 6, y + 3);
    }

    // zero line
    if (min < 0 && max > 0) {
      const y0 = yAt(0);
      ctx.strokeStyle = "rgba(111, 107, 102, 0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y0);
      ctx.lineTo(pad.l + w, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // x labels
    const xTicks = Math.min(6, equity.length);
    for (let i = 0; i < xTicks; i++) {
      const idx = Math.round(((equity.length - 1) * i) / Math.max(xTicks - 1, 1));
      const x = xAt(idx);
      const label = equity[idx].date.slice(2);
      ctx.fillStyle = "#9a9590";
      ctx.fillText(label, x - 28, cssH - 12);
    }

    // terracotta area + line
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, "rgba(201, 100, 66, 0.28)");
    grad.addColorStop(1, "rgba(201, 100, 66, 0.00)");
    ctx.beginPath();
    rets.forEach((v, i) => {
      const x = xAt(i);
      const y = yAt(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#c96442";
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(xAt(equity.length - 1), pad.t + h);
    ctx.lineTo(xAt(0), pad.t + h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    const last = equity[equity.length - 1];
    const lastRet = ((last.nav / startNav) - 1) * 100;
    $("#nav-last").textContent =
      "最新 " + last.date + " · " + fmtPct(lastRet, 2);

    if (!canvas._bound) {
      canvas._bound = true;
      const tip = document.createElement("div");
      tip.style.cssText =
        "position:absolute;pointer-events:none;display:none;background:#ffffff;border:1px solid #e8e4dc;color:#1f1e1d;font:12px Inter,Noto Sans SC,sans-serif;padding:6px 10px;border-radius:10px;z-index:2;box-shadow:0 8px 24px rgba(31,30,29,0.08);";
      parent.style.position = "relative";
      parent.appendChild(tip);
      canvas.addEventListener("mousemove", (ev) => {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const ratio = (x - pad.l) / w;
        const idx = Math.round(ratio * (state.equity.length - 1));
        if (idx < 0 || idx >= state.equity.length) {
          tip.style.display = "none";
          return;
        }
        const d = state.equity[idx];
        const ret = ((d.nav / startNav) - 1) * 100;
        tip.style.display = "block";
        tip.style.left = Math.min(rect.width - 160, Math.max(8, x + 10)) + "px";
        tip.style.top = "12px";
        tip.textContent = d.date + "  " + fmtPct(ret, 2);
      });
      canvas.addEventListener("mouseleave", () => {
        tip.style.display = "none";
      });
    }
  }

  function latestNonEmpty(holdings) {
    for (let i = holdings.length - 1; i >= 0; i--) {
      if (holdings[i].n_pos > 0) return holdings[i];
    }
    return null;
  }

  function renderLatestBanner(snap) {
    const el = $("#holdings-latest");
    if (!snap) {
      el.innerHTML =
        '<div class="card-meta"><div><span class="section-kicker">RANGE</span>' +
        '<p class="section-desc" style="margin-top:0.35rem">该区间无持仓</p></div></div>';
      return;
    }
    if (snap.n_pos === 0) {
      el.innerHTML =
        '<div class="card-meta"><div><span class="section-kicker">LATEST</span>' +
        '<p class="section-desc" style="margin-top:0.35rem">该区间内无非空持仓 · 最近快照 ' +
        snap.date +
        '</p></div><span class="badge badge-reason">n_pos = 0</span></div>';
      return;
    }
    const chips = snap.positions
      .map(
        (p) =>
          '<div class="pos-chip">' +
          chipHtml(p.code, true) +
          '<span class="sub">' +
          fmtNum(p.shares, 2) +
          " 股</span><span class=\"sub\">成本 " +
          fmtNum(p.avg_cost, 3) +
          "</span></div>"
      )
      .join("");
    el.innerHTML =
      '<div class="card-meta"><div><span class="section-kicker">CURRENT / LATEST</span>' +
      '<p style="margin:0.35rem 0 0;color:var(--text);font-size:0.95rem;font-weight:500">区间内最近非空持仓 · ' +
      snap.date +
      " · " +
      snap.n_pos +
      ' 只</p></div></div><div class="chips">' +
      chips +
      "</div>";
  }

  function holdingsInRange() {
    const range = resolveRange(state.holdingsRange, state.holdings);
    return state.holdings.filter((h) => inDateRange(h.date, range));
  }

  function filteredHoldings() {
    const q = ($("#holdings-code-filter").value || "").trim();
    const nonempty = $("#holdings-nonempty").checked;
    return holdingsInRange().filter((h) => {
      if (nonempty && h.n_pos === 0) return false;
      if (!q) return true;
      return h.positions.some((p) => matchesCodeOrName(p.code, q));
    });
  }

  function renderHoldings() {
    const inRange = holdingsInRange();
    const latest = latestNonEmpty(inRange);
    renderLatestBanner(latest);
    const list = filteredHoldings().slice().reverse();
    const latestDate = latest && latest.n_pos > 0 ? latest.date : null;

    if (!list.length) {
      $("#holdings-list").innerHTML =
        '<p class="section-desc" style="margin:0.5rem 0 0">该区间无匹配快照</p>';
      return;
    }

    $("#holdings-list").innerHTML = list
      .map((h) => {
        const isLatest = latestDate && h.date === latestDate;
        const chips =
          h.n_pos === 0
            ? '<span class="muted">空仓</span>'
            : h.positions
                .map(
                  (p) =>
                    '<div class="pos-chip">' +
                    chipHtml(p.code, false) +
                    '<span class="sub">' +
                    fmtNum(p.shares, 2) +
                    " 股 · 均价 " +
                    fmtNum(p.avg_cost, 3) +
                    '</span><span class="tiny">' +
                    p.side_last +
                    " · " +
                    reasonLabel(p.reason) +
                    "</span></div>"
                )
                .join("");
        return (
          '<article class="card card-pad holdings-card' +
          (isLatest ? " is-latest" : "") +
          '"><div class="card-meta"><div><span class="mono">' +
          h.date +
          "</span>" +
          (isLatest
            ? '<span class="badge badge-buy tag-latest">最新持仓</span>'
            : "") +
          '</div><span class="muted">' +
          h.n_pos +
          ' 只持仓</span></div><div class="chips">' +
          chips +
          "</div></article>"
        );
      })
      .join("");
  }

  function filteredTrades() {
    const q = ($("#trade-code").value || "").trim();
    const side = $("#trade-side").value;
    const reason = $("#trade-reason").value;
    const range = resolveRange(state.tradesRange, state.trades);
    return state.trades.filter((t) => {
      if (!inDateRange(t.date, range)) return false;
      if (q && !matchesCodeOrName(t.code, q)) return false;
      if (side && t.side !== side) return false;
      if (reason && t.reason !== reason) return false;
      return true;
    });
  }

  function populateReasonFilter() {
    const reasons = Array.from(new Set(state.trades.map((t) => t.reason))).sort();
    const sel = $("#trade-reason");
    reasons.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = reasonLabel(r);
      sel.appendChild(opt);
    });
  }

  function pnlCellHtml(t) {
    if (String(t.side).toLowerCase() !== "sell" || t.pnl == null) {
      return '<span class="pnl-dash">—</span>';
    }
    const cls = t.pnl > 0.005 ? "pnl-pos" : t.pnl < -0.005 ? "pnl-neg" : "pnl-dash";
    const label = t.pnl_label || (t.pnl > 0 ? "挣了" : t.pnl < 0 ? "赔了" : "持平");
    const amt =
      (t.pnl > 0 ? "+" : "") + fmtNum(t.pnl, 2);
    const pct =
      t.pnl_pct == null
        ? ""
        : '<span class="pct">' + fmtPct(t.pnl_pct, 2) + "</span>";
    return (
      '<div class="pnl-cell ' +
      cls +
      '"><span>' +
      label +
      " " +
      amt +
      "</span>" +
      pct +
      "</div>"
    );
  }

  function renderTrades() {
    const rows = filteredTrades().slice().reverse();
    $("#trades-tbody").innerHTML = rows
      .map((t) => {
        const sideBadge =
          t.side === "buy"
            ? '<span class="badge badge-buy">买入</span>'
            : '<span class="badge badge-sell">卖出</span>';
        return (
          "<tr><td class=\"mono\">" +
          t.date +
          "</td><td>" +
          stockCellHtml(t.code) +
          "</td><td>" +
          sideBadge +
          '</td><td class="right mono">' +
          fmtNum(t.price, 4) +
          '</td><td class="right mono">' +
          fmtNum(t.shares, 2) +
          '</td><td class="right mono">' +
          fmtNum(t.amount, 2) +
          '</td><td class="right">' +
          pnlCellHtml(t) +
          '</td><td><span class="badge badge-reason">' +
          reasonLabel(t.reason) +
          "</span></td></tr>"
        );
      })
      .join("");
    $("#trades-count").textContent =
      "显示 " + rows.length + " / " + state.trades.length + " 笔";
  }

  function renderStrategy() {
    $("#strategy-cards").innerHTML = STRATEGY_CARDS.map(
      (c) =>
        '<article class="card card-pad"><h3>' +
        c.title +
        "</h3><ul>" +
        c.body
          .map(
            (b) =>
              '<li><span class="bullet">▹</span><span>' + b + "</span></li>"
          )
          .join("") +
        "</ul></article>"
    ).join("");
  }

  /* —— Tab navigation (hash-persisted, show/hide panels) —— */
  function activateTab(tabId, opts) {
    const id = TAB_IDS.indexOf(tabId) >= 0 ? tabId : "overview";
    const pushHash = !opts || opts.pushHash !== false;

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.getAttribute("data-panel") === id;
      panel.classList.toggle("is-active", active);
      if (active) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });

    document.querySelectorAll(".nav-link").forEach((a) => {
      const active = a.getAttribute("data-tab") === id;
      a.classList.toggle("active", active);
      a.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (pushHash) {
      const next = "#" + id;
      if (location.hash !== next) {
        history.replaceState(null, "", next);
      }
    }

    // Redraw chart when overview becomes visible (canvas may have been 0-width)
    if (id === "overview" && state.equity.length) {
      requestAnimationFrame(function () {
        drawEquityChart(state.equity);
      });
    }
  }

  function tabFromHash() {
    const raw = (location.hash || "").replace(/^#/, "").trim();
    if (TAB_IDS.indexOf(raw) >= 0) return raw;
    return "overview";
  }

  function setupNav() {
    document.querySelectorAll(".nav-link").forEach((a) => {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        const tab = a.getAttribute("data-tab") || "overview";
        activateTab(tab);
      });
    });
    window.addEventListener("hashchange", function () {
      activateTab(tabFromHash(), { pushHash: false });
    });
    activateTab(tabFromHash(), { pushHash: true });
  }

  /* —— Time-range filter UI —— */
  function syncChipActive(scope, preset) {
    document
      .querySelectorAll('.chip-btn[data-scope="' + scope + '"]')
      .forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-preset") === preset);
      });
  }

  function setHoldingsPreset(preset) {
    state.holdingsRange = { preset: preset, start: null, end: null };
    syncChipActive("holdings", preset);
    // Clear custom inputs when picking a preset (except leaving values for convenience)
    renderHoldings();
  }

  function setTradesPreset(preset) {
    state.tradesRange = { preset: preset, start: null, end: null };
    syncChipActive("trades", preset);
    renderTrades();
  }

  function applyHoldingsCustom() {
    const start = normalizeDateStr($("#holdings-start").value);
    const end = normalizeDateStr($("#holdings-end").value);
    if (!start && !end) {
      setHoldingsPreset("all");
      return;
    }
    let s = start;
    let e = end;
    if (s && e && s > e) {
      const tmp = s;
      s = e;
      e = tmp;
      $("#holdings-start").value = s;
      $("#holdings-end").value = e;
    }
    state.holdingsRange = { preset: "custom", start: s, end: e };
    syncChipActive("holdings", null); // none of the presets active
    renderHoldings();
  }

  function applyTradesCustom() {
    const start = normalizeDateStr($("#trades-start").value);
    const end = normalizeDateStr($("#trades-end").value);
    if (!start && !end) {
      setTradesPreset("all");
      return;
    }
    let s = start;
    let e = end;
    if (s && e && s > e) {
      const tmp = s;
      s = e;
      e = tmp;
      $("#trades-start").value = s;
      $("#trades-end").value = e;
    }
    state.tradesRange = { preset: "custom", start: s, end: e };
    syncChipActive("trades", null);
    renderTrades();
  }

  function bindTimeFilters() {
    document.querySelectorAll(".chip-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const scope = btn.getAttribute("data-scope");
        const preset = btn.getAttribute("data-preset");
        if (scope === "holdings") setHoldingsPreset(preset);
        else if (scope === "trades") setTradesPreset(preset);
      });
    });
    $("#holdings-apply-range").addEventListener("click", applyHoldingsCustom);
    $("#trades-apply-range").addEventListener("click", applyTradesCustom);
    // Enter key on date inputs applies custom range
    ["holdings-start", "holdings-end"].forEach((id) => {
      document.getElementById(id).addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") applyHoldingsCustom();
      });
    });
    ["trades-start", "trades-end"].forEach((id) => {
      document.getElementById(id).addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") applyTradesCustom();
      });
    });
  }

  function bindFilters() {
    ["holdings-code-filter", "holdings-nonempty"].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener("input", renderHoldings);
      el.addEventListener("change", renderHoldings);
    });
    ["trade-code", "trade-side", "trade-reason"].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener("input", renderTrades);
      el.addEventListener("change", renderTrades);
    });
    window.addEventListener("resize", () => {
      if ($("#overview").classList.contains("is-active")) {
        drawEquityChart(state.equity);
      }
    });
    bindTimeFilters();
  }


  function fmtPctRaw(n, digits) {
    if (digits == null) digits = 2;
    if (n == null || Number.isNaN(n)) return "—";
    return (Number(n) * 100).toFixed(digits) + "%";
  }

  function renderCompareTable(rows) {
    const tbody = $("#compare-tbody");
    const note = $("#compare-note");
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="muted">暂无对比数据 · 运行 python -m compare.run_compare</td></tr>';
      if (note) note.textContent = "运行 compare.run_compare 后显示";
      return;
    }
    if (note) note.textContent = rows.length + " 个策略";
    tbody.innerHTML = rows
      .map(function (r) {
        const active = state.strategyId === r.id ? " is-active-row" : "";
        return (
          '<tr class="compare-row' +
          active +
          '" data-sid="' +
          escapeHtml(r.id) +
          '"><td><strong>' +
          escapeHtml(r.name || r.id) +
          '</strong><div class="tiny mono">' +
          escapeHtml(r.id) +
          "</div></td>" +
          '<td class="right mono">' +
          fmtPctRaw(r.cagr, 2) +
          "</td>" +
          '<td class="right mono">' +
          fmtPctRaw(r.maxdd, 2) +
          "</td>" +
          '<td class="right mono">' +
          (r.sharpe == null ? "—" : Number(r.sharpe).toFixed(3)) +
          "</td>" +
          '<td class="right mono">' +
          fmtPctRaw(r.total_return, 2) +
          "</td>" +
          '<td class="right mono">' +
          fmtPctRaw(r.avg_invested, 1) +
          "</td>" +
          '<td class="right mono">' +
          String(r.trades != null ? r.trades : "—") +
          "</td></tr>"
        );
      })
      .join("");
    tbody.querySelectorAll("tr.compare-row").forEach(function (tr) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", function () {
        const sid = tr.getAttribute("data-sid");
        const sel = $("#strategy-select");
        if (sel && sid) {
          sel.value = sid;
          switchStrategy(sid);
        }
      });
    });
  }

  function populateStrategySelect(compareRows) {
    const sel = $("#strategy-select");
    if (!sel) return;
    const opts = [{ id: "default", name: "默认（轮动缓存）" }];
    (compareRows || []).forEach(function (r) {
      opts.push({ id: r.id, name: (r.name || r.id) + " · " + r.id });
    });
    sel.innerHTML = opts
      .map(function (o) {
        return (
          '<option value="' +
          escapeHtml(o.id) +
          '">' +
          escapeHtml(o.name) +
          "</option>"
        );
      })
      .join("");
    sel.value = state.strategyId || "default";
    sel.addEventListener("change", function () {
      switchStrategy(sel.value);
    });
  }

  function applyStrategyPack(pack, sid) {
    state.strategyId = sid || "default";
    state.metrics = pack.metrics;
    state.equity = pack.equity || [];
    state.trades = enrichTradesWithPnl(pack.trades || []);
    state.holdings = pack.holdings || [];
    // reset reason filter options
    const sel = $("#trade-reason");
    if (sel) {
      const keep = sel.querySelector('option[value=""]');
      sel.innerHTML = "";
      if (keep) sel.appendChild(keep);
      else {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "全部原因";
        sel.appendChild(opt);
      }
      populateReasonFilter();
    }
    renderKPIs(state.metrics);
    renderSnapshot(state.metrics);
    renderHoldings();
    renderTrades();
    renderCompareTable(state.compare);
    drawEquityChart(state.equity);
    const brand = document.querySelector(".brand h1");
    if (brand && state.metrics && state.metrics.title) {
      brand.textContent = state.metrics.title;
    }
  }

  async function switchStrategy(sid) {
    if (!sid || sid === "default") {
      if (state.strategyCache.default) {
        applyStrategyPack(state.strategyCache.default, "default");
      }
      return;
    }
    if (state.strategyCache[sid]) {
      applyStrategyPack(state.strategyCache[sid], sid);
      return;
    }
    try {
      const base = "data/strategies/" + sid + "/";
      const packArr = await Promise.all([
        loadJSON(base + "metrics.json"),
        loadJSON(base + "equity.json"),
        loadJSON(base + "trades.json"),
        loadJSON(base + "holdings_timeline.json"),
      ]);
      const pack = {
        metrics: packArr[0],
        equity: packArr[1],
        trades: packArr[2],
        holdings: packArr[3],
      };
      state.strategyCache[sid] = pack;
      applyStrategyPack(pack, sid);
    } catch (err) {
      console.warn("strategy load failed", sid, err);
      alert("无法加载策略数据：" + sid + "\\n" + err.message);
    }
  }


  async function main() {
    try {
      let pack;
      let namesFromBundle = null;
      if (window.ASR_DATA) {
        const d = window.ASR_DATA;
        pack = [d.metrics, d.equity, d.trades, d.holdings];
        if (d.stock_names) namesFromBundle = d.stock_names;
      } else {
        pack = await Promise.all([
          loadJSON("data/metrics.json"),
          loadJSON("data/equity.json"),
          loadJSON("data/trades.json"),
          loadJSON("data/holdings_timeline.json"),
        ]);
        try {
          namesFromBundle = await loadJSON("data/stock_names.json");
        } catch (_) {
          /* optional */
        }
      }
      if (namesFromBundle && typeof namesFromBundle === "object") {
        state.stockNames = Object.assign({}, STOCK_NAMES, namesFromBundle);
      }
      state.metrics = pack[0];
      state.equity = pack[1];
      state.trades = enrichTradesWithPnl(pack[2] || []);
      state.holdings = pack[3];
      state.strategyCache.default = {
        metrics: state.metrics,
        equity: state.equity,
        trades: pack[2] || [],
        holdings: state.holdings,
      };
      let compareRows = [];
      try {
        if (window.ASR_DATA && window.ASR_DATA.compare) {
          compareRows = window.ASR_DATA.compare;
        } else {
          compareRows = await loadJSON("data/compare_metrics.json");
        }
      } catch (_) {
        compareRows = [];
      }
      state.compare = compareRows || [];
      populateStrategySelect(state.compare);
      renderKPIs(state.metrics);
      renderSnapshot(state.metrics);
      renderCompareTable(state.compare);
      populateReasonFilter();
      renderHoldings();
      renderTrades();
      renderStrategy();
      bindFilters();
      setupNav();
      // Chart after tab is shown so canvas has width
      drawEquityChart(state.equity);
      // Prefer deep_v in selector note only; keep default view as rotation cache
    } catch (err) {
      console.error(err);
      document.body.insertAdjacentHTML(
        "afterbegin",
        '<div class="error-banner">数据加载失败：请用本地静态服务器打开（file:// 下 fetch 可能被拦）。' +
          err.message +
          "</div>"
      );
    }
  }

  // expose helpers for debugging
  window.ASR = { stockLabel: stockLabel, STOCK_NAMES: STOCK_NAMES };

  main();
})();
