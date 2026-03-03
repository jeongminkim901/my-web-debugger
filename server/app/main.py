from __future__ import annotations

import json
import os
import secrets
import sqlite3
import threading
import time
from typing import Any, Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel

DB_PATH = os.getenv("DB_PATH", "/data/app.db")
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_TOKEN = os.getenv("JWT_TOKEN", "")
JWT_ALG = os.getenv("JWT_ALG", "HS256")
CLEANUP_INTERVAL_SECONDS = int(os.getenv("CLEANUP_INTERVAL_SECONDS", "0"))
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "60"))
RATE_LIMIT_WINDOW_SECONDS = 60

_rate_limit_lock = threading.Lock()
_rate_limit_state: dict[str, list[int]] = {}

app = FastAPI(title="Share API", version="0.1.0")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS shares (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                meta TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_id TEXT,
                action TEXT NOT NULL,
                ip TEXT,
                user_agent TEXT,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.commit()

def _cleanup_expired() -> None:
    now = _now_ts()
    with _connect() as conn:
        conn.execute(
            "DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?",
            (now,),
        )
        conn.commit()

def _cleanup_loop() -> None:
    if CLEANUP_INTERVAL_SECONDS <= 0:
        return
    while True:
        try:
            _cleanup_expired()
        except Exception:
            pass
        time.sleep(CLEANUP_INTERVAL_SECONDS)

@app.on_event("startup")
def _startup() -> None:
    _init_db()
    _cleanup_expired()
    if CLEANUP_INTERVAL_SECONDS > 0:
        t = threading.Thread(target=_cleanup_loop, daemon=True)
        t.start()


def _require_auth(authorization: Optional[str] = Header(default=None)) -> None:
    if not JWT_SECRET and not JWT_TOKEN:
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    token = authorization.split(" ", 1)[1].strip()

    if JWT_SECRET:
        try:
            jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"verify_aud": False})
            return
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if JWT_TOKEN:
        if token != JWT_TOKEN:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Server auth not configured",
    )


def _now_ts() -> int:
    return int(time.time())


def _make_id() -> str:
    return secrets.token_urlsafe(24)


def _get_client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _rate_limit(request: Request) -> None:
    if RATE_LIMIT_PER_MIN <= 0:
        return
    now = _now_ts()
    ip = _get_client_ip(request)
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    with _rate_limit_lock:
        entries = _rate_limit_state.get(ip, [])
        entries = [ts for ts in entries if ts > cutoff]
        if len(entries) >= RATE_LIMIT_PER_MIN:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
        entries.append(now)
        _rate_limit_state[ip] = entries


def _log_access(action: str, share_id: Optional[str], request: Request) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO access_logs (share_id, action, ip, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                share_id,
                action,
                _get_client_ip(request),
                request.headers.get("user-agent"),
                _now_ts(),
            ),
        )
        conn.commit()


def _clamp_limit(value: int) -> int:
    if value <= 0:
        return 1
    if value > 500:
        return 500
    return value


class ShareIn(BaseModel):
    payload: Any
    meta: Optional[dict] = None
    ttlSeconds: Optional[int] = None


class ShareOut(BaseModel):
    id: str
    expiresAt: Optional[str] = None


@app.post("/share", response_model=ShareOut)
def create_share(
    body: ShareIn,
    request: Request,
    _: Any = Depends(_require_auth),
    __: Any = Depends(_rate_limit),
) -> ShareOut:
    _cleanup_expired()
    share_id = _make_id()
    now = _now_ts()
    expires_at = now + body.ttlSeconds if body.ttlSeconds else None

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO shares (id, payload, meta, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                share_id,
                json.dumps(body.payload, ensure_ascii=False),
                json.dumps(body.meta, ensure_ascii=False) if body.meta else None,
                now,
                expires_at,
            ),
        )
        conn.commit()

    _log_access("create", share_id, request)
    expires_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at)) if expires_at else None
    return ShareOut(id=share_id, expiresAt=expires_iso)


@app.get("/share/{share_id}")
def get_share(
    share_id: str,
    request: Request,
    _: Any = Depends(_require_auth),
    __: Any = Depends(_rate_limit),
) -> dict:
    _cleanup_expired()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()

    if not row:
        _log_access("read-miss", share_id, request)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    expires_at = row["expires_at"]
    if expires_at and _now_ts() > int(expires_at):
        with _connect() as conn:
            conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
            conn.commit()
        _log_access("read-expired", share_id, request)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    payload = json.loads(row["payload"])
    meta = json.loads(row["meta"]) if row["meta"] else None
    _log_access("read", share_id, request)
    return {"payload": payload, "meta": meta}


@app.delete("/share/{share_id}", status_code=204)
def delete_share(
    share_id: str,
    request: Request,
    _: Any = Depends(_require_auth),
    __: Any = Depends(_rate_limit),
) -> None:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
        conn.commit()
    if cur.rowcount == 0:
        _log_access("delete-miss", share_id, request)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    _log_access("delete", share_id, request)


@app.get("/logs")
def list_logs(
    request: Request,
    limit: int = 100,
    share_id: Optional[str] = None,
    action: Optional[str] = None,
    _: Any = Depends(_require_auth),
    __: Any = Depends(_rate_limit),
) -> list[dict]:
    limit = _clamp_limit(limit)
    query = "SELECT share_id, action, ip, user_agent, created_at FROM access_logs"
    clauses = []
    params: list[Any] = []
    if share_id:
        clauses.append("share_id = ?")
        params.append(share_id)
    if action:
        clauses.append("action = ?")
        params.append(action)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    _log_access("log-list", None, request)
    return [
        {
            "share_id": r["share_id"],
            "action": r["action"],
            "ip": r["ip"],
            "user_agent": r["user_agent"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
