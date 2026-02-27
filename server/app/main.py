from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel

DB_PATH = os.getenv("DB_PATH", "/data/app.db")
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_TOKEN = os.getenv("JWT_TOKEN", "")
JWT_ALG = os.getenv("JWT_ALG", "HS256")
CLEANUP_INTERVAL_SECONDS = int(os.getenv("CLEANUP_INTERVAL_SECONDS", "0"))

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
    return uuid.uuid4().hex[:12]


class ShareIn(BaseModel):
    payload: Any
    meta: Optional[dict] = None
    ttlSeconds: Optional[int] = None


class ShareOut(BaseModel):
    id: str
    expiresAt: Optional[str] = None


@app.post("/share", response_model=ShareOut)
def create_share(body: ShareIn, _: Any = Depends(_require_auth)) -> ShareOut:
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

    expires_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at)) if expires_at else None
    return ShareOut(id=share_id, expiresAt=expires_iso)


@app.get("/share/{share_id}")
def get_share(share_id: str, _: Any = Depends(_require_auth)) -> dict:
    _cleanup_expired()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    expires_at = row["expires_at"]
    if expires_at and _now_ts() > int(expires_at):
        with _connect() as conn:
            conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
            conn.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    payload = json.loads(row["payload"])
    meta = json.loads(row["meta"]) if row["meta"] else None
    return {"payload": payload, "meta": meta}


@app.delete("/share/{share_id}", status_code=204)
def delete_share(share_id: str, _: Any = Depends(_require_auth)) -> None:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
        conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
