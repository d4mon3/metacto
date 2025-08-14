# Terraform Variables Configuration
# Copy this file to terraform.tfvars and fill in your values

# Required: DigitalOcean API Token
# Get from: https://cloud.digitalocean.com/account/api/tokens
do_token = "your_digitalocean_api_token_here"

# Optional: Cloudflare Configuration (for DNS management)
# If you want to use Cloudflare for DNS, set use_cloudflare = true
use_cloudflare        = false
cloudflare_api_token  = "your_cloudflare_api_token_here"
cloudflare_zone_id    = "your_cloudflare_zone_id_here"

# Project Configuration
project_name = "feature-voting"
environment  = "dev"  # dev, staging, or prod

# Infrastructure Configuration
region = "nyc3"  # DigitalOcean region

# Droplet Sizes (see: https://docs.digitalocean.com/products/droplets/concepts/choosing-a-plan/)
manager_droplet_size   = "s-2vcpu-2gb"    # $24/month
worker_droplet_size    = "s-2vcpu-2gb"    # $24/month  
database_droplet_size  = "s-2vcpu-4gb"    # $48/month

# Domain Configuration
domain_name = "voting-app.example.com"  # Your domain name
subdomain   = "api"                      # Subdomain for API (api.yourdomain.com)

# SSH Configuration
ssh_public_key_path = "~/.ssh/id_rsa.pub"  # Path to your SSH public key

# Storage Configuration
mysql_volume_size = 10  # GB - Minimum 1GB, recommended 10GB for development

# Optional Features
enable_monitoring