import json, re, time
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel
from .line_utils import verify_line_signature, reply_text, reply_text_and_image
from .market import normalize_symbol, fetch_ticker, fetch_ohlcv, ta_summary
from .charts import quickchart_candle_url
from .gpt import analyze
from .sheets import append_log
from .config import SHEET_ID

# =========================
# 指標/計算工具
# =========================
def compute_atr(df, n=14):
    """計算 ATR(n)；df 欄位需含 high/low/close"""
    import pandas as pd
    d = df.copy()
    d["prev_close"] = d["close"].shift(1)
    tr1 = d["high"] - d["low"]
    tr2 = (d["high"] - d["prev_close"]).abs()
    tr3 = (d["low"] - d["prev_close"]).abs()
    tr = tr1.combine(tr2, max).combine(tr3, max)
    atr = tr.rolling(n).mean()
    return float(atr.iloc[-1])

def recent_sr(df, window=50):
    """回傳近 window 根的 (支撐low, 壓力high)"""
    low = float(df["low"].tail(window).min())
    high = float(df["high"].tail(window).max())
    return low, high

# =========================
# 文案模板
# =========================
def msg_long(symbol, timeframe, entry, last_close, rsi, ema20, ema50,
             t1, t2, t3, stop, low_ref=None, high_ref=None,
             headline_low=None, headline_rebound=None,
             note_extra=""):
    bias = "多頭排列" if ema20 > ema50 else "空頭排列"
    rsi_zone = "超買風險" if rsi >= 70 else ("超賣風險" if rsi <= 30 else "中性")
    status = "安全的，還小有獲利" if last_close > entry else "需要小心，未站穩進場價"
    low_txt = f"{headline_low:.0f}" if headline_low is not None else (f"{low_ref:.0f}" if low_ref else "近期低點")
    rebound_txt = f"{headline_rebound:.0f}" if headline_rebound is not None else f"{last_close:.0f}"

    msg = (
        f"好，兄弟 👊 我看到現在 {symbol} 已經從低點 {low_txt} → 拉回 {rebound_txt}，你 {entry:.0f} 進的多單目前是{status}。\n\n"
        f"📊 盤面狀況\n\n"
        f"K 線：{low_txt} 出現承接，目前在 {last_close:.0f}，屬於區間整理（{timeframe}）。\n\n"
        f"RSI：{rsi:.1f}，{rsi_zone}。\n\n"
        f"MACD：暫以 EMA20/50 代表動能 — {bias}。\n\n"
        f"🎯 多單操作計劃（{entry:.0f} 進場）\n\n"
        f"停損：{stop:.0f}（守風控，不讓這單變虧）\n\n"
        f"止盈規劃\n\n"
        f"T1：{t1:.0f} → 出 1/3（鎖利潤 + 拉安全墊）\n\n"
        f"T2：{t2:.0f} → 再出 1/3\n\n"
        f"T3：{t3:.0f} → 剩下 1/3 移動止盈\n\n"
        f"注意事項\n\n"
        f"{note_extra if note_extra else f'{last_close:.0f} 附近可能震盪，不要被小波動洗掉；均線未完全翻多前，別急著加倉。'}\n\n"
        f"✅ 總結：\n\n"
        f"守紀律，這單最壞不會虧；等他到 {t1:.0f} 先出一部分，把籌碼變成「贏家的籌碼」。"
    )
    return msg

