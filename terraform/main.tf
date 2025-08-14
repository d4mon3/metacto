# Local values for common tags and naming
locals {
  common_tags = concat([
    var.project_name,
    var.environment
  ], var.tags)
  
  name_prefix = "${var.project_name}-${var.environment}"
}

# SSH Key for accessing droplets
resource "digitalocean_ssh_key" "voting_app" {
  name       = "${local.name_prefix}-key"
  public_key = file(var.ssh_public_key_path)
}

# VPC Network for secure communication
resource "digitalocean_vpc" "voting_app_vpc" {
  name     = "${local.name_prefix}-vpc"
  region   = var.region
  ip_range = "10.10.0.0/16"
  
  description = "VPC for ${var.project_name} ${var.environment} environment"
}

# Manager Node (API Gateway + User Service + Nginx)
resource "digitalocean_droplet" "manager" {
  image    = "ubuntu-22-04-x64"
  name     = "${local.name_prefix}-manager"
  region   = var.region
  size     = var.manager_droplet_size
  vpc_uuid = digitalocean_vpc.voting_app_vpc.id
  ssh_keys = [digitalocean_ssh_key.voting_app.id]
  
  monitoring           = var.enable_monitoring
  backups             = var.enable_backups
  ipv6                = false
  resize_disk         = true
  graceful_shutdown   = true

  user_data = templatefile("${path.module}/scripts/docker-manager-init.sh", {
    node_type    = "manager"
    project_name = var.project_name
    environment  = var.environment
    domain_name  = var.domain_name
  })

  tags = concat(local.common_tags, ["manager", "docker-swarm"])
  
  lifecycle {
    create_before_destroy = true
  }
}

# Worker Node 1 (Feature Service + Voting Service)
resource "digitalocean_droplet" "worker_1" {
  image    = "ubuntu-22-04-x64"
  name     = "${local.name_prefix}-worker-1"
  region   = var.region
  size     = var.worker_droplet_size
  vpc_uuid = digitalocean_vpc.voting_app_vpc.id
  ssh_keys = [digitalocean_ssh_key.voting_app.id]
  
  monitoring           = var.enable_monitoring
  backups             = var.enable_backups
  ipv6                = false
  resize_disk         = true
  graceful_shutdown   = true

  user_data = templatefile("${path.module}/scripts/docker-worker-init.sh", {
    manager_ip   = digitalocean_droplet.manager.ipv4_address_private
    node_name    = "worker-1"
    project_name = var.project_name
    environment  = var.environment
  })

  tags = concat(local.common_tags, ["worker", "docker-swarm", "services"])
  
  depends_on = [digitalocean_droplet.manager]
  
  lifecycle {
    create_before_destroy = true
  }
}

# Worker Node 2 (Database + Reporting Service + Backup)
resource "digitalocean_droplet" "worker_2" {
  image    = "ubuntu-22-04-x64"
  name     = "${local.name_prefix}-worker-2"
  region   = var.region
  size     = var.database_droplet_size  # More resources for database
  vpc_uuid = digitalocean_vpc.voting_app_vpc.id
  ssh_keys = [digitalocean_ssh_key.voting_app.id]
  
  monitoring           = var.enable_monitoring
  backups             = var.enable_backups
  ipv6                = false
  resize_disk         = true
  graceful_shutdown   = true

  user_data = templatefile("${path.module}/scripts/docker-worker-init.sh", {
    manager_ip   = digitalocean_droplet.manager.ipv4_address_private
    node_name    = "worker-2"
    project_name = var.project_name
    environment  = var.environment
  })

  tags = concat(local.common_tags, ["worker", "docker-swarm", "database"])
  
  depends_on = [digitalocean_droplet.manager]
  
  lifecycle {
    create_before_destroy = true
  }
}

