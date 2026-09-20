#!/usr/bin/env python3
"""
Перевірка ключів Gemini — підтримує два типи:

  1) Сервіс-акаунт (Vertex AI)   — JSON-файл сервіс-акаунта
  2) API-ключ (AI Studio)        — рядок виду AIza...

Використання:
    python check_gemini.py path/to/service-account.json
    python check_gemini.py AIzaSy...your-api-key...
    python check_gemini.py            # візьме з env GEMINI_SERVICE_ACCOUNT_JSON / GEMINI_API_KEY

Залежності:
    pip install requests cryptography
"""

import sys
import os
import json
import time
import base64

import requests

# Windows console: змусити UTF-8, щоб кирилиця не билась
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-3-pro",
    "gemini-3-flash",
    "gemini-1.5-flash-002",
]
LOCATION = os.environ.get("GEMINI_LOCATION", "us-central1")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# ─── Сервіс-акаунт (Vertex AI) ───────────────────────────────────────────────

def get_sa_token(sa: dict) -> str:
    """JWT -> OAuth access token для Vertex AI (scope cloud-platform)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    payload = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/cloud-platform",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }
    signing_input = (
        _b64url(json.dumps(header).encode()) + "." + _b64url(json.dumps(payload).encode())
    ).encode()

    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    jwt = signing_input.decode() + "." + _b64url(sig)

    r = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt,
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def check_vertex(sa: dict):
    print(f"Тип: Vertex AI (сервіс-акаунт)")
    print(f"Проєкт: {sa.get('project_id')}")
    print(f"Акаунт: {sa.get('client_email')}\n")

    try:
        token = get_sa_token(sa)
        print("AUTH: OK (ключ валідний)\n")
    except Exception as e:  # noqa: BLE001
        print(f"AUTH: FAIL — {e}")
        return

    project = sa["project_id"]
    for model in MODELS:
        url = (
            f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{LOCATION}/publishers/google/models/{model}:generateContent"
        )
        _call(url, {"Authorization": f"Bearer {token}"}, model)


# ─── API-ключ (AI Studio / generativelanguage) ───────────────────────────────

def check_api_key(api_key: str):
    print("Тип: Gemini API (AI Studio, API-ключ)\n")
    for model in MODELS:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
            f":generateContent?key={api_key}"
        )
        _call(url, {}, model)


# ─── Спільний виклик ─────────────────────────────────────────────────────────

def _call(url: str, extra_headers: dict, model: str):
    headers = {"Content-Type": "application/json", **extra_headers}
    body = {
        "contents": [{"role": "user", "parts": [{"text": "Reply with exactly: ok"}]}],
        "generationConfig": {"maxOutputTokens": 10},
    }
    t0 = time.time()
    try:
        r = requests.post(url, headers=headers, json=body, timeout=60)
        ms = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            data = r.json()
            parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            txt = "".join(p.get("text", "") for p in parts).strip()
            print(f"200  {model:<22} {ms}ms  -> {txt!r}")
        else:
            try:
                msg = r.json().get("error", {}).get("message", "")
            except Exception:  # noqa: BLE001
                msg = r.text
            print(f"{r.status_code:<4} {model:<22} {msg[:80]}")
    except Exception as e:  # noqa: BLE001
        print(f"ERR  {model:<22} {e}")


# ─── main ────────────────────────────────────────────────────────────────────

def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None

    # 1) API-ключ як аргумент (AIza... або новий формат AQ...)
    if arg and (arg.startswith("AIza") or arg.startswith("AQ.")):
        check_api_key(arg)
        return

    # 2) JSON-файл сервіс-акаунта як аргумент
    if arg and os.path.isfile(arg):
        with open(arg, "r", encoding="utf-8") as f:
            check_vertex(json.load(f))
        return

    # 3) env: API-ключ
    if os.environ.get("GEMINI_API_KEY"):
        check_api_key(os.environ["GEMINI_API_KEY"])
        return

    # 4) env: сервіс-акаунт JSON (один рядок або base64)
    raw = os.environ.get("GEMINI_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            sa = json.loads(raw)
        except json.JSONDecodeError:
            sa = json.loads(base64.b64decode(raw).decode())
        check_vertex(sa)
        return

    print(__doc__)
    sys.exit(1)


if __name__ == "__main__":
    main()
