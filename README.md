# 缩量筑底轮动 · 持仓与操作（静态站）

纯静态 HTML/CSS/JS 看板，无构建步骤。数据来自上级目录 `cache/trades.csv` 与 `equity_curve.csv`。

## 本地预览

直接双击打开 `index.html` 即可（已内嵌 `assets/bundle_data.js`，`file://` 可用）。

或起一个静态服务：

```bash
cd web
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765/
```

## 刷新数据

回测产出新 CSV 后：

```bash
cd web
python3 build_data.py
```

会重写 `data/*.json` 与 `assets/bundle_data.js`。

## Netlify

本目录已含 `netlify.toml`（`publish = "."`）。将 **web/** 作为发布根目录部署即可；父仓库部署时把 Base directory 设为 `web`。

无需 Build command（配置里为 `echo no-build`）。

## 说明

- 研究用途回测展示，非投资建议。
- 站点不含密钥。
