import json, urllib.parse
import pandas as pd

def quickchart_candle_url(df: pd.DataFrame, symbol: str = "BTCUSDT"):
    d = df.tail(100).copy()
    d["ms"] = (d["time"].astype("int64") // 10**6).astype(int)  # to ms
    ohlc = [[int(ms), float(o), float(h), float(l), float(c)] 
            for ms, o, h, l, c in zip(d["ms"], d["open"], d["high"], d["low"], d["close"])]
    # overlay ema20/ema50
    d["ema20"] = d["close"].ewm(span=20).mean()
    d["ema50"] = d["close"].ewm(span=50).mean()
    ema20 = [[int(ms), float(v)] for ms, v in zip(d["ms"], d["ema20"])]
    ema50 = [[int(ms), float(v)] for ms, v in zip(d["ms"], d["ema50"])]

    chart_cfg = {
        "type": "financial",
        "data": {
            "datasets": [
                {"type":"candlestick","label": symbol, "data": ohlc},
                {"type":"line","label":"EMA20","data": ema20, "yAxisID":"y"},
                {"type":"line","label":"EMA50","data": ema50, "yAxisID":"y"}
            ]
        },
        "options": {
            "plugins": {"legend":{"display": True}},
            "scales": {"y": {"position": "left"}}
        }
    }
    base = "https://quickchart.io/chart"
    return f"{base}?w=900&h=480&c={urllib.parse.quote(json.dumps(chart_cfg))}"