def msg_short(symbol, timeframe, entry, last_close, rsi, ema20, ema50,
              t1, t2, t3, stop, low_ref=None, high_ref=None,
              note_extra=""):
    bias = "空頭排列" if ema20 < ema50 else "多頭排列警戒"
    rsi_zone = "超賣風險（易反彈）" if rsi <= 30 else ("超買回落風險" if rsi >= 70 else "中性")
    high_txt = f"{high_ref:.0f}" if high_ref else "近期高點"
    status = "安全的，尚在高位回落軌道" if last_close < entry else "需要小心，未跌破進場價"

    msg = (
        f"好，兄弟 👊 現在 {symbol} 從高點 {high_txt} 壓回 {last_close:.0f}，你 {entry:.0f} 進的空單{status}。\n\n"
        f"📊 盤面狀況\n\n"
        f"K 線：{high_txt} 上方遇壓，目前 {last_close:.0f}，屬於高檔回落（{timeframe}）。\n\n"
        f"RSI：{rsi:.1f}，{rsi_zone}。\n\n"
        f"動能：{bias}。\n\n"
        f"🎯 空單操作計劃（{entry:.0f} 進場）\n\n"
        f"停損：{stop:.0f}（站回去就認錯）\n\n"
        f"止盈規劃\n\n"
        f"T1：{t1:.0f} → 回補 1/3\n\n"
        f"T2：{t2:.0f} → 回補 1/3\n\n"
        f"T3：{t3:.0f} → 剩下 1/3 移動止盈\n\n"
        f"注意事項\n\n"
        f"{note_extra if note_extra else f'回抽測壓時別加倉過猛；若跌破區間低點可沿 5/10MA 續抱。'}\n\n"
        f"✅ 總結：\n\n"
        f"順勢空，守停損，階梯回補；若跌破區間低點，留一手吃趨勢。"
    )
    return msg

# =========================
# FastAPI
# =========================
import os
from fastapi import FastAPI

SHEET_ID = os.getenv("SHEET_ID")

app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True, "sheet_connected": bool(SHEET_ID)}


class LineEvent(BaseModel):
    destination: str | None = None
    events: list

