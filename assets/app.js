/* A-share rotation dashboard — vanilla JS, no CDN chart lib */
(function () {
  "use strict";

  const REASON_LABELS = {
    rebalance: "再平衡",
    below_ma20: "跌破MA20",
    industry_dead: "行业死叉",
    take_profit: "止盈",
    stop_loss: "止损",
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

  const state = { metrics: null, equity: [], trades: [], holdings: [] };
  const $ = (sel) => document.querySelector(sel);

  function fmtNum(n, digits) {
    if (digits == null) digits = 2;
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function reasonLabel(r) {
    return REASON_LABELS[r] || r || "—";
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
      { label: "期末净值", value: fmtNum(m.final_nav, 0), cls: "pos" },
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
    const navs = equity.map((d) => d.nav);
    let min = Math.min.apply(null, navs);
    let max = Math.max.apply(null, navs);
    const span = max - min || 1;
    min -= span * 0.05;
    max += span * 0.05;

    const xAt = (i) => pad.l + (w * i) / Math.max(equity.length - 1, 1);
    const yAt = (v) => pad.t + h * (1 - (v - min) / (max - min));

    ctx.clearRect(0, 0, cssW, cssH);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px JetBrains Mono, monospace";
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = min + ((max - min) * i) / ticks;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const label = (v / 10000).toFixed(0) + "万";
      ctx.fillText(label, 8, y + 3);
    }

    // x labels
    const xTicks = Math.min(6, equity.length);
    for (let i = 0; i < xTicks; i++) {
      const idx = Math.round(((equity.length - 1) * i) / Math.max(xTicks - 1, 1));
      const x = xAt(idx);
      const label = equity[idx].date.slice(2);
      ctx.fillStyle = "#64748b";
      ctx.fillText(label, x - 28, cssH - 12);
    }

    // area + line
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, "rgba(61,156,240,0.35)");
    grad.addColorStop(1, "rgba(61,156,240,0.00)");
    ctx.beginPath();
    equity.forEach((d, i) => {
      const x = xAt(i);
      const y = yAt(d.nav);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#3d9cf0";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(xAt(equity.length - 1), pad.t + h);
    ctx.lineTo(xAt(0), pad.t + h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    const last = equity[equity.length - 1];
    $("#nav-last").textContent =
      "最新 " + last.date + " · " + fmtNum(last.nav, 2);

    // hover
    if (!canvas._bound) {
      canvas._bound = true;
      const tip = document.createElement("div");
      tip.style.cssText =
        "position:absolute;pointer-events:none;display:none;background:#0c1220;border:1px solid rgba(255,255,255,.1);color:#e2e8f0;font:12px JetBrains Mono,monospace;padding:6px 8px;border-radius:6px;z-index:2;";
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
        tip.style.display = "block";
        tip.style.left = Math.min(rect.width - 140, Math.max(8, x + 10)) + "px";
        tip.style.top = "12px";
        tip.textContent = d.date + "  NAV " + fmtNum(d.nav, 2);
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
    return holdings[holdings.length - 1] || null;
  }

  function renderLatestBanner(snap) {
    const el = $("#holdings-latest");
    if (!snap) {
      el.innerHTML = '<p class="section-desc">暂无持仓快照</p>';
      return;
    }
    if (snap.n_pos === 0) {
      el.innerHTML =
        '<div class="card-meta"><div><span class="section-kicker">LATEST</span>' +
        '<p class="section-desc" style="margin-top:0.35rem">回测期末为空仓（现金） · 最近交易日快照 ' +
        snap.date +
        '</p></div><span class="badge badge-reason">n_pos = 0</span></div>';
      return;
    }
    const chips = snap.positions
      .map(
        (p) =>
          '<div class="pos-chip"><span class="code accent">' +
          p.code +
          '</span><span class="sub">' +
          fmtNum(p.shares, 2) +
          " 股</span><span class=\"sub\">成本 " +
          fmtNum(p.avg_cost, 3) +
          "</span></div>"
      )
      .join("");
    el.innerHTML =
      '<div class="card-meta"><div><span class="section-kicker">CURRENT / LATEST</span>' +
      '<p style="margin:0.35rem 0 0;color:#fff;font-size:0.9rem">最近非空持仓 · ' +
      snap.date +
      " · " +
      snap.n_pos +
      ' 只</p></div></div><div class="chips">' +
      chips +
      "</div>";
  }

  function filteredHoldings() {
    const code = ($("#holdings-code-filter").value || "").trim();
    const nonempty = $("#holdings-nonempty").checked;
    return state.holdings.filter((h) => {
      if (nonempty && h.n_pos === 0) return false;
      if (!code) return true;
      return h.positions.some((p) => p.code.includes(code));
    });
  }

  function renderHoldings() {
    const latest = latestNonEmpty(state.holdings);
    renderLatestBanner(latest);
    const list = filteredHoldings().slice().reverse();
    const latestDate = latest && latest.n_pos > 0 ? latest.date : null;
    $("#holdings-list").innerHTML = list
      .map((h) => {
        const isLatest = latestDate && h.date === latestDate;
        const chips =
          h.n_pos === 0
            ? '<span class="muted">空仓</span>'
            : h.positions
                .map(
                  (p) =>
                    '<div class="pos-chip"><span class="code">' +
                    p.code +
                    '</span><span class="sub">' +
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
          (isLatest ? '<span class="badge badge-buy tag-latest">最新持仓</span>' : "") +
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
    const code = ($("#trade-code").value || "").trim();
    const side = $("#trade-side").value;
    const reason = $("#trade-reason").value;
    return state.trades.filter((t) => {
      if (code && !t.code.includes(code)) return false;
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
          '</td><td class="mono accent">' +
          t.code +
          "</td><td>" +
          sideBadge +
          '</td><td class="right mono">' +
          fmtNum(t.price, 4) +
          '</td><td class="right mono">' +
          fmtNum(t.shares, 2) +
          '</td><td class="right mono">' +
          fmtNum(t.amount, 2) +
          '</td><td class="right mono muted">' +
          fmtNum(t.cost, 2) +
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

  function setupNav() {
    const links = document.querySelectorAll(".nav-link");
    const sections = Array.prototype.map.call(links, (a) =>
      $(a.getAttribute("href"))
    );
    function setActive() {
      let cur = sections[0];
      const y = window.scrollY + 120;
      sections.forEach((s) => {
        if (s && s.offsetTop <= y) cur = s;
      });
      links.forEach((a) => {
        a.classList.toggle(
          "active",
          a.getAttribute("href") === "#" + (cur && cur.id)
        );
      });
    }
    window.addEventListener("scroll", setActive, { passive: true });
    setActive();
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
    window.addEventListener("resize", () => drawEquityChart(state.equity));
  }

  async function main() {
    try {
      let pack;
      if (window.ASR_DATA) {
        const d = window.ASR_DATA;
        pack = [d.metrics, d.equity, d.trades, d.holdings];
      } else {
        pack = await Promise.all([
          loadJSON("data/metrics.json"),
          loadJSON("data/equity.json"),
          loadJSON("data/trades.json"),
          loadJSON("data/holdings_timeline.json"),
        ]);
      }
      state.metrics = pack[0];
      state.equity = pack[1];
      state.trades = pack[2];
      state.holdings = pack[3];
      renderKPIs(state.metrics);
      renderSnapshot(state.metrics);
      drawEquityChart(state.equity);
      populateReasonFilter();
      renderHoldings();
      renderTrades();
      renderStrategy();
      bindFilters();
      setupNav();
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

  main();
})();
