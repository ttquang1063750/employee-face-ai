# Deploying to a real server

Everything here assumes a single Debian/Ubuntu server that will run the
database, backend, and frontend together (Docker for Postgres, systemd for
the Python backend, Nginx serving the built Angular app and reverse-proxying
API calls). This works whether that server is a cloud VPS with a public
domain or an on-prem machine on your office LAN — the frontend build is
domain-agnostic (see the note in `frontend/src/environments/environment.ts`),
so the same steps apply either way.

## One thing to decide up front: HTTPS

The kiosk check-in page needs camera access (`getUserMedia()`), which
browsers only allow on `https://` or on `http://localhost`. So:

- **LAN-only, no public domain** — skip HTTPS, access the app by the
  server's LAN IP (`http://192.168.x.x/`). Fine as long as every machine
  using the kiosk is on that same network.
- **Public domain** (VPS, or an on-prem box with a domain pointed at it) —
  get HTTPS via Let's Encrypt. `install.sh` does this for you if you pass a
  domain.

## Automated install

From the repo root, on the target server:

```bash
git clone <this repo> employee-face-ai
cd employee-face-ai

# HTTP only (LAN/internal use):
sudo ./deploy/install.sh

# With a public domain + HTTPS:
sudo ./deploy/install.sh yourdomain.com you@yourdomain.com
```

The script is idempotent — safe to re-run. On the first run it will stop
after creating `.env` from `.env.example` so you can fill in real database
and admin credentials (it refuses to run with the placeholder defaults left
in place); re-run the same command afterwards to finish.

See the comment header of [`install.sh`](install.sh) for exactly what each
step does. To redeploy after pulling new code:

```bash
git pull
sudo ./deploy/install.sh yourdomain.com you@yourdomain.com  # same args as before
```

## What it sets up

| Piece | How it runs in production |
|---|---|
| PostgreSQL | Docker container via the existing `docker-compose.yml`, unchanged from dev |
| Backend (`server.py`) | systemd service (`employee-face-ai-backend`), auto-restarts on crash and on reboot |
| Frontend | `ng build` production bundle, served as static files by Nginx |
| Routing | Nginx serves the frontend and reverse-proxies `/api/` + `/uploads/` to the backend on `127.0.0.1:8000` — same origin, so no CORS config needed |
| HTTPS | Certbot (Let's Encrypt), only if you pass a domain |

## Manual steps (if you'd rather not run the script)

1. `cp .env.example .env` and fill in real values.
2. `python3.11 -m venv venv && ./venv/bin/pip install -r requirements.txt`
3. `docker compose up -d`
4. `cd frontend && npm ci && npm run build && cd ..`
5. Copy `deploy/employee-face-ai-backend.service` to
   `/etc/systemd/system/`, replacing `__REPO_ROOT__`/`__RUN_USER__`, then
   `systemctl daemon-reload && systemctl enable --now employee-face-ai-backend`.
6. Copy `deploy/nginx.conf.example` to
   `/etc/nginx/sites-available/employee-face-ai`, replacing
   `__SERVER_NAME__`/`__REPO_ROOT__`, symlink it into `sites-enabled/`, then
   `nginx -t && systemctl reload nginx`.
7. Optional HTTPS: `certbot --nginx -d yourdomain.com`.

## Day-to-day operations

```bash
sudo systemctl status employee-face-ai-backend    # is it up?
sudo systemctl restart employee-face-ai-backend   # restart after a config change
journalctl -u employee-face-ai-backend -f         # tail logs
sudo systemctl reload nginx                       # after editing the Nginx site
docker compose ps                                 # check the DB container
```

## Backups

`docker-compose.yml`'s Postgres data lives in the `employee_face_ai_pgdata`
Docker volume, and employee photos/documents live under `uploads/` in the
repo. Back up both — e.g.:

```bash
docker exec employee-face-ai-db pg_dump -U postgres employee_face_ai > backup.sql
tar czf uploads-backup.tar.gz uploads/
```

Neither is currently automated (no cron/systemd timer) — set one up if the
customer needs recurring backups.
