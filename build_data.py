#!/usr/bin/env python3
"""Regenerate web/data/*.json from cache CSVs for the static site."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
CACHE = ROOT.parent / "cache"
OUT = ROOT / "data"

# Reported backtest KPIs (sample run documented in README)
FIXED_METRICS = {
    "cagr": 0.0756,
    "cagr_pct": "7.56%",
    "max_dd": -0.1528,
    "max_dd_pct": "-15.28%",
    "sharpe": 0.79,
    "win_rate": 0.684,
    "win_rate_pct": "68.4%",
    "turnover": 4.18,
}


def _pad_code(code) -> str:
    s = str(code).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if s.isdigit():
        return s.zfill(6)
    return s


def load_trades() -> pd.DataFrame:
    path = CACHE / "trades.csv"
    df = pd.read_csv(path, dtype={"code": str})
    df["code"] = df["code"].map(_pad_code)
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    for col in ("price", "shares", "amount", "cost"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["side"] = df["side"].str.lower().str.strip()
    df["reason"] = df["reason"].fillna("").astype(str)
    return df.reset_index(drop=True)


def load_equity() -> pd.DataFrame:
    path = CACHE / "equity_curve.csv"
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    for col in ("nav", "cash", "n_pos"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.reset_index(drop=True)


def reconstruct_holdings(trades: pd.DataFrame) -> list[dict]:
    """After each trade date, snapshot open positions."""
    # code -> {shares, cost_basis, avg_cost, side_last, reason}
    book: dict[str, dict] = {}
    timeline: list[dict] = []

    for date, group in trades.groupby("date", sort=True):
        for _, row in group.iterrows():
            code = row["code"]
            side = row["side"]
            shares = float(row["shares"])
            price = float(row["price"])
            reason = row["reason"]

            pos = book.get(code)
            if side == "buy":
                if pos is None or pos["shares"] <= 1e-9:
                    book[code] = {
                        "shares": shares,
                        "cost_basis": shares * price,
                        "avg_cost": price,
                        "side_last": "buy",
                        "reason": reason,
                    }
                else:
                    new_shares = pos["shares"] + shares
                    new_basis = pos["cost_basis"] + shares * price
                    book[code] = {
                        "shares": new_shares,
                        "cost_basis": new_basis,
                        "avg_cost": new_basis / new_shares if new_shares else 0.0,
                        "side_last": "buy",
                        "reason": reason,
                    }
            elif side == "sell":
                if pos is None:
                    continue
                remain = pos["shares"] - shares
                if remain <= 1e-6:
                    book.pop(code, None)
                else:
                    # Keep avg cost; reduce basis proportionally
                    ratio = remain / pos["shares"]
                    book[code] = {
                        "shares": remain,
                        "cost_basis": pos["cost_basis"] * ratio,
                        "avg_cost": pos["avg_cost"],
                        "side_last": "sell",
                        "reason": reason,
                    }
            else:
                # unknown side — ignore
                pass

        positions = []
        for code, pos in sorted(book.items()):
            if pos["shares"] <= 1e-9:
                continue
            positions.append(
                {
                    "code": code,
                    "shares": round(pos["shares"], 6),
                    "avg_cost": round(pos["avg_cost"], 6),
                    "cost_basis": round(pos["cost_basis"], 2),
                    "side_last": pos["side_last"],
                    "reason": pos["reason"],
                }
            )
        timeline.append(
            {
                "date": date,
                "positions": positions,
                "n_pos": len(positions),
            }
        )
    return timeline


def build_trades_json(trades: pd.DataFrame) -> list[dict]:
    rows = []
    for i, row in trades.iterrows():
        rows.append(
            {
                "id": int(i) + 1,
                "date": row["date"],
                "code": row["code"],
                "side": row["side"],
                "price": round(float(row["price"]), 6),
                "shares": round(float(row["shares"]), 6),
                "amount": round(float(row["amount"]), 2),
                "cost": round(float(row["cost"]), 2),
                "reason": row["reason"],
            }
        )
    return rows


def build_equity_json(equity: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in equity.iterrows():
        item = {
            "date": row["date"],
            "nav": round(float(row["nav"]), 4),
        }
        if "cash" in equity.columns and pd.notna(row.get("cash")):
            item["cash"] = round(float(row["cash"]), 4)
        if "n_pos" in equity.columns and pd.notna(row.get("n_pos")):
            item["n_pos"] = int(row["n_pos"])
        rows.append(item)
    return rows


def build_metrics(equity: pd.DataFrame, trades: pd.DataFrame) -> dict:
    start_nav = float(equity.iloc[0]["nav"])
    end_nav = float(equity.iloc[-1]["nav"])
    metrics = {
        **FIXED_METRICS,
        "start_date": equity.iloc[0]["date"],
        "end_date": equity.iloc[-1]["date"],
        "start_nav": round(start_nav, 2),
        "final_nav": round(end_nav, 2),
        "total_return": round(end_nav / start_nav - 1, 6),
        "total_return_pct": f"{(end_nav / start_nav - 1) * 100:.2f}%",
        "trade_count": int(len(trades)),
        "buy_count": int((trades["side"] == "buy").sum()),
        "sell_count": int((trades["side"] == "sell").sum()),
        "n_days": int(len(equity)),
        "title": "缩量筑底轮动 · 持仓与操作",
        "one_liner": "缩量筑底 + 温和放量突破 + 金叉确认，叠加沪深300趋势/避险与行业死叉预警的周度轮动策略。",
    }
    return metrics


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    trades = load_trades()
    equity = load_equity()
    holdings = reconstruct_holdings(trades)

    write_json(OUT / "trades.json", build_trades_json(trades))
    write_json(OUT / "equity.json", build_equity_json(equity))
    write_json(OUT / "holdings_timeline.json", holdings)
    write_json(OUT / "metrics.json", build_metrics(equity, trades))

    print(
        f"rows: trades={len(trades)}, equity={len(equity)}, "
        f"holdings_snapshots={len(holdings)}"
    )


if __name__ == "__main__":
    main()