# Load Balancer for high availability
resource "digitalocean_loadbalancer" "voting_app_lb" {
  name     = "${local.name_prefix}-lb"
  region   = var.region
  vpc_uuid = digitalocean_vpc.voting_app_vpc.id
  
  size_unit  = 1

  
  # HTTP forwarding
  forwarding_rule {
    entry_protocol  = "http"
    entry_port      = 80
    target_protocol = "http"
    target_port     = 80
  }

  # HTTPS forwarding (will be configured after SSL setup)
  forwarding_rule {
    entry_protocol  = "https"
    entry_port      = 443
    target_protocol = "http"
    target_port     = 80
    tls_passthrough = false
  }

  # Health check configuration
  healthcheck {
    protocol               = "http"
    port                   = 80
    path                   = "/health"
    check_interval_seconds = 10
    response_timeout_seconds = 5
    unhealthy_threshold    = 3
    healthy_threshold      = 2
  }

  # Sticky sessions (optional)
  sticky_sessions {
    type               = "cookies"
    cookie_name        = "lb-session"
    cookie_ttl_seconds = 3600
  }

  droplet_ids = [digitalocean_droplet.manager.id]
  
  # Redirect HTTP to HTTPS (after SSL is configured)
  redirect_http_to_https = false  # Set to true after SSL setup
}

# Firewall configuration for security
resource "digitalocean_firewall" "voting_app_fw" {
  name = "${local.name_prefix}-firewall"

  droplet_ids = [
    digitalocean_droplet.manager.id,
    digitalocean_droplet.worker_1.id,
    digitalocean_droplet.worker_2.id
  ]

  # SSH access (restrict to your IP in production)
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTP/HTTPS from load balancer and public
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Docker Swarm management traffic
  inbound_rule {
    protocol    = "tcp"
    port_range  = "2377"
    source_tags = [var.project_name]
  }

  # Docker Swarm node communication
  inbound_rule {
    protocol    = "tcp"
    port_range  = "7946"
    source_tags = [var.project_name]
  }

  inbound_rule {
    protocol    = "udp"
    port_range  = "7946"
    source_tags = [var.project_name]
  }

  # Docker overlay network
  inbound_rule {
    protocol    = "udp"
    port_range  = "4789"
    source_tags = [var.project_name]
  }

  # Internal VPC communication (all ports)
  inbound_rule {
    protocol         = "tcp"
    port_range       = "1-65535"
    source_addresses = ["10.10.0.0/16"]
  }

  inbound_rule {
    protocol         = "udp"
    port_range       = "1-65535"
    source_addresses = ["10.10.0.0/16"]
  }

  # Outbound rules (allow all outbound traffic)
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Persistent volume for MySQL data
resource "digitalocean_volume" "mysql_data" {
  region                  = var.region
  name                    = "${local.name_prefix}-mysql-data"
  size                    = var.mysql_volume_size
  initial_filesystem_type = "ext4"
  description             = "MySQL data volume for ${var.project_name} ${var.environment}"
  
  tags = concat(local.common_tags, ["mysql", "database"])
}

# Attach MySQL volume to database worker node
resource "digitalocean_volume_attachment" "mysql_data_attachment" {
  droplet_id = digitalocean_droplet.worker_2.id
  volume_id  = digitalocean_volume.mysql_data.id
}

# Reserved IP for load balancer (optional - for production)
resource "digitalocean_reserved_ip" "voting_app_ip" {
  region = var.region

  
  # Note: DigitalOcean doesn't support direct assignment to load balancers
  # This IP can be used for manual DNS configuration
}

# Domain DNS Records (Cloudflare)
resource "cloudflare_record" "voting_app_a" {
  count = var.use_cloudflare ? 1 : 0
  
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain
  value   = digitalocean_loadbalancer.voting_app_lb.ip
  type    = "A"
  ttl     = 300
  proxied = false
  
  comment = "API endpoint for ${var.project_name} ${var.environment}"
}

resource "cloudflare_record" "voting_app_root" {
  count = var.use_cloudflare ? 1 : 0
  
  zone_id = var.cloudflare_zone_id
  name    = "@"
  value   = digitalocean_loadbalancer.voting_app_lb.ip
  type    = "A"
  ttl     = 300
  proxied = false
  
  comment = "Root domain for ${var.project_name} ${var.environment}"
}

# Project resource for organization
resource "digitalocean_project" "voting_app" {
  name        = "${local.name_prefix}-project"
  description = "Feature voting system - ${var.environment} environment"
  purpose     = "Web Application"
  environment = title(var.environment)
  
  resources = [
    digitalocean_droplet.manager.urn,
    digitalocean_droplet.worker_1.urn,
    digitalocean_droplet.worker_2.urn,
    digitalocean_loadbalancer.voting_app_lb.urn,
    digitalocean_volume.mysql_data.urn,
    digitalocean_vpc.voting_app_vpc.urn
  ]
}