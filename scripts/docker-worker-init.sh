#!/bin/bash
set -euo pipefail

# Script: Docker Worker Node Initialization
# Purpose: Sets up Docker Worker nodes and joins them to the Swarm cluster
# Usage: Called by Terraform during droplet creation

# Variables passed from Terraform
MANAGER_IP="${manager_ip}"
NODE_NAME="${node_name}"
PROJECT_NAME="${project_name}"
ENVIRONMENT="${environment}"

# Constants
NODE_EXPORTER_VERSION="1.6.1"
LOG_FILE="/var/log/init-script.log"
MAX_RETRIES=30
RETRY_DELAY=10

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting Docker Worker Node initialization for $NODE_NAME ($PROJECT_NAME-$ENVIRONMENT)"

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
    wget \
    rsync

# Install Docker Engine
log "Installing Docker Engine..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Add root to docker group
usermod -aG docker root

# Configure UFW Firewall
log "Configuring UFW firewall..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow from 10.10.0.0/16  # VPC internal traffic
ufw allow 2377/tcp  # Docker Swarm management
ufw allow 7946      # Docker Swarm communication
ufw allow 4789/udp  # Docker overlay network

# Special configuration for database node (worker-2)
if [[ "$NODE_NAME" == "worker-2" ]]; then
    log "Configuring database node specific settings..."
    # Allow MySQL port within VPC
    ufw allow from 10.10.0.0/16 to any port 3306
    
    # Mount the MySQL data volume
    log "Preparing MySQL data volume..."
    # Wait for volume to be attached
    retry_count=0
    while [ $retry_count -lt $MAX_RETRIES ]; do
        if lsblk | grep -q "sdb"; then
            log "Volume detected as /dev/sdb"
            break
        fi
        log "Waiting for volume attachment... ($retry_count/$MAX_RETRIES)"
        sleep $RETRY_DELAY
        retry_count=$((retry_count + 1))
    done
    
    if [ $retry_count -eq $MAX_RETRIES ]; then
        log "WARNING: Volume not detected after $MAX_RETRIES attempts"
    else
        # Check if volume is already formatted
        if ! blkid /dev/sdb; then
            log "Formatting MySQL data volume..."
            mkfs.ext4 /dev/sdb
        fi
        
        # Create mount point and mount
        mkdir -p /mnt/mysql-data
        echo "/dev/sdb /mnt/mysql-data ext4 defaults,nofail 0 2" >> /etc/fstab
        mount -a
        
        # Set permissions for MySQL
        chown -R 999:999 /mnt/mysql-data
        chmod 755 /mnt/mysql-data
        
        log "MySQL data volume mounted successfully"
    fi
    
    # Optimize system for database workload
    log "Applying database optimizations..."
    
    # Increase file descriptor limits
    echo "mysql soft nofile 65536" >> /etc/security/limits.conf
    echo "mysql hard nofile 65536" >> /etc/security/limits.conf
    
    # Optimize kernel parameters for MySQL
    cat >> /etc/sysctl.conf << 'EOF'
# MySQL optimizations
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
EOF
    
    sysctl -p
fi

# Wait for manager node to be ready
log "Waiting for manager node to be ready..."
retry_count=0
while [ $retry_count -lt $MAX_RETRIES ]; do
    if ping -c 1 "$MANAGER_IP" >/dev/null 2>&1; then
        log "Manager node is reachable"
        break
    fi
    log "Waiting for manager node... ($retry_count/$MAX_RETRIES)"
    sleep $RETRY_DELAY
    retry_count=$((retry_count + 1))
done

if [ $retry_count -eq $MAX_RETRIES ]; then
    log "ERROR: Manager node not reachable after $MAX_RETRIES attempts"
    exit 1
fi

# Additional wait to ensure Swarm is initialized
log "Waiting for Docker Swarm to be initialized on manager..."
sleep 30

# Get join token from manager node
log "Retrieving Docker Swarm join token..."
retry_count=0
while [ $retry_count -lt $MAX_RETRIES ]; do
    JOIN_COMMAND=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@"$MANAGER_IP" "cat /opt/swarm/worker-join-token" 2>/dev/null | grep "docker swarm join" || true)
    
    if [[ -n "$JOIN_COMMAND" ]]; then
        log "Join token retrieved successfully"
        break
    fi
    
    log "Waiting for join token... ($retry_count/$MAX_RETRIES)"
    sleep $RETRY_DELAY
    retry_count=$((retry_count + 1))
done

if [ $retry_count -eq $MAX_RETRIES ] || [[ -z "$JOIN_COMMAND" ]]; then
    log "ERROR: Could not retrieve join token after $MAX_RETRIES attempts"
    exit 1
fi

# Join the Docker Swarm
log "Joining Docker Swarm cluster..."
eval "$JOIN_COMMAND"

# Verify swarm membership
sleep 5
if docker info | grep -q "Swarm: active"; then
    log "Successfully joined Docker Swarm"
else
    log "ERROR: Failed to join Docker Swarm"
    exit 1
fi

# Install monitoring tools
log "Installing monitoring tools..."
# Node Exporter for Prometheus
useradd --no-create-home --shell /bin/false node_exporter
wget -q https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz
tar xf node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz
cp node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter /usr/local/bin/
chown node_exporter:node_exporter /usr/local/bin/node_exporter
rm -rf node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64*

# Create systemd service for node_exporter
cat > /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter --web.listen-address=:9100

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable node_exporter
systemctl start node_exporter

