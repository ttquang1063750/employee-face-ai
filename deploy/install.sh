#!/usr/bin/env bash
# Employee Face AI — production install/deploy script.
#
# Targets a fresh Debian/Ubuntu server (apt-based). Idempotent: safe to
# re-run after fixing an error partway through.
#
# What it does:
#   1. Installs system prerequisites (Docker, Python 3.11, Node.js, Nginx,
#      Certbot) if they're not already present.
#   2. Sets up .env from .env.example on first run and stops so you can fill
#      in real credentials (never ships with default admin/DB passwords).
#   3. Creates the Python venv and installs requirements.txt.
#   4. Starts the PostgreSQL container (docker compose).
#   5. Builds the Angular frontend for production (npm ci && npm run build).
#   6. Installs + enables the backend as a systemd service, auto-restarting
#      on crash and on server reboot.
#   7. Installs the Nginx site (deploy/nginx.conf.example) that serves the
#      built frontend and reverse-proxies /api + /uploads to the backend.
#   8. If a domain is passed, requests a Let's Encrypt certificate via
#      certbot so the kiosk's camera works (browsers block getUserMedia()
#      on plain HTTP for any host other than localhost).
#
# Usage (run from the repo root, as root):
#   sudo ./deploy/install.sh                                   # HTTP only — LAN/internal use
#   sudo ./deploy/install.sh yourdomain.com you@yourdomain.com  # + HTTPS via Let's Encrypt
#
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

DOMAIN="${1:-}"
CERT_EMAIL="${2:-}"
SERVICE_NAME=employee-face-ai-backend
NGINX_SITE=employee-face-ai

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}✔${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
die()  { echo -e "${RED}✘${NC} $*" >&2; exit 1; }

[ "$EUID" -eq 0 ] || die "Run as root: sudo ./deploy/install.sh"

# The service/venv/frontend build should be owned by a real user, not root —
# defaults to whoever invoked sudo, falls back to this repo's current owner.
RUN_USER="${SUDO_USER:-$(stat -c '%U' "$REPO_ROOT")}"
[ "$RUN_USER" != "root" ] || die "Refusing to run the app as root — invoke via 'sudo' from a normal user account."
log "Installing as: $RUN_USER"

echo -e "\n${YELLOW}[1/8] System packages${NC}"
apt-get update -y
apt-get install -y python3.11 python3.11-venv nginx certbot python3-certbot-nginx \
  curl ca-certificates gnupg
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
log "System packages ready."

echo -e "\n${YELLOW}[2/8] Environment variables${NC}"
if [ ! -f .env ]; then
  cp .env.example .env
  chown "$RUN_USER" .env
  warn "Created .env from .env.example with PLACEHOLDER credentials."
  warn "Edit .env now (DB password, ADMIN_USERNAME/ADMIN_PASSWORD), then re-run this script."
  exit 1
fi
log ".env present."

echo -e "\n${YELLOW}[3/8] Python virtualenv${NC}"
if [ ! -d venv ]; then
  sudo -u "$RUN_USER" python3.11 -m venv venv
fi
sudo -u "$RUN_USER" ./venv/bin/pip install --upgrade pip
sudo -u "$RUN_USER" ./venv/bin/pip install -r requirements.txt
log "Python dependencies installed."

echo -e "\n${YELLOW}[4/8] PostgreSQL container${NC}"
docker compose up -d
log "PostgreSQL container running."

echo -e "\n${YELLOW}[5/8] Frontend production build${NC}"
sudo -u "$RUN_USER" bash -c "cd frontend && npm ci && npm run build"
log "Frontend built to frontend/dist/frontend/browser."

echo -e "\n${YELLOW}[6/8] Backend systemd service${NC}"
sed -e "s#__REPO_ROOT__#$REPO_ROOT#g" -e "s#__RUN_USER__#$RUN_USER#g" \
  deploy/employee-face-ai-backend.service > "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
sleep 2
systemctl is-active --quiet "$SERVICE_NAME" || die "Backend service failed to start — check: journalctl -u $SERVICE_NAME -n 50"
log "Backend service running (systemctl status $SERVICE_NAME)."

echo -e "\n${YELLOW}[7/8] Nginx site${NC}"
SERVER_NAME="${DOMAIN:-_}"
sed -e "s#__SERVER_NAME__#$SERVER_NAME#g" -e "s#__REPO_ROOT__#$REPO_ROOT#g" \
  deploy/nginx.conf.example > "/etc/nginx/sites-available/${NGINX_SITE}"
ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
[ -f /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
log "Nginx serving the app."

echo -e "\n${YELLOW}[8/8] HTTPS (Let's Encrypt)${NC}"
if [ -n "$DOMAIN" ]; then
  if [ -n "$CERT_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect
  else
    warn "No email given — requesting cert without one (no renewal-expiry notices)."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  fi
  log "HTTPS enabled for https://$DOMAIN (certbot auto-renews via its own systemd timer)."
else
  warn "No domain given — running HTTP only. Fine for LAN/internal use, but the kiosk's"
  warn "camera won't work from any host other than 'localhost' until you add HTTPS:"
  warn "  sudo ./deploy/install.sh yourdomain.com you@yourdomain.com"
fi

echo -e "\n${GREEN}=====================================================${NC}"
echo -e "${GREEN}  EMPLOYEE FACE AI DEPLOYED${NC}"
echo -e "${GREEN}=====================================================${NC}"
if [ -n "$DOMAIN" ]; then
  echo "👉 App:      https://$DOMAIN/"
  echo "👉 API:      https://$DOMAIN/api/"
else
  echo "👉 App:      http://<server-ip>/"
  echo "👉 API:      http://<server-ip>/api/"
fi
echo "Backend logs:  journalctl -u $SERVICE_NAME -f   (or tail -f backend.log)"
echo "Restart app:   sudo systemctl restart $SERVICE_NAME"
echo "Rebuild after a code change: git pull && sudo ./deploy/install.sh ${DOMAIN} ${CERT_EMAIL}"
