# Feature Voting System - Infrastructure

This directory contains Terraform configuration files to provision the infrastructure for the Feature Voting System on DigitalOcean.

## Architecture Overview

The infrastructure consists of:
- **3 DigitalOcean Droplets** (Ubuntu 22.04 LTS)
  - 1 Manager Node (API Gateway + User Service + Nginx)
  - 2 Worker Nodes (Services + Database)
- **Docker Swarm Cluster** for container orchestration
- **Load Balancer** for high availability
- **VPC Network** for secure internal communication
- **Persistent Volume** for MySQL data
- **Firewall** for security

## Prerequisites

1. **DigitalOcean Account**: Sign up at [DigitalOcean](https://cloud.digitalocean.com/)
2. **DigitalOcean API Token**: Create at [API Tokens](https://cloud.digitalocean.com/account/api/tokens)
3. **Terraform**: Install from [terraform.io](https://terraform.io/downloads.html)
4. **SSH Key Pair**: Generate with `ssh-keygen -t rsa -b 4096`
5. **Domain Name** (optional): For SSL certificates and proper DNS

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd feature-voting-system/terraform

# Copy and configure variables
cp terraform.tfvars.example terraform.tfvars
```

### 2. Configure Variables

Edit `terraform.tfvars` with your values:

```hcl
# Required
do_token = "your_digitalocean_api_token_here"

# Optional but recommended
domain_name = "yourdomain.com"
ssh_public_key_path = "~/.ssh/id_rsa.pub"
```

### 3. Deploy Infrastructure

```bash
# Initialize Terraform
terraform init

# Review the deployment plan
terraform plan

# Deploy infrastructure
terraform apply
```

### 4. Get Connection Information

```bash
# View all outputs
terraform output

# Get SSH commands
terraform output ssh_connection_commands

# Get application URLs
terraform output application_urls
```

## File Structure

```
terraform/
├── main.tf                    # Main infrastructure configuration
├── variables.tf               # Input variables
├── outputs.tf                 # Output values
├── providers.tf               # Provider configurations
├── terraform.tfvars.example  # Example variables file
├── scripts/
│   ├── docker-manager-init.sh # Manager node setup script
│   └── docker-worker-init.sh  # Worker node setup script
└── README.md                  # This file
```

## Infrastructure Components

### Droplets (Virtual Machines)

| Node | Purpose | Default Size | Monthly Cost |
|------|---------|--------------|--------------|
| Manager | API Gateway, User Service, Nginx | s-2vcpu-2gb | $24 |
| Worker-1 | Feature Service, Voting Service | s-2vcpu-2gb | $24 |
| Worker-2 | MySQL Database, Reporting Service | s-2vcpu-4gb | $48 |

### Networking

- **VPC**: Private network (10.10.0.0/16) for secure communication
- **Load Balancer**: Public entry point with health checks
- **Firewall**: Restrictive rules allowing only necessary traffic

### Storage

- **MySQL Volume**: 10GB persistent SSD volume for database data
- **Backup Strategy**: Automated daily MySQL backups

## Post-Deployment Steps

### 1. Verify Infrastructure

```bash
# SSH to manager node
ssh root@<manager_ip>

# Check Docker Swarm status
docker node ls

# Check system health
/opt/voting-app/scripts/health-check.sh
```

### 2. Configure SSL (Optional)

If you have a domain name:

```bash
# SSH to manager node
ssh root@<manager_ip>

# Run certbot for SSL certificates
certbot --nginx -d yourdomain.com -d api.yourdomain.com
```

### 3. Deploy Application Stack

The infrastructure is ready for application deployment. The next phase involves:

1. Docker Compose stack deployment
2. Database schema initialization
3. Microservices deployment
4. Android application connection

## Monitoring and Maintenance

### Health Checks

```bash
# On manager node
/opt/voting-app/scripts/health-check.sh

# Check service status
docker service ls
docker stack ps voting-app
```

### Backup and Recovery

```bash
# Manual backup
/opt/voting-app/scripts/backup.sh

# View backup logs
tail -f /opt/voting-app/logs/backup.log
```

### Scaling Services

```bash
# Scale API Gateway
docker service scale voting-app_api-gateway=3

# Scale Feature Service
docker service scale voting-app_feature-service=2
```

## Customization

### Environment-Specific Configurations

**Development** (minimal cost ~$30/month):
```hcl
manager_droplet_size   = "s-1vcpu-1gb"
worker_droplet_size    = "s-1vcpu-1gb"
database_droplet_size  = "s-1vcpu-2gb"
mysql_volume_size      = 5
```

**Production** (recommended ~$200/month):
```hcl
manager_droplet_size   = "s-2vcpu-4gb"
worker_droplet_size    = "s-2vcpu-4gb"
database_droplet_size  = "s-4vcpu-8gb"
mysql_volume_size      = 50
enable_backups         = true
```

### Regional Deployment

Available DigitalOcean regions:
- `nyc1`, `nyc3` (New York)
- `sfo3` (San Francisco)
- `ams3` (Amsterdam)
- `sgp1` (Singapore)
- `lon1` (London)
- `fra1` (Frankfurt)
- `tor1` (Toronto)
- `blr1` (Bangalore)
- `syd1` (Sydney)

## Security Considerations

### Network Security
- VPC isolates internal traffic
- Firewall allows only necessary ports
- Docker Swarm uses encrypted overlay networks

### Access Control
- SSH key-based authentication only
- Root access restricted to SSH keys
- Internal services communicate over private network

### SSL/TLS
- Nginx configured for HTTPS
- Let's Encrypt integration for free SSL certificates
- Security headers configured

## Troubleshooting

### Common Issues

**Docker Swarm not forming**:
```bash
# Check if nodes can communicate
ping <manager_private_ip>

# Restart Docker service
systemctl restart docker

# Re-initialize swarm
docker swarm leave --force
docker swarm init --advertise-addr <private_ip>
```

**Volume mount issues on worker-2**:
```bash
# Check volume attachment
lsblk

# Check mount status
mount | grep mysql

# Remount if needed
mount -a
```

**Firewall blocking connections**:
```bash
# Check UFW status
ufw status

# Check Docker iptables
iptables -L DOCKER
```

### Log Locations

- **Initialization logs**: `/var/log/init-script.log`
- **Application logs**: `/opt/voting-app/logs/`
- **Docker logs**: `docker service logs <service_name>`
- **System logs**: `journalctl -u docker`

## Cost Optimization

### Development Tips
1. Use smaller droplet sizes for development
2. Destroy infrastructure when not in use: `terraform destroy`
3. Use shared volumes instead of multiple volumes
4. Disable backups for development environments

### Production Tips
1. Enable automated backups for data safety
2. Use reserved IPs to avoid IP changes
3. Implement monitoring and alerting
4. Regular security updates and patches

## Next Steps

After infrastructure deployment:

1. **Phase 2**: Deploy Docker Compose stack
2. **Phase 3**: Develop and deploy microservices
3. **Phase 4**: Build Android application
4. **Phase 5**: Integration testing and optimization

## Support

For issues with this infrastructure setup:

1. Check the troubleshooting section above
2. Review Terraform and Docker logs
3. Verify DigitalOcean account limits and quotas
4. Check the project documentation for application-specific issues

## Cleanup

To remove all infrastructure:

```bash
# WARNING: This will delete ALL resources!
terraform destroy

# Confirm when prompted
yes
```

This will remove all droplets, volumes, networks, and other resources created by this Terraform configuration.
