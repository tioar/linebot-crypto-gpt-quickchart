import base64, hmac, hashlib, json, requests
from .config import LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET

def verify_line_signature(raw_body: bytes, signature_header: str) -> bool:
    mac = hmac.new(LINE_CHANNEL_SECRET.encode('utf-8'), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(mac).decode('utf-8')
    return hmac.compare_digest(expected, signature_header or "")

def reply_text(reply_token: str, text: str):
    url = "https://api.line.me/v2/bot/message/reply"
    headers = {
        "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }
    body = {
        "replyToken": reply_token,
        "messages": [{"type":"text", "text": text[:4999]}]
    }
    requests.post(url, headers=headers, json=body, timeout=10)

def reply_text_and_image(reply_token: str, text: str, image_url: str):
    url = "https://api.line.me/v2/bot/message/reply"
    headers = {
        "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }
    body = {
        "replyToken": reply_token,
        "messages": [
            {"type": "text", "text": text[:4999]},
            {"type": "image", "originalContentUrl": image_url, "previewImageUrl": image_url}
        ]
    }
    requests.post(url, headers=headers, json=body, timeout=10)
