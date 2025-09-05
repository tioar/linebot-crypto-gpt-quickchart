import ccxt, pandas as pd
from .config import DEFAULT_EXCHANGE

def normalize_symbol(coin: str) -> str:
    coin = (coin or "").upper()
    if coin.endswith("USDT"):
        return coin
    return coin + "USDT"

def get_exchange(name: str | None = None):
    name = (name or DEFAULT_EXCHANGE).lower()
    ex = getattr(ccxt, name)()
    ex.load_markets()
    return ex

def fetch_ticker(symbol: str, exchange: str | None = None):
    ex = get_exchange(exchange)
    return ex.fetch_ticker(symbol)

def fetch_ohlcv(symbol: str, timeframe: str = "1h", limit: int = 100, exchange: str | None = None) -> pd.DataFrame:
    ex = get_exchange(exchange)
    data = ex.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(data, columns=["time","open","high","low","close","volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    return df

def ta_summary(df: pd.DataFrame) -> dict:
    df = df.copy()
    df["ema20"] = df["close"].ewm(span=20).mean()
    df["ema50"] = df["close"].ewm(span=50).mean()
    delta = df["close"].diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    rsi = 100 - (100 / (1 + (up.rolling(14).mean() / down.rolling(14).mean())))
    df["rsi"] = rsi
    last = df.iloc[-1]
    return {
        "close": float(last["close"]),
        "ema20": float(last["ema20"]),
        "ema50": float(last["ema50"]),
        "rsi": float(last["rsi"])
def sma(values, length):
    if len(values) < length: return None
    return sum(values[-length:]) / length

def ema(values, length):
    if len(values) < length: return None
    k = 2 / (length + 1)
    ema_val = sum(values[:length]) / length  # 初始用SMA
    for v in values[length:]:
        ema_val = v * k + ema_val * (1 - k)
    return ema_val

def rsi(closes, length=14):
    if len(closes) <= length: return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        chg = closes[i] - closes[i-1]
        gains.append(max(chg, 0.0))
        losses.append(max(-chg, 0.0))
    avg_gain = sum(gains[:length]) / length
    avg_loss = sum(losses[:length]) / length
    for i in range(length, len(gains)):
        avg_gain = (avg_gain*(length-1) + gains[i]) / length
        avg_loss = (avg_loss*(length-1) + losses[i]) / length
    rs = float('inf') if avg_loss == 0 else avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

    }
