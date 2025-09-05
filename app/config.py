import os
from dotenv import load_dotenv
load_dotenv()

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

DEFAULT_EXCHANGE = os.getenv("DEFAULT_EXCHANGE", "binance")

SHEET_ID = os.getenv("SHEET_ID", "")
SHEET_NAME = os.getenv("SHEET_NAME", "TV_LOG")
SHEET_SA_JSON = os.getenv("SHEET_SA_JSON", "")
SHEET_SA_PATH = os.getenv("SHEET_SA_PATH", "")
