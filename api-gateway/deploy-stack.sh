#!/bin/bash
set -euo pipefail

# Feature Voting System - Docker Stack Deployment Script
# Phase 2: Deploy the application stack to Docker Swarm

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
STACK_NAME="voting-app"
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if running on manager node
check_swarm_manager() {
    log "Checking Docker Swarm status..."
    
    if ! docker info | grep -q "Swarm: active"; then
        error "Docker Swarm is not active. Please run this script on a swarm manager node."
        exit 1
    fi
    
    if ! docker node ls >/dev/null 2>&1; then
        error "This node is not a swarm manager. Please run this script on a manager node."
        exit 1
    fi
    
    success "Docker Swarm is active and this is a manager node"
}

# Check required files
check_files() {
    log "Checking required files..."
    
    local missing_files=()
    
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        missing_files+=("$COMPOSE_FILE")
    fi
    
    if [[ ! -f "$ENV_FILE" ]]; then
        missing_files+=("$ENV_FILE")
    fi
    
    if [[ ! -d "database/init" ]]; then
        missing_files+=("database/init directory")
    fi
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        error "Missing required files/directories:"
        printf '%s\n' "${missing_files[@]}"
        exit 1
    fi
    
    success "All required files are present"
}

# Create Docker secrets
create_secrets() {
    log "Creating Docker secrets..."
    
    # Source environment file
    if [[ -f "$ENV_FILE" ]]; then
        set -o allexport
        source "$ENV_FILE"
        set +o allexport
    fi
    
    # Create MySQL root password secret
    if ! docker secret ls | grep -q "mysql_root_password"; then
        echo "$MYSQL_ROOT_PASSWORD" | docker secret create mysql_root_password -
        log "Created mysql_root_password secret"
    else
        log "mysql_root_password secret already exists"
    fi
    
    # Create JWT secret
    if ! docker secret ls | grep -q "jwt_secret"; then
        echo "$JWT_SECRET" | docker secret create jwt_secret -
        log "Created jwt_secret secret"
    else
        log "jwt_secret secret already exists"
    fi
    
    success "Docker secrets created/verified"
}

