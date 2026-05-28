#!/bin/bash
# One-shot provisioning script for a fresh Hetzner/DigitalOcean VPS (Debian/Ubuntu).
# Sets up Docker, unattended-upgrades, firewall, swap, and a deploy user.
# Run as root on a fresh box:  ssh root@<vps> bash -s < provision.sh
#
# Idempotent-ish: safe to re-run, but won't reset things that already exist.

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-splitwise}"
APP_DIR="/opt/splitwise"
ENV_DIR="/etc/splitwise"

step() { printf "\n\e[1;36m▸ %s\e[0m\n" "$*"; }
need() { command -v "$1" >/dev/null 2>&1; }

step "update system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl ca-certificates gnupg ufw fail2ban unattended-upgrades

step "set timezone to UTC"
timedatectl set-timezone UTC

step "create swap (2G) if absent"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "enable unattended-upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

step "firewall (only ssh, http, https)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp   # HTTP/3
ufw --force enable

step "fail2ban — protect ssh"
systemctl enable --now fail2ban

step "install Docker"
if ! need docker; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

step "create deploy user '$DEPLOY_USER'"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  mkdir -p "/home/$DEPLOY_USER/.ssh"
  if [[ -f /root/.ssh/authorized_keys ]]; then
    cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    chmod 700 "/home/$DEPLOY_USER/.ssh"
    chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
fi

step "prepare directories"
mkdir -p "$APP_DIR" "$ENV_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
chmod 700 "$ENV_DIR"

step "next steps"
cat <<EOF

Provisioning complete on $(hostname).

Next:
  1. Copy infra/docker-compose.prod.yml, infra/Caddyfile, infra/scripts/backup.sh to $APP_DIR
  2. Create $ENV_DIR/.env from .env.example with production values
  3. As $DEPLOY_USER:  cd $APP_DIR && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
  4. Point your DNS A records for {APP_DOMAIN} and {API_DOMAIN} at this server
  5. Caddy will fetch TLS certificates automatically on first request
EOF
