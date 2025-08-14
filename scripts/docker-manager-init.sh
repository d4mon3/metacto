#!/bin/bash
set -euo pipefail

# Script: Docker Manager Node Initialization
# Purpose: Sets up Docker Swarm manager node with nginx reverse proxy
# Usage: Called by Terraform during droplet creation

# Variables passed from Terraform
NODE_TYPE="${node_type}"
PROJECT_NAME="${project_name}"
ENVIRONMENT="${environment}"
DOMAIN_NAME="${domain_name}"

# Constants
DOCKER_COMPOSE_VERSION="2.21.0"
NODE_EXPORTER_VERSION="1.6.1"
LOG_FILE="/var/log/init-script.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting Docker Manager Node initialization for $PROJECT_NAME-$ENVIRONMENT"

# Update system packages
log "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    jq \
    htop \
    vim \
    git \
    unzip \
    wget

# Install Docker Engine
log "Installing Docker Engine..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Add root to docker group (for convenience)
usermod -aG docker root

# Install Docker Compose standalone
log "Installing Docker Compose..."
curl -L "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Nginx
log "Installing and configuring Nginx..."
apt-get install -y nginx

# Configure UFW Firewall
log "Configuring UFW firewall..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw allow 2377/tcp  # Docker Swarm management
ufw allow 7946      # Docker Swarm communication
ufw allow 4789/udp  # Docker overlay network
ufw allow from 10.10.0.0/16  # VPC internal traffic

# Initialize Docker Swarm
log "Initializing Docker Swarm..."
PRIVATE_IP=$(hostname -I | awk '{print $2}')
docker swarm init --advertise-addr "$PRIVATE_IP" --listen-addr "$PRIVATE_IP:2377"

# Save swarm join tokens
log "Saving Docker Swarm join tokens..."
mkdir -p /opt/swarm
docker swarm join-token worker > /opt/swarm/worker-join-token
docker swarm join-token manager > /opt/swarm/manager-join-token
chmod 600 /opt/swarm/*-join-token

# Create Docker networks
log "Creating Docker overlay networks..."
docker network create --driver overlay --attachable voting_network
docker network create --driver overlay --attachable database_network

# Create Docker volumes
log "Creating Docker volumes..."
docker volume create mysql_data
docker volume create nginx_conf
docker volume create ssl_certs

# Configure Nginx
log "Configuring Nginx reverse proxy..."
cat > /etc/nginx/sites-available/voting-app << EOF
# Default server block for health checks
server {
    listen 80 default_server;
    listen [::]: