# LINE Bot × FastAPI × ccxt × GPT × QuickChart (with Google Sheets logging)

這是一個最小可用（MVP）的專案範本：
- 在 LINE 聊天室輸入指令（/price、/kline、/ta）
- 後端用 FastAPI 接收 Webhook
- 用 ccxt 取交易所資料（預設 binance）
- 用 pandas 計算 EMA、RSI，丟給 GPT 產生精煉解讀
- 回傳文字 + QuickChart 圖片連結（顯示 K 線）
-（可選）把每次查詢紀錄寫入 Google Sheets

## 1) 安裝與啟動
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # 然後把 .env 裡變數填好
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

本地測試 LINE Webhook 可用 ngrok：
```bash
ngrok http 8000
```
然後把 ngrok 產生的 HTTPS URL + `/webhook` 貼到 LINE Developers 後台。

## 2) 指令（在 LINE 聊天室輸入）
- `/price btc` → 顯示現價與 24h 變化
- `/kline btc 1h 100` → 回傳最近 100 根 1h K 線（附 EMA20/50、RSI、GPT 簡評）
- `/ta btc 4h` → 回傳當前技術指標摘要 + GPT 解讀
- `/help` → 列出指令

幣名會自動補 `USDT`（如 `btc` → `BTCUSDT`）。

## 3) Google Sheets
- 建立一份試算表，第一個工作表命名 `TV_LOG`（你也可換，記得 .env 同步修改）。
- 建議欄位（第一列標題）：
  `timestamp, symbol, timeframe, price, rsi, ema20, ema50, note, gpt_summary, image_url`
- 到 Google Cloud Console 建立「服務帳戶」，產生 JSON 金鑰。
- 把試算表分享給該服務帳戶的 email（以 @iam.gserviceaccount.com 結尾）。
- 將 JSON 內容貼到 `.env` 的 `SHEET_SA_JSON` 變數（或用檔案路徑 `SHEET_SA_PATH`）。

## 4) LINE Developers 設定
- 建立 Provider + Messaging API Channel
- 取 `Channel secret`、`Channel access token`，填入 `.env`。
- 加入你的 Bot 好友，允許群組/聊天室加入（如需要）。
- Webhook URL 設定成 `https://你的域名/webhook`，開啟「Use webhook」。

## 5) 部署
- Railway / Render / Fly.io / GCP Cloud Run 均可。
- 環境變數請在平台上設定（不要把金鑰放進代碼）。

## 6) 免責聲明
本專案僅供學術/技術示範，不構成任何投資建議。使用前請了解交易風險。
