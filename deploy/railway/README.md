# Railway deployment

This deploys MountainLore as two services in one Railway project:

```text
Internet -> frontend (Next.js, public HTTPS URL) -> backend (FastAPI, private network) -> /app/data volume
```

Only the frontend receives a public domain. The backend stores its SQLite
database and all uploaded/generated media below `/app/data`, which must be a
Railway Volume mounted at that exact path.

## 1. Create the backend service

1. In Railway, create a service from this repository and set **Root Directory**
   to `backend`.
2. Railway reads `backend/railway.toml`; no build or start command override is
   needed.
3. Add a Volume with mount path `/app/data`.
4. Paste `backend.env.example` into Variables, replacing the frontend origin
   when a frontend domain exists. Keep AI keys in sealed variables.
5. Do **not** generate a public domain for this service.

## 2. Create the frontend service

1. Add a second service from the same repository with **Root Directory** set
   to `frontend`.
2. Railway reads `frontend/railway.toml`.
3. In Variables, add the value from `frontend.env.example`. If the backend
   service is not named `backend`, replace that name in both reference
   expressions.
4. Generate the frontend Railway domain under Settings -> Networking. This
   HTTPS address is the single URL shared with visitors.

## 3. Verify persistence and routing

1. Open the frontend URL and create a project with an image upload.
2. Redeploy the backend service.
3. Reopen the frontend URL: the project and uploaded image must still exist.

The frontend proxies browser `/api/*` requests server-side to the private
backend. It therefore keeps the existing visitor cookie same-origin and never
exposes the FastAPI address to browsers.

## Before public live-AI use

`AI_RUNTIME_MODE=live` lets any visitor who has the public link trigger
generation costs. Keep demo mode for an open smoke test; before opening live
mode, add an access gate or rate limiting and set the provider keys as sealed
Railway variables.
