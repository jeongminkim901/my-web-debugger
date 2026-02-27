# Share API (FastAPI)

This service stores shared sessions and serves them by id.

## Endpoints
- `POST /share`
  - Body: `{ "payload": {..}, "meta"?: {..}, "ttlSeconds"?: number }`
  - Response: `{ "id": "abc123", "expiresAt"?: "2026-03-01T00:00:00Z" }`

- `GET /share/{id}`
  - Response: `{ "payload": {..}, "meta"?: {..} }`

- `DELETE /share/{id}`
  - Response: `204 No Content`

## Auth (JWT)
The API expects `Authorization: Bearer <token>`.

Configure one of:
- `JWT_SECRET` (recommended): verifies JWT (HS256 by default)
- `JWT_TOKEN` (simple fallback): exact token match

If neither is set, the API will reject requests with `500 Server auth not configured`.

## Environment
- `DB_PATH` (default: `/data/app.db`)
- `JWT_SECRET` (preferred) or `JWT_TOKEN`
- `JWT_ALG` (default: `HS256`)
- `CLEANUP_INTERVAL_SECONDS` (default: `0`, disabled)

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
