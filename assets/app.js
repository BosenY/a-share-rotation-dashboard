/* A-share rotation dashboard — 缩量筑底轮动 */
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

  const state = {
    metrics: null,
    equity: [],
    trades: [],
    holdings: [],
    chart: null,
  };

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
        (pair) =>
          '<div class="row"><dt>' +
          pair[0] +
          "</dt><dd>" +
          pair[1] +
          "</dd></div>"
      )
      .join("");
  }

  function renderChart(equity) {
    const labels = equity.map((d) => d.date);
    const navs = equity.map((d) => d.nav);
    const last = equity[equity.length - 1];
    $("#nav-last").textContent = last
      ? "最新 " + last.date + " · " + fmtNum(last.nav, 2)
      : "NAV —";

    const canvas = $("#equity-chart");
    if (!canvas || typeof Chart === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (state.chart) state.chart.destroy();

    const grad = ctx.createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, "rgba(61,156,240,0.35)");
    grad.addColorStop(1, "rgba(61,156,240,0.00)");

    state.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "NAV",
            data: navs,
            borderColor: "#3d9cf0",
            backgroundColor: grad,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (c) {
                return " NAV  " + fmtNum(c.parsed.y, 2);
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#64748b", maxTicksLimit: 8, maxRotation: 0 },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            ticks: {
              color: "#64748b",
              callback: function (v) {
                return (v / 10000).toFixed(0) + "万";
              },
            },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
        },
      },
    });
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
      el.innerHTML = "<p class=\"muted\">暂无持仓快照</p>";
      return;
    }
    if (snap.n_pos === 0) {
      el.innerHTML =
        "<div class=\"timeline-detail\"><strong>空仓</strong>" +
        "<span class=\"muted\">最近快照 " +
        snap.date +
        " · n_pos = 0（现金）</span></div>";
      return;
    }
    const chips = snap.positions
      .map(
        (p) =>
          '<span class="pos-chip"><span class="code">' +
          p.code +
          "</span><span class=\"muted\">" +
          fmtNum(p.shares, 2) +
          " 股</span><span class=\"muted\">成本 " +
          fmtNum(p.avg_cost, 3) +
          "</span></span>"
      )
      .join("");
    el.innerHTML =
      '<div class="timeline-detail"><strong>最近非空持仓</strong>' +
      "<span class=\"mono\">" +
      snap.date +
      "</span><span class=\"muted\">" +
      snap.n_pos +
      " 只</span></div><div>" +
      chips +
      "</div>";
  }

  function filteredDateOptions() {
    const code = ($("#holdings-code-filter").value || "").trim();
    const nonempty = $("#holdings-nonempty").checked;
    return state.holdings.filter((h) => {
      if (nonempty && h.n_pos === 0) return false;
      if (!code) return true;
      return h.positions.some((p) => p.code.includes(code));
    });
  }

  function populateTimelineSelect(preferDate) {
    const sel = $("#timeline-date");
    const list = filteredDateOptions();
    const prev = preferDate || sel.value;
    sel.innerHTML = "";
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "无匹配日期";
      sel.appendChild(opt);
      return;
    }
    list
      .slice()
      .reverse()
      .forEach((h) => {
        const opt = document.createElement("option");
        opt.value = h.date;
        opt.textContent = h.date + " · " + h.n_pos + " 只";
        sel.appendChild(opt);
      });
    if (prev && list.some((h) => h.date === prev)) {
      sel.value = prev;
    } else {
      const latest = latestNonEmpty(list);
      sel.value = latest ? latest.date : list[list.length - 1].date;
    }
  }

  function renderTimelineDetail() {
    const date = $("#timeline-date").value;
    const snap = state.holdings.find((h) => h.date === date);
    const detail = $("#timeline-detail");
    const tbody = $("#timeline-tbody");
    const empty = $("#timeline-empty");

    if (!snap) {
      detail.innerHTML = '<span class="muted">请选择日期</span>';
      tbody.innerHTML = "";
      empty.style.display = "none";
      return;
    }

    detail.innerHTML =
      "<strong>日期</strong> <span class=\"mono\">" +
      snap.date +
      "</span> · <span class=\"muted\">持仓 " +
      snap.n_pos +
      " 只</span>";

    if (!snap.positions.length) {
      tbody.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    tbody.innerHTML = snap.positions
      .map(
        (p) =>
          "<tr><td class=\"mono\">" +
          p.code +
          '</td><td class="num">' +
          fmtNum(p.shares, 2) +
          '</td><td class="num">' +
          fmtNum(p.avg_cost, 4) +
          '</td><td class="num">' +
          fmtNum(p.cost_basis, 2) +
          "</td><td>" +
          (p.side_last === "buy"
            ? '<span class="pill buy">买入</span>'
            : '<span class="pill sell">卖出</span>') +
          "</td><td><span class=\"pill reason\">" +
          reasonLabel(p.reason) +
          "</span></td></tr>"
      )
      .join("");
  }

  function renderHoldingsUI() {
    renderLatestBanner(latestNonEmpty(state.holdings));
    populateTimelineSelect();
    renderTimelineDetail();
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
            ? '<span class="pill buy">买入</span>'
            : '<span class="pill sell">卖出</span>';
        return (
          "<tr><td class=\"mono\">" +
          t.date +
          '</td><td class="mono">' +
          t.code +
          "</td><td>" +
          sideBadge +
          '</td><td class="num">' +
          fmtNum(t.price, 4) +
          '</td><td class="num">' +
          fmtNum(t.shares, 2) +
          '</td><td class="num">' +
          fmtNum(t.amount, 2) +
          '</td><td class="num muted">' +
          fmtNum(t.cost, 2) +
          "</td><td><span class=\"pill reason\">" +
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
        '<article class="strategy-card"><h3>' +
        c.title +
        "</h3><ul>" +
        c.body.map((b) => "<li><span>" + b + "</span></li>").join("") +
        "</ul></article>"
    ).join("");
  }

  function setupNav() {
    const links = document.querySelectorAll("nav.tabs a");
    const sections = Array.from(links).map((a) => $(a.getAttribute("href")));
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
      el.addEventListener("input", function () {
        populateTimelineSelect();
        renderTimelineDetail();
      });
      el.addEventListener("change", function () {
        populateTimelineSelect();
        renderTimelineDetail();
      });
    });
    $("#timeline-date").addEventListener("change", renderTimelineDetail);
    ["trade-code", "trade-side", "trade-reason"].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener("input", renderTrades);
      el.addEventListener("change", renderTrades);
    });
  }

  async function main() {
    try {
      const pack = await Promise.all([
        loadJSON("./data/metrics.json"),
        loadJSON("./data/equity.json"),
        loadJSON("./data/trades.json"),
        loadJSON("./data/holdings_timeline.json"),
      ]);
      state.metrics = pack[0];
      state.equity = pack[1];
      state.trades = pack[2];
      state.holdings = pack[3];

      renderKPIs(state.metrics);
      renderSnapshot(state.metrics);
      renderChart(state.equity);
      populateReasonFilter();
      renderHoldingsUI();
      renderTrades();
      renderStrategy();
      bindFilters();
      setupNav();
    } catch (err) {
      console.error(err);
      document.body.insertAdjacentHTML(
        "afterbegin",
        '<div class="error-banner">数据加载失败：请用本地静态服务器打开（或检查 data/*.json）。' +
          err.message +
          "</div>"
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