# Create application directories
log "Creating application directories..."
mkdir -p /opt/voting-app/{scripts,logs,data}

# Create useful aliases and scripts
log "Creating helpful scripts and aliases..."
cat >> /root/.bashrc << 'EOF'

# Docker aliases
alias dps='docker ps'
alias dimg='docker images'
alias dlog='docker logs'
alias dexec='docker exec -it'

# Docker Swarm aliases (worker context)
alias dinfo='docker info'
alias dnls='docker node ls'

# Node specific aliases
alias node-info='docker node inspect self --pretty'
alias node-tasks='docker node ps self'
EOF

# Create health check script for worker
cat > /opt/voting-app/scripts/health-check.sh << 'EOF'
#!/bin/bash
# Health check script for worker node

echo "=== Node Information ==="
docker node inspect self --format '{{.Status.State}}: {{.Description.Hostname}}'

echo -e "\n=== Node Tasks ==="
docker node ps self

echo -e "\n=== Container Status ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo -e "\n=== Network Status ==="
docker network ls | grep -E "(voting|database)"

echo -e "\n=== Volume Status ==="
docker volume ls | grep voting

echo -e "\n=== System Resources ==="
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2 $3 $4 $5}'

echo -e "\nMemory Usage:"
free -h

echo -e "\nDisk Usage:"
df -h /

if [[ "$(hostname)" == *"worker-2"* ]]; then
    echo -e "\n=== MySQL Volume Status ==="
    if mountpoint -q /mnt/mysql-data; then
        echo "MySQL volume mounted: $(df -h /mnt/mysql-data | tail -1)"
    else
        echo "WARNING: MySQL volume not mounted"
    fi
fi

echo -e "\n=== Network Connectivity ==="
ping -c 1 8.8.8.8 >/dev/null 2>&1 && echo "External connectivity: OK" || echo "External connectivity: FAILED"
EOF

chmod +x /opt/voting-app/scripts/health-check.sh

# Create log cleanup script
cat > /opt/voting-app/scripts/cleanup-logs.sh << 'EOF'
#!/bin/bash
# Clean up old Docker logs and application logs

# Clean Docker logs
docker system prune -f --volumes

# Clean application logs older than 30 days
find /opt/voting-app/logs -name "*.log" -mtime +30 -delete

# Clean system logs
journalctl --vacuum-time=30d

echo "Log cleanup completed at $(date)"
EOF

chmod +x /opt/voting-app/scripts/cleanup-logs.sh

# Set up cron jobs for maintenance
log "Setting up cron jobs..."
cat > /tmp/crontab << 'EOF'
# Health check every 10 minutes
*/10 * * * * /opt/voting-app/scripts/health-check.sh > /opt/voting-app/logs/health-check.log 2>&1

# Log cleanup weekly
0 2 * * 0 /opt/voting-app/scripts/cleanup-logs.sh >> /opt/voting-app/logs/cleanup.log 2>&1

# System update check (but don't auto-update)
0 6 * * 1 apt list --upgradable > /opt/voting-app/logs/updates-available.log 2>&1
EOF

crontab /tmp/crontab
rm /tmp/crontab

# Configure log rotation
log "Configuring log rotation..."
cat > /etc/logrotate.d/voting-app << 'EOF'
/opt/voting-app/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF

# Optimize Docker daemon for worker node
log "Optimizing Docker daemon..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "metrics-addr": "0.0.0.0:9323",
  "experimental": false,
  "live-restore": true
}
EOF

systemctl restart docker

# Wait for Docker to restart
sleep 10

# Verify Docker Swarm connectivity
log "Verifying Docker Swarm connectivity..."
if docker node ls >/dev/null 2>&1; then
    log "Docker Swarm connectivity verified"
else
    log "WARNING: Cannot list nodes - may not have manager privileges (expected for worker)"
fi

# System optimizations
log "Applying system optimizations..."

# Increase file descriptor limits
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# Optimize network settings
cat >> /etc/sysctl.conf << 'EOF'
# Network optimizations for Docker
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
net.ipv4.conf.all.forwarding = 1
net.ipv6.conf.all.forwarding = 1

# TCP optimizations
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 65536 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 30000
net.ipv4.tcp_no_metrics_save = 1
EOF

sysctl -p

# Set node labels for service placement
log "Setting node labels for service placement..."
PRIVATE_IP=$(hostname -I | awk '{print $2}')

# Label this node based on its purpose
if [[ "$NODE_NAME" == "worker-1" ]]; then
    # This will be done from manager node after deployment
    log "Node worker-1 will be labeled for: feature-service, voting-service"
elif [[ "$NODE_NAME" == "worker-2" ]]; then
    log "Node worker-2 will be labeled for: database, reporting-service"
fi

# Create node status file
cat > /opt/voting-app/node-status << EOF
NODE_NAME=${NODE_NAME}
WORKER_INIT_COMPLETED=$(date)
PRIVATE_IP=${PRIVATE_IP}
MANAGER_IP=${MANAGER_IP}
SWARM_WORKER=true
PROJECT_NAME=${PROJECT_NAME}
ENVIRONMENT=${ENVIRONMENT}
EOF

# Final verification
log "Running final verification..."
docker --version
docker info | grep -A 5 "Swarm:"

log "Worker node $NODE_NAME initialization completed successfully!"
log "Node is ready to receive service deployments"

log "Worker node initialization script completed at $(date)"