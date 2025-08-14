terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
  required_version = ">= 1.0"
  
  # Uncomment for remote state management
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "feature-voting/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  alias     = "enabled"
  api_token = var.cloudflare_api_token
}

provider "cloudflare" {
  alias = "disabled"
}