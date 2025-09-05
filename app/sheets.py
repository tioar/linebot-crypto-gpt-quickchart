import json, gspread
from google.oauth2.service_account import Credentials
from .config import SHEET_ID, SHEET_NAME, SHEET_SA_JSON, SHEET_SA_PATH

_ws = None

def _get_ws():
    global _ws
    if _ws is not None:
        return _ws
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    if SHEET_SA_JSON:
        info = json.loads(SHEET_SA_JSON)
        creds = Credentials.from_service_account_info(info, scopes=scopes)
    elif SHEET_SA_PATH:
        creds = Credentials.from_service_account_file(SHEET_SA_PATH, scopes=scopes)
    else:
        raise RuntimeError("Need SHEET_SA_JSON or SHEET_SA_PATH")
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(SHEET_ID)
    _ws = sh.worksheet(SHEET_NAME)
    return _ws

def append_log(row: list[str | float]):
    ws = _get_ws()
    ws.append_row(row)