@app.post("/webhook")
async def webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("x-line-signature", "")

    # 1) 驗證簽名
    if not verify_line_signature(raw, signature):
        return Response(status_code=401, content="Bad signature")

    # 2) 放寬處理 Verify/空 Body
    try:
        payload = await request.json()
    except Exception:
        return {"ok": True, "note": "no json"}

    events = payload.get("events") if isinstance(payload, dict) else None
    if not events:
        return {"ok": True, "note": "no events"}

    # 3) 逐筆事件
    for ev in events:
        if ev.get("type") != "message":
            continue
        if ev["message"]["type"] != "text":
            continue

        text = ev["message"]["text"].strip()
        reply_token = ev["replyToken"]

        # /price 幣種
        if text.lower().startswith("/price"):
            parts = text.split()
            coin = parts[1] if len(parts) > 1 else "btc"
            symbol = normalize_symbol(coin)
            try:
                t = fetch_ticker(symbol)
                msg = f"{symbol} 現價: {t['last']:.4f} | 24h: {t.get('percentage','?')}% | vol: {t.get('baseVolume','?')}"
                reply_text(reply_token, msg)
            except Exception as e:
                reply_text(reply_token, f"抓價失敗：{e}")
            return {"ok": True}

        # /kline 幣種 週期 [根數]
        if text.lower().startswith("/kline"):
            parts = text.split()
            if len(parts) < 2:
                reply_text(reply_token, "用法：/kline btc 1h 100")
                return {"ok": True}
            coin = parts[1]
            tf = parts[2] if len(parts) > 2 else "1h"
            limit = int(parts[3]) if len(parts) > 3 else 100
            symbol = normalize_symbol(coin)
            try:
                df = fetch_ohlcv(symbol, tf, limit)
                info = ta_summary(df)
                try:
                    analysis = analyze(symbol, tf, info)
                except Exception:
                    analysis = "（GPT 分析暫停：請檢查 API 額度或金鑰設定）"
                img = quickchart_candle_url(df, symbol)
                msg = (f"{symbol} {tf}\n"
                       f"收盤:{info['close']:.4f}  RSI:{info['rsi']:.1f}  "
                       f"EMA20/50:{info['ema20']:.4f}/{info['ema50']:.4f}\n— GPT: {analysis}")
                reply_text_and_image(reply_token, msg, img)
                try:
                    append_log([time.strftime("%Y-%m-%d %H:%M:%S"), symbol, tf, info['close'], info['rsi'], info['ema20'], info['ema50'], "kline", analysis, img])
                except Exception:
                    pass
            except Exception as e:
                reply_text(reply_token, f"K線失敗：{e}")
            return {"ok": True}

        # /plan 幣種 週期 進場價 [short] [atr|sr|mix] [wN] [atrN]
        if text.lower().startswith("/plan"):
            parts = text.split()
            if len(parts) < 4:
                reply_text(reply_token, "用法：/plan eth 1h 4290 [short] [atr|sr|mix] [w50] [atr14]")
                return {"ok": True}

            coin = parts[1]
            tf = parts[2]
            try:
                entry = float(parts[3])
            except Exception:
                reply_text(reply_token, "進場價必須是數字")
                return {"ok": True}

            # 預設值
            side = "long"
            mode = "atr"
            window_n = 50
            atr_n = 14

            # 解析可選參數（順序不限）
            for p in parts[4:]:
                pl = p.lower()
                if pl in ("short", "s", "空", "空單"):
                    side = "short"
                elif pl in ("atr", "sr", "mix"):
                    mode = pl
                elif pl.startswith("w") and pl[1:].isdigit():
                    window_n = max(10, min(500, int(pl[1:])))  # 安全範圍
                elif pl.startswith("atr") and pl[3:].isdigit():
                    atr_n = max(5, min(100, int(pl[3:])))

            symbol = normalize_symbol(coin)
            try:
                # 取 200 根 K 線與指標
                df = fetch_ohlcv(symbol, tf, 200)
                info = ta_summary(df)
                last_close = float(df.iloc[-1]["close"])
                rsi = float(info["rsi"])
                ema20 = float(info["ema20"])
                ema50 = float(info["ema50"])
                low_w, high_w = recent_sr(df, window_n)

                # === 三種模式 ===
                if mode == "atr":
                    atr = compute_atr(df, atr_n)
                    if side == "long":
                        stop = entry - 1.5 * atr
                        t1 = entry + 2.0 * atr
                        t2 = entry + 3.0 * atr
                        t3 = entry + 4.0 * atr
                        msg = msg_long(symbol, tf, entry, last_close, rsi, ema20, ema50, t1, t2, t3, stop,
                                       low_ref=low_w, high_ref=high_w,
                                       note_extra=f"本單使用 ATR 模式（ATR≈{atr:.1f}，n={atr_n}）：停損=entry-1.5×ATR，止盈分梯 2/3/4×ATR。")
                    else:
                        stop = entry + 1.5 * atr
                        t1 = entry - 2.0 * atr
                        t2 = entry - 3.0 * atr
                        t3 = entry - 4.0 * atr
                        msg = msg_short(symbol, tf, entry, last_close, rsi, ema20, ema50, t1, t2, t3, stop,
                                        low_ref=low_w, high_ref=high_w,
                                        note_extra=f"本單使用 ATR 模式（ATR≈{atr:.1f}，n={atr_n}）：停損=entry+1.5×ATR，止盈分梯 2/3/4×ATR。")

                elif mode == "sr":
                    buffer = max((high_w - low_w) * 0.002, 0.5)  # 結構位緩衝（0.2% 或 0.5）
                    if side == "long":
                        stop = low_w - buffer
                        span = high_w - entry
                        if span <= 0:
                            t1, t2, t3 = entry + 20, entry + 40, entry + 70
                        else:
                            t1 = entry + span * 0.35
                            t2 = entry + span * 0.65
                            t3 = high_w
                        msg = msg_long(symbol, tf, entry, last_close, rsi, ema20, ema50, t1, t2, t3, stop,
                                       low_ref=low_w, high_ref=high_w,
                                       note_extra=f"本單使用 支撐/壓力 模式（window={window_n}）：停損放在近低點下方（-{buffer:.1f} 緩衝），目標分批靠近壓力位。")
                    else:
                        stop = high_w + buffer
                        span = entry - low_w
                        if span <= 0:
                            t1, t2, t3 = entry - 20, entry - 40, entry - 70
                        else:
                            t1 = entry - span * 0.35
                            t2 = entry - span * 0.65
                            t3 = low_w
                        msg = msg_short(symbol, tf, entry, last_close, rsi, ema20, ema50, t1, t2, t3, stop,
                                        low_ref=low_w, high_ref=high_w,
                                        note_extra=f"本單使用 支撐/壓力 模式（window={window_n}）：停損放在近高點上方（+{buffer:.1f} 緩衝），目標分批靠近支撐位。")

                else:  # mix
                    atr = compute_atr(df, atr_n)
                    buffer = max((high_w - low_w) * 0.002, 0.5)
                    if side == "long":
                        stop = min(entry - 1.5 * atr, low_w - buffer)
                        t1 = entry + 2.0 * atr
                        t2 = entry + 3.0 * atr
                        t3 = high_w
                        msg = msg_long(symbol, tf, entry, last_close, rsi, ema20, ema50, t1, t2, t3, stop,
                                       low_ref=low_w, high_ref=high_w,
                                       note_extra=f"本單使用 混合 模式（ATR n={atr_n}，window={window_n}）：停損取 ATR 與支撐位較嚴的一邊；T1/T2 走 ATR 倍數，T3 看壓力位。")
                    else:
                        stop = max(entry + 1.5 * atr, high_w + buffer)
                        t1 = entry - 2.0 * atr
                        t2 = entry - 3.0 * atr
                        t3 = low_w
                        msg = msg_short(symbol, tf, entry, last_close, rsi, ema20, ema50, t1, t2, t3, stop,
                                        low_ref=low_w, high_ref=high_w,
                                        note_extra=f"本單使用 混合 模式（ATR n={atr_n}，window={window_n}）：停損取 ATR 與壓力位較嚴的一邊；T1/T2 走 ATR 倍數，T3 看支撐位。")

                reply_text(reply_token, msg)

                # 記錄到 Sheet（可選）
                try:
                    append_log([
                        time.strftime("%Y-%m-%d %H:%M:%S"),
                        symbol, tf, last_close, rsi, ema20, ema50,
                        f"plan-{side}-{mode}-w{window_n}-atr{atr_n}", msg, ""
                    ])
                except Exception:
                    pass

            except Exception as e:
                reply_text(reply_token, f"計劃生成失敗：{e}")
            return {"ok": True}

        # /ta 幣種 週期
        if text.lower().startswith("/ta"):
            parts = text.split()
            if len(parts) < 2:
                reply_text(reply_token, "用法：/ta btc 4h")
                return {"ok": True}
            coin = parts[1]
            tf = parts[2] if len(parts) > 2 else "1h"
            symbol = normalize_symbol(coin)
            try:
                df = fetch_ohlcv(symbol, tf, 200)
                info = ta_summary(df)
                try:
                    analysis = analyze(symbol, tf, info)
                except Exception:
                    analysis = "（GPT 分析暫停：請檢查 API 額度或金鑰設定）"
                msg = (f"{symbol} {tf}\n"
                       f"收盤:{info['close']:.4f}  RSI:{info['rsi']:.1f}  "
                       f"EMA20/50:{info['ema20']:.4f}/{info['ema50']:.4f}\n— GPT: {analysis}")
                reply_text(reply_token, msg)
                try:
                    append_log([time.strftime("%Y-%m-%d %H:%M:%S"), symbol, tf, info['close'], info['rsi'], info['ema20'], info['ema50'], "ta", analysis, ""])
                except Exception:
                    pass
            except Exception as e:
                reply_text(reply_token, f"TA 失敗：{e}")
            return {"ok": True}

        # 預設 help
        reply_text(
            reply_token,
            "指令：/price btc、/kline btc 1h 100、/ta btc 4h、/plan eth 1h 4290 [short] [atr|sr|mix] [wN] [atrN]"
        )

    return {"ok": True}
