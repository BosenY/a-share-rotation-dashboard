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
    "cagr": 0.0200,
    "cagr_pct": "2.00%",
    "max_dd": -0.1853,
    "max_dd_pct": "-18.53%",
    "sharpe": 0.220,
    "win_rate": 0.475,
    "win_rate_pct": "47.5%",
    "turnover": 16.30,
    "universe": "hs300",
    "max_stocks": 300,
    "n_panels": 300,
}

STOCK_NAMES = {
    "000002": "万科A",
    "000157": "中联重科",
    "000166": "申万宏源",
    "000338": "潍柴动力",
    "000617": "中油资本",
    "000708": "中信特钢",
    "000776": "广发证券",
    "000792": "盐湖股份",
    "000807": "云铝股份",
    "000858": "五粮液",
    "000895": "双汇发展",
    "000938": "紫光股份",
    "000977": "浪潮信息",
    "000988": "华工科技",
    "002049": "紫光国微",
    "002050": "三花智控",
    "002142": "宁波银行",
    "002179": "中航光电",
    "002202": "金风科技",
    "002236": "大华股份",
    "002241": "歌尔股份",
    "002311": "海大集团",
    "002415": "海康威视",
    "002422": "科伦药业",
    "002466": "天齐锂业",
    "002493": "荣盛石化",
    "002625": "光启技术",
    "002648": "卫星化学",
    "002714": "牧原股份",
    "002837": "英维克",
    "002916": "深南电路",
    "003816": "中国广核",
    "300059": "东方财富",
    "300251": "光线传媒",
    "300274": "阳光电源",
    "300408": "三环集团",
    "300433": "蓝思科技",
    "300442": "润泽科技",
    "300803": "指南针",
    "300896": "爱美客",
    "300999": "金龙鱼",
    "301269": "华大九天",
    "302132": "中航成飞",
    "600010": "包钢股份",
    "600015": "华夏银行",
    "600018": "上港集团",
    "600019": "宝钢股份",
    "600023": "浙能电力",
    "600025": "华能水电",
    "600026": "中远海能",
    "600027": "华电国际",
    "600039": "四川路桥",
    "600048": "保利发展",
    "600050": "中国联通",
    "600061": "国投资本",
    "600085": "同仁堂",
    "600089": "特变电工",
    "600104": "上汽集团",
    "600115": "中国东航",
    "600176": "中国巨石",
    "600183": "生益科技",
    "600196": "复星医药",
    "600219": "南山铝业",
    "600221": "海航控股",
    "600276": "恒瑞医药",
    "600346": "恒力石化",
    "600362": "江西铜业",
    "600372": "中航机载",
    "600415": "小商品城",
    "600519": "贵州茅台",
    "600549": "厦门钨业",
    "600570": "恒生电子",
    "600588": "用友网络",
    "600660": "福耀玻璃",
    "600690": "海尔智家",
    "600795": "国电电力",
    "600803": "新奥股份",
    "600886": "国投电力",
    "600887": "伊利股份",
    "600900": "长江电力",
    "600905": "三峡能源",
    "600918": "中泰证券",
    "600926": "杭州银行",
    "600930": "华电新能",
    "600941": "中国移动",
    "600958": "东方证券",
    "600989": "宝丰能源",
    "601018": "宁波港",
    "601058": "赛轮轮胎",
    "601066": "中信建投",
    "601111": "中国国航",
    "601117": "中国化学",
    "601127": "赛力斯",
    "601211": "国泰海通",
    "601225": "陕西煤业",
    "601318": "中国平安",
    "601336": "新华保险",
    "601360": "三六零",
    "601390": "中国中铁",
    "601456": "国联民生",
    "601601": "中国太保",
    "601628": "中国人寿",
    "601669": "中国电建",
    "601788": "光大证券",
    "601800": "中国交建",
    "601818": "光大银行",
    "601825": "沪农商行",
    "601868": "中国能建",
    "601872": "招商轮船",
    "601878": "浙商证券",
    "601881": "中国银河",
    "601888": "中国中免",
    "601898": "中煤能源",
    "601901": "方正证券",
    "601919": "中远海控",
    "601939": "建设银行",
    "601988": "中国银行",
    "601995": "中金公司",
    "601998": "中信银行",
    "603019": "中科曙光",
    "603260": "合盛硅业",
    "603369": "今世缘",
    "603501": "豪威集团",
    "603986": "兆易创新",
    "603993": "洛阳钼业",
    "605499": "东鹏饮料",
    "688041": "海光信息",
    "688047": "龙芯中科",
    "688111": "金山办公",
    "688126": "沪硅产业",
    "688223": "晶科能源",
    "688303": "大全能源",
    "688506": "百利天恒",
    "688521": "芯原股份",
    "688981": "中芯国际",
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
    for col in ("price", "shares", "amount", "cost", "avg_cost", "pnl", "pnl_pct"):
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
                    ratio = remain / pos["shares"]
                    book[code] = {
                        "shares": remain,
                        "cost_basis": pos["cost_basis"] * ratio,
                        "avg_cost": pos["avg_cost"],
                        "side_last": "sell",
                        "reason": reason,
                    }
            else:
                pass

        positions = []
        for code, pos in sorted(book.items()):
            if pos["shares"] <= 1e-9:
                continue
            positions.append(
                {
                    "code": code,
                    "name": STOCK_NAMES.get(code, ""),
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
    """Build trade rows with average-cost P&L on sells."""
    book: dict[str, dict] = {}
    rows: list[dict] = []

    for i, row in trades.iterrows():
        code = row["code"]
        side = row["side"]
        shares = float(row["shares"])
        price = float(row["price"])
        amount = float(row["amount"])
        cost = float(row["cost"])

        item: dict = {
            "id": int(i) + 1,
            "date": row["date"],
            "code": code,
            "name": STOCK_NAMES.get(code, ""),
            "side": side,
            "price": round(price, 6),
            "shares": round(shares, 6),
            "amount": round(amount, 2),
            "cost": round(cost, 2),
            "reason": row["reason"],
            "pnl": None,
            "pnl_pct": None,
            "pnl_label": None,
        }

        if side == "buy":
            pos = book.get(code)
            if pos is None or pos["shares"] <= 1e-9:
                book[code] = {"shares": shares, "cost_basis": shares * price}
            else:
                ns = pos["shares"] + shares
                nb = pos["cost_basis"] + shares * price
                book[code] = {"shares": ns, "cost_basis": nb}
        elif side == "sell":
            pos = book.get(code)
            avg_cost = 0.0
            if pos and pos["shares"] > 1e-9:
                avg_cost = pos["cost_basis"] / pos["shares"]
                remain = pos["shares"] - shares
                if remain <= 1e-6:
                    book.pop(code, None)
                else:
                    book[code] = {
                        "shares": remain,
                        "cost_basis": pos["cost_basis"] * (remain / pos["shares"]),
                    }
            cost_amount = avg_cost * shares
            pnl = amount - cost_amount
            pnl_pct = (pnl / cost_amount * 100.0) if cost_amount > 1e-9 else None
            item["pnl"] = round(pnl, 2)
            item["pnl_pct"] = None if pnl_pct is None else round(pnl_pct, 2)
            if pnl > 0.005:
                item["pnl_label"] = "挣了"
            elif pnl < -0.005:
                item["pnl_label"] = "赔了"
            else:
                item["pnl_label"] = "持平"
            item["avg_cost"] = round(avg_cost, 6)

        rows.append(item)
    return rows


def build_equity_json(equity: pd.DataFrame) -> list[dict]:
    rows = []
    start_nav = float(equity.iloc[0]["nav"]) if len(equity) else 1.0
    for _, row in equity.iterrows():
        nav = float(row["nav"])
        item = {
            "date": row["date"],
            "nav": round(nav, 4),
            "ret_pct": round((nav / start_nav - 1.0) * 100.0, 4),
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
    trades_json = build_trades_json(trades)
    equity_json = build_equity_json(equity)
    metrics = build_metrics(equity, trades)

    write_json(OUT / "trades.json", trades_json)
    write_json(OUT / "equity.json", equity_json)
    write_json(OUT / "holdings_timeline.json", holdings)
    write_json(OUT / "metrics.json", metrics)
    write_json(OUT / "stock_names.json", STOCK_NAMES)

    bundle = {
        "metrics": metrics,
        "equity": equity_json,
        "trades": trades_json,
        "holdings": holdings,
        "stock_names": STOCK_NAMES,
    }
    assets = ROOT / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    bundle_path = assets / "bundle_data.js"
    bundle_path.write_text(
        "window.ASR_DATA = " + json.dumps(bundle, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {bundle_path} ({bundle_path.stat().st_size} bytes)")

    sells = [t for t in trades_json if t["side"] == "sell"]
    with_pnl = sum(1 for t in sells if t.get("pnl") is not None)
    print(
        f"rows: trades={len(trades)}, equity={len(equity)}, "
        f"holdings_snapshots={len(holdings)}, sells_with_pnl={with_pnl}/{len(sells)}"
    )


if __name__ == "__main__":
    main()
