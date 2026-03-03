# Share API (FastAPI)

This service stores shared sessions and serves them by id.

## Endpoints
- `GET /health`
  - Response: `{ "ok": true, "ts": 1700000000 }`

- `POST /share`
  - Body: `{ "payload": {..}, "meta"?: {..}, "ttlSeconds"?: number }`
  - Response: `{ "id": "abc123", "expiresAt"?: "2026-03-01T00:00:00Z" }`

- `GET /share/{id}`
  - Response: `{ "payload": {..}, "meta"?: {..} }`

- `DELETE /share/{id}`
  - Response: `204 No Content`

- `GET /logs`
  - Query: `limit` (1..500, default 100), `share_id`?, `action`?
  - Response: list of access log entries

- `GET /logs/view`
  - Query: same as `/logs`
  - Response: HTML table for quick viewing

## Auth (JWT)
If `JWT_SECRET` or `JWT_TOKEN` is set, the API expects
`Authorization: Bearer <token>`. If neither is set, requests are allowed
without auth.

Configure one of (optional):
- `JWT_SECRET` (recommended): verifies JWT (HS256 by default)
- `JWT_TOKEN` (simple fallback): exact token match

## Environment
- `DB_PATH` (default: `/data/app.db`)
- `JWT_SECRET` (preferred) or `JWT_TOKEN`
- `JWT_ALG` (default: `HS256`)
- `CLEANUP_INTERVAL_SECONDS` (default: `0`, disabled)
- `RATE_LIMIT_PER_MIN` (default: `30`, set `0` to disable)
- `MAX_PAYLOAD_BYTES` (default: `5000000`)
- `ACCESS_LOG_TTL_DAYS` (default: `30`, set `0` to disable)

## Safety Defaults
- Share IDs use 24 random bytes (URL-safe base64)
- Access logs are stored in `access_logs`
- Rate limiting is in-memory per IP

## Run (local)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Run (docker)
```bash
docker build -t share-api ./server
docker run -p 8000:8000 \
  -e JWT_SECRET=your-secret \
  -v $(pwd)/server/data:/data \
  share-api
```
