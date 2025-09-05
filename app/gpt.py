from openai import OpenAI
from .config import OPENAI_API_KEY

client = OpenAI(api_key=OPENAI_API_KEY)

def analyze(symbol: str, timeframe: str, info: dict) -> str:
    prompt = f"""請用最多5行，描述此幣在 {timeframe} 的狀態與風險（勿給進出場指令）
symbol: {symbol}
close: {info.get('close'):,.4f}
ema20: {info.get('ema20'):,.4f}
ema50: {info.get('ema50'):,.4f}
rsi: {info.get('rsi'):,.1f}
"""
    res = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.2,
        messages=[
            {"role":"system","content":"你是量化交易助理，只描述市場情境與風險，不提供投資建議。"},
            {"role":"user","content": prompt}
        ]
    )
    return res.choices[0].message.content.strip()
