# Network and Infrastructure Outputs
output "vpc_id" {
  description = "VPC ID for the voting application"
  value       = digitalocean_vpc.voting_app_vpc.id
}

output "vpc_ip_range" {
  description = "VPC IP range"
  value       = digitalocean_vpc.voting_app_vpc.ip_range
}

# Load Balancer Information
output "load_balancer_ip" {
  description = "Public IP address of the load balancer"
  value       = digitalocean_loadbalancer.voting_app_lb.ip
}

output "load_balancer_status" {
  description = "Status of the load balancer"
  value       = digitalocean_loadbalancer.voting_app_lb.status
}

# Droplet Public IP Addresses
output "manager_public_ip" {
  description = "Public IP address of the manager node"
  value       = digitalocean_droplet.manager.ipv4_address
}

output "worker_1_public_ip" {
  description = "Public IP address of worker node 1"
  value       = digitalocean_droplet.worker_1.ipv4_address
}

output "worker_2_public_ip" {
  description = "Public IP address of worker node 2 (database)"
  value       = digitalocean_droplet.worker_2.ipv4_address
}

# Droplet Private IP Addresses (for internal communication)
output "manager_private_ip" {
  description = "Private IP address of the manager node"
  value       = digitalocean_droplet.manager.ipv4_address_private
}

output "worker_1_private_ip" {
  description = "Private IP address of worker node 1"
  value       = digitalocean_droplet.worker_1.ipv4_address_private
}

output "worker_2_private_ip" {
  description = "Private IP address of worker node 2 (database)"
  value       = digitalocean_droplet.worker_2.ipv4_address_private
}

# Storage Information
output "mysql_volume_id" {
  description = "ID of the MySQL data volume"
  value       = digitalocean_volume.mysql_data.id
}

output "mysql_volume_size" {
  description = "Size of the MySQL data volume in GB"
  value       = digitalocean_volume.mysql_data.size
}

# SSH Connection Commands
output "ssh_connection_commands" {
  description = "SSH connection commands for all nodes"
  value = {
    manager  = "ssh root@${digitalocean_droplet.manager.ipv4_address}"
    worker_1 = "ssh root@${digitalocean_droplet.worker_1.ipv4_address}"
    worker_2 = "ssh root@${digitalocean_droplet.worker_2.ipv4_address}"
  }
}

# Application URLs
output "application_urls" {
  description = "URLs to access the application"
  value = {
    load_balancer_http  = "http://${digitalocean_loadbalancer.voting_app_lb.ip}"
    load_balancer_https = "https://${digitalocean_loadbalancer.voting_app_lb.ip}"
    api_endpoint        = var.use_cloudflare ? "https://${var.subdomain}.${var.domain_name}" : "http://${digitalocean_loadbalancer.voting_app_lb.ip}"
    health_check        = "http://${digitalocean_loadbalancer.voting_app_lb.ip}/health"
  }
}

# DNS Information (if using Cloudflare)
output "dns_records" {
  description = "DNS records created (if using Cloudflare)"
  value = var.use_cloudflare ? {
    api_subdomain = "${var.subdomain}.${var.domain_name}"
    root_domain   = var.domain_name
  } : null
}

# Project Information
output "project_info" {
  description = "Project and environment information"
  value = {
    project_name = var.project_name
    environment  = var.environment
    region       = var.region
    project_id   = digitalocean_project.voting_app.id
  }
}

# Docker Swarm Information
output "docker_swarm_info" {
  description = "Docker Swarm cluster information"
  value = {
    manager_node = {
      name       = digitalocean_droplet.manager.name
      public_ip  = digitalocean_droplet.manager.ipv4_address
      private_ip = digitalocean_droplet.manager.ipv4_address_private
      role       = "manager"
    }
    worker_nodes = [
      {
        name       = digitalocean_droplet.worker_1.name
        public_ip  = digitalocean_droplet.worker_1.ipv4_address
        private_ip = digitalocean_droplet.worker_1.ipv4_address_private
        role       = "worker"
        services   = ["feature-service", "voting-service"]
      },
      {
        name       = digitalocean_droplet.worker_2.name
        public_ip  = digitalocean_droplet.worker_2.ipv4_address
        private_ip = digitalocean_droplet.worker_2.ipv4_address_private
        role       = "worker"
        services   = ["mysql", "reporting-service"]
      }
    ]
  }
}

# Firewall Information
output "firewall_info" {
  description = "Firewall configuration details"
  value = {
    firewall_id   = digitalocean_firewall.voting_app_fw.id
    firewall_name = digitalocean_firewall.voting_app_fw.name
    protected_droplets = [
      digitalocean_droplet.manager.name,
      digitalocean_droplet.worker_1.name,
      digitalocean_droplet.worker_2.name
    ]
  }
}

# Quick Setup Commands
output "quick_setup_commands" {
  description = "Commands to quickly setup and verify the infrastructure"
  value = {
    check_swarm_status = "ssh root@${digitalocean_droplet.manager.ipv4_address} 'docker node ls'"
    check_services     = "ssh root@${digitalocean_droplet.manager.ipv4_address} 'docker service ls'"
    view_logs         = "ssh root@${digitalocean_droplet.manager.ipv4_address} 'docker service logs'"
    deploy_stack      = "ssh root@${digitalocean_droplet.manager.ipv4_address} 'docker stack deploy -c docker-compose.yml voting-app'"
    scale_service     = "ssh root@${digitalocean_droplet.manager.ipv4_address} 'docker service scale voting-app_api-gateway=3'"
  }
}

# Cost Estimation (approximate)
output "monthly_cost_estimate" {
  description = "Approximate monthly cost in USD (excluding bandwidth)"
  value = {
    manager_node  = "$24/month (${var.manager_droplet_size})"
    worker_1      = "$24/month (${var.worker_droplet_size})"
    worker_2      = "$48/month (${var.database_droplet_size})"
    load_balancer = "$12/month"
    mysql_volume  = "${var.mysql_volume_size * 0.10}/month (${var.mysql_volume_size}GB)"
    total_estimate = "~$108-120/month"
    note          = "Prices are estimates and may vary. Check DigitalOcean pricing for current rates."
  }
}

# Resource Tags Summary
output "resource_tags" {
  description = "Tags applied to all resources"
  value = concat([var.project_name, var.environment], var.tags)
}