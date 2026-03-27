#!/bin/bash
# scripts/server-setup.sh
#
# One-time setup for a fresh Hetzner Ubuntu 22.04 VPS.
# Run as root or sudo user:
#   bash scripts/server-setup.sh
#
# After this script completes:
#   1. Clone the repo to /opt/expense-tracker
#   2. Copy .env.example to /opt/expense-tracker/.env and fill in values
#   3. Copy backend/configs/secrets/ files to the server
#   4. cd /opt/expense-tracker && make deploy

set -e

echo "=== 1. System update ==="
apt update && apt upgrade -y

echo ""
echo "=== 2. Install Docker (official repo method) ==="
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ""
echo "=== 3. Enable Docker on boot ==="
systemctl enable docker
systemctl start docker

echo ""
echo "=== 4. Add current user to docker group ==="
# Allows running docker without sudo.
# Effect takes place after logout/login.
if [ -n "${SUDO_USER}" ]; then
    usermod -aG docker "${SUDO_USER}"
    echo "Added ${SUDO_USER} to docker group (logout and back in for effect)"
else
    echo "Run manually: usermod -aG docker <your-username>"
fi

echo ""
echo "=== 5. UFW firewall ==="
# IMPORTANT: Only open SSH, HTTP, HTTPS.
# Docker services that don't publish ports are NOT reachable externally —
# the compose setup only exposes Caddy on 80/443.
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP (Caddy)"
ufw allow 443/tcp comment "HTTPS (Caddy future)"
ufw --force enable
ufw status

echo ""
echo "=== 6. Create deploy directory ==="
mkdir -p /opt/expense-tracker
echo "Deploy directory: /opt/expense-tracker"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. git clone <repo-url> /opt/expense-tracker"
echo "  2. cd /opt/expense-tracker"
echo "  3. cp .env.example .env && nano .env  # fill in all values"
echo "  4. mkdir -p backend/configs/secrets"
echo "  5. # Copy ALL secret JSON files from Mac to server:"
echo "     # scp backend/configs/secrets/*.json root@<server-ip>:/opt/expense-tracker/backend/configs/secrets/"
echo "     # This copies: gcs_service_account_key.json, client_secret.json, client_secret_2.json"
echo "     # If client_secret_2.json doesn't exist: touch backend/configs/secrets/client_secret_2.json"
echo "  6. make deploy"