# Label worker nodes for service placement
label_nodes() {
    log "Labeling nodes for service placement..."
    
    # Get node information
    local nodes=($(docker node ls --format "{{.Hostname}}" --filter "role=worker"))
    
    if [[ ${#nodes[@]} -lt 2 ]]; then
        warning "Expected at least 2 worker nodes, found ${#nodes[@]}"
    fi
    
    # Label worker-1 for services
    if [[ ${#nodes[@]} -gt 0 ]]; then
        local worker1="${nodes[0]}"
        docker node update --label-add services=true --label-add node-type=worker-1 "$worker1"
        log "Labeled $worker1 as worker-1 for services"
    fi
    
    # Label worker-2 for database
    if [[ ${#nodes[@]} -gt 1 ]]; then
        local worker2="${nodes[1]}"
        docker node update --label-add database=true --label-add node-type=worker-2 "$worker2"
        log "Labeled $worker2 as worker-2 for database"
    fi
    
    success "Node labeling completed"
}

# Build service images
build_images() {
    log "Building service images..."
    
    local services=("api-gateway" "user-service" "feature-service" "voting-service" "reporting-service")
    
    for service in "${services[@]}"; do
        if [[ -d "$service" ]]; then
            log "Building $service image..."
            docker build -t "feature-voting-$service:latest" "$service/"
        else
            warning "Directory $service not found, skipping build"
        fi
    done
    
    success "Service images built"
}

# Deploy the stack
deploy_stack() {
    log "Deploying Docker stack..."
    
    # Deploy the stack
    if docker stack deploy -c "$COMPOSE_FILE" "$STACK_NAME"; then
        success "Stack deployment initiated"
    else
        error "Stack deployment failed"
        exit 1
    fi
    
    log "Waiting for services to start..."
    sleep 30
    
    # Check service status
    docker stack ps "$STACK_NAME"
}

# Wait for services to be healthy
wait_for_services() {
    log "Waiting for services to become healthy..."
    
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        local running_services=$(docker service ls --filter "label=com.docker.stack.namespace=$STACK_NAME" --format "{{.Replicas}}" | grep -c "1/1" || true)
        local total_services=$(docker service ls --filter "label=com.docker.stack.namespace=$STACK_NAME" --format "{{.Name}}" | wc -l)
        
        log "Services healthy: $running_services/$total_services"
        
        if [[ $running_services -eq $total_services ]] && [[ $total_services -gt 0 ]]; then
            success "All services are running and healthy"
            return 0
        fi
        
        sleep 10
        attempt=$((attempt + 1))
    done
    
    warning "Not all services became healthy within timeout"
    docker service ls --filter "label=com.docker.stack.namespace=$STACK_NAME"
}

# Verify database initialization
verify_database() {
    log "Verifying database initialization..."
    
    local mysql_service="${STACK_NAME}_mysql"
    local mysql_container=$(docker ps -q -f "label=com.docker.swarm.service.name=$mysql_service")
    
    if [[ -z "$mysql_container" ]]; then
        warning "MySQL container not found, skipping database verification"
        return
    fi
    
    # Wait for MySQL to be ready
    local attempt=0
    while [ $attempt -lt 20 ]; do
        if docker exec "$mysql_container" mysqladmin ping -h localhost -u root -p"$MYSQL_ROOT_PASSWORD" >/dev/null 2>&1; then
            success "MySQL is responding to connections"
            break
        fi
        sleep 5
        attempt=$((attempt + 1))
    done
    
    # Check if tables exist
    if docker exec "$mysql_container" mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES;" >/dev/null 2>&1; then
        local table_count=$(docker exec "$mysql_container" mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES;" | wc -l)
        log "Database initialized with $((table_count - 1)) tables"
    else
        warning "Could not verify database table creation"
    fi
}

# Test API endpoints
test_endpoints() {
    log "Testing API endpoints..."
    
    local api_url="http://localhost:3000"
    local attempt=0
    local max_attempts=10
    
    # Wait for API Gateway to be ready
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "$api_url/health" >/dev/null 2>&1; then
            success "API Gateway is responding"
            break
        fi
        sleep 5
        attempt=$((attempt + 1))
    done
    
    # Test health endpoint
    log "Testing health endpoint..."
    if response=$(curl -s "$api_url/health"); then
        echo "Health check response: $response"
    else
        warning "Health endpoint not responding"
    fi
    
    # Test status endpoint
    log "Testing status endpoint..."
    if response=$(curl -s "$api_url/api/status"); then
        echo "Status response: $response"
    else
        warning "Status endpoint not responding"
    fi
}

# Display deployment summary
show_summary() {
    log "Deployment Summary"
    echo "===================="
    
    echo "Stack Name: $STACK_NAME"
    echo "Compose File: $COMPOSE_FILE"
    echo ""
    
    echo "Services:"
    docker service ls --filter "label=com.docker.stack.namespace=$STACK_NAME"
    echo ""
    
    echo "Networks:"
    docker network ls --filter "label=com.docker.stack.namespace=$STACK_NAME"
    echo ""
    
    echo "Volumes:"
    docker volume ls --filter "label=com.docker.stack.namespace=$STACK_NAME"
    echo ""
    
    echo "API Endpoints:"
    echo "- Health Check: http://localhost:3000/health"
    echo "- API Status: http://localhost:3000/api/status"
    echo "- Authentication: http://localhost:3000/api/auth/*"
    echo "- Features: http://localhost:3000/api/features/*"
    echo "- Voting: http://localhost:3000/api/votes/*"
    echo "- Reports: http://localhost:3000/api/reports/*"
    echo ""
    
    echo "Useful Commands:"
    echo "- View service logs: docker service logs ${STACK_NAME}_<service-name>"
    echo "- Scale service: docker service scale ${STACK_NAME}_<service-name>=<replicas>"
    echo "- Update service: docker service update ${STACK_NAME}_<service-name>"
    echo "- Remove stack: docker stack rm $STACK_NAME"
    echo ""
    
    success "Feature Voting System deployed successfully!"
}

# Cleanup function
cleanup_failed_deployment() {
    warning "Cleaning up failed deployment..."
    docker stack rm "$STACK_NAME" 2>/dev/null || true
    sleep 10
}

# Main deployment function
main() {
    echo "================================================================"
    echo "     Feature Voting System - Docker Stack Deployment          "
    echo "================================================================"
    echo ""
    
    # Set up error handling
    trap cleanup_failed_deployment ERR
    
    # Run deployment steps
    check_swarm_manager
    check_files
    create_secrets
    label_nodes
    build_images
    deploy_stack
    wait_for_services
    verify_database
    test_endpoints
    
    # Show summary
    echo ""
    show_summary
}

# Script options
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "remove"|"rm")
        log "Removing Docker stack..."
        docker stack rm "$STACK_NAME"
        log "Waiting for cleanup to complete..."
        sleep 10
        docker system prune -f
        success "Stack removed successfully"
        ;;
    "status")
        if docker stack ls | grep -q "$STACK_NAME"; then
            echo "Stack Status:"
            docker stack ps "$STACK_NAME"
            echo ""
            echo "Service Status:"
            docker service ls --filter "label=com.docker.stack.namespace=$STACK_NAME"
        else
            warning "Stack '$STACK_NAME' not found"
        fi
        ;;
    "logs")
        if [[ -n "${2:-}" ]]; then
            docker service logs "${STACK_NAME}_$2"
        else
            echo "Available services:"
            docker service ls --filter "label=com.docker.stack.namespace=$STACK_NAME" --format "{{.Name}}"
            echo ""
            echo "Usage: $0 logs <service-name>"
        fi
        ;;
    "scale")
        if [[ -n "${2:-}" ]] && [[ -n "${3:-}" ]]; then
            docker service scale "${STACK_NAME}_$2=$3"
        else
            echo "Usage: $0 scale <service-name> <replicas>"
        fi
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  deploy   Deploy the Docker stack (default)"
        echo "  remove   Remove the Docker stack"
        echo "  status   Show stack and service status"
        echo "  logs     Show logs for a specific service"
        echo "  scale    Scale a service to specified replicas"
        echo "  help     Show this help message"
        ;;
    *)
        error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac