variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for DNS records"
  type        = string
  default     = ""
}

variable "use_cloudflare" {
  description = "Whether to use Cloudflare for DNS management"
  type        = bool
  default     = false
}

variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "feature-voting"
  
  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "Project name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "dev"
  
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc3"
  
  validation {
    condition = contains([
      "nyc1", "nyc3", "ams3", "sfo3", "sgp1", "lon1", 
      "fra1", "tor1", "blr1", "syd1"
    ], var.region)
    error_message = "Must be a valid DigitalOcean region."
  }
}

variable "manager_droplet_size" {
  description = "Droplet size for manager node"
  type        = string
  default     = "s-2vcpu-2gb"
}

variable "worker_droplet_size" {
  description = "Droplet size for worker nodes"
  type        = string
  default     = "s-2vcpu-2gb"
}

variable "database_droplet_size" {
  description = "Droplet size for database node (worker-2)"
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "voting-app.example.com"
}

variable "subdomain" {
  description = "Subdomain for API endpoints"
  type        = string
  default     = "api"
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "mysql_volume_size" {
  description = "Size of MySQL data volume in GB"
  type        = number
  default     = 10
  
  validation {
    condition     = var.mysql_volume_size >= 1 && var.mysql_volume_size <= 100
    error_message = "MySQL volume size must be between 1 and 100 GB."
  }
}

variable "enable_monitoring" {
  description = "Enable DigitalOcean monitoring"
  type        = bool
  default     = true
}

variable "enable_backups" {
  description = "Enable automated backups for droplets"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to resources"
  type        = list(string)
  default     = []
}