# Phase 2: Application Infrastructure Setup

This phase sets up the Docker Compose stack with all microservices and database components.

## Architecture Overview

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    │     (Nginx)     │
                    └─────────┬───────┘
                              │
                    ┌─────────▼───────┐
                    │  API Gateway    │
                    │    (Port 3000)  │
                    └─────────┬───────┘
                              │
        ┌─────────┬───────────┼───────────┬─────────┐
        │         │           │           │         │
   ┌────▼───┐ ┌──▼─────┐ ┌───▼────┐ ┌───▼─────┐   │
   │ User   │ │Feature │ │Voting  │ │Reporting│   │
   │Service │ │Service │ │Service │ │ Service │   │
   │:3001   │ │:3002   │ │:3003   │ │  :3004  │   │
   └────┬───┘ └──┬─────┘ └───┬────┘ └───┬─────┘   │
        │        │           │          │         │
        └────────┼───────────┼──────────┼─────────┘
                 │           │          │
            ┌────▼───────────▼──────────▼─────┐
            │         MySQL Database         │
            │           (Port 3306)          │
            └────────────────────────────────┘
```

## Components Deployed

### 1. **Database Layer**
- **MySQL 8.0** with custom configuration
- **Persistent volume** for data storage
- **Initialization scripts** for schema and sample data
- **Health checks** and monitoring

### 2. **Microservices**
- **API Gateway** (Port 3000) - Routing, authentication, rate limiting
- **User Service** (Port 3001) - Authentication, user management
- **Feature Service** (Port 3002) - Feature CRUD operations
- **Voting Service** (Port 3003) - Vote management
- **Reporting Service** (Port 3004) - Analytics and reports

### 3. **Supporting Services**
- **Redis** - Caching and session management
- **Docker Networks** - Secure service communication
- **Docker Secrets** - Secure credential management

## Files Created

### Core Configuration
- `docker-compose.yml` - Complete stack definition
- `.env.example` - Environment variables template
- `deploy-stack.sh` - Automated deployment script

### Database Setup
- `database/init/01-schema.sql` - Database schema
- `database/init/02-triggers.sql` - Database triggers
- `database/init/03-sample-data.sql` - Sample data
- `database/config/my.cnf` - MySQL configuration

### API Gateway
- `api-gateway/Dockerfile` - Container definition
- `api-gateway/package.json` - Dependencies
- `api-gateway/server.js` - Complete gateway implementation

### User Service (Started)
- `user-service/Dockerfile` - Container definition
- `user-service/package.json` - Dependencies

## Deployment Instructions

### 1. Prerequisites
- Phase 1 infrastructure deployed and running
- SSH access to manager node
- Domain name configured (optional)

### 2. Deploy the Stack

```bash
# SSH to manager node
ssh root@<manager-ip>

# Clone/upload the application code
# (In real scenario, would be from Git repository)

# Copy environment template and configure
cp .env.example .env
# Edit .env with your actual values

# Make deployment script executable
chmod +x deploy-stack.sh

# Deploy the complete stack
./deploy-stack.sh deploy
```

### 3. Verify Deployment

```bash
# Check stack status
./deploy-stack.sh status

# View service logs
./deploy-stack.sh logs api-gateway

# Test API endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/status
```

## Service Details

### API Gateway Features
- **JWT Authentication** - Token validation and forwarding
- **Rate Limiting** - 100 requests per 15 minutes
- **Request Validation** - Input sanitization
- **Service Proxy** - Intelligent routing to microservices
- **Error Handling** - Centralized error management
- **Logging** - Comprehensive request/response logging
- **Health Checks** - Service availability monitoring

### Database Features
- **Automated Schema** - Tables, indexes, and relationships
- **Database Triggers** - Vote counting, activity logging
- **Sample Data** - 8 users, 15 features, sample votes
- **Data Integrity** - Foreign keys, constraints
- **Performance** - Optimized indexes and queries

### Security Features
- **Docker Secrets** - Secure credential storage
- **Network Isolation** - Encrypted overlay networks
- **Input Validation** - SQL injection prevention
- **Rate Limiting** - DDoS protection
- **Authentication** - JWT-based security

## Configuration Options

### Environment Variables
```bash
# Core settings
PROJECT_NAME=feature-voting
ENVIRONMENT=dev
NODE_ENV=development

# Database
MYSQL_ROOT_PASSWORD=<secure-password>
MYSQL_DATABASE=feature_voting
MYSQL_USER=voting_user
MYSQL_PASSWORD=<secure-password>

# Security
JWT_SECRET=<256-bit-secret>
JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=12

# Performance
RATE_LIMIT_MAX=100
CACHE_TTL=300
```

### Service Scaling
```bash
# Scale API Gateway for high load
./deploy-stack.sh scale api-gateway 3

# Scale Feature Service
./deploy-stack.sh scale feature-service 2

# Scale Voting Service for heavy voting
./deploy-stack.sh scale voting-service 3
```

## Monitoring & Maintenance

### Health Checks
- All services have built-in health check endpoints
- Docker health checks with automatic restart
- Service dependency management

### Logging
- Centralized logging with Winston
- Request/response logging
- Error tracking and alerting
- Performance metrics

### Backup Strategy
- Automated MySQL backups (configured in Phase 1)
- Volume snapshots
- Configuration backup

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `GET /api/users/:id` - Get user by ID

### Features
- `GET /api/features` - List features (paginated)
- `POST /api/features` - Create feature
- `GET /api/features/:id` - Get feature details
- `PUT /api/features/:id` - Update feature
- `DELETE /api/features/:id` - Delete feature

### Voting
- `POST /api/votes` - Cast vote
- `DELETE /api/votes/:id` - Remove vote
- `GET /api/votes/user/:userId` - User's votes
- `GET /api/votes/feature/:featureId` - Feature votes

### Reports
- `GET /api/reports/features/votes/all` - All features with votes
- `GET /api/reports/features/status` - Features by status
- `GET /api/reports/features/trends` - Voting trends

## Next Steps

After Phase 2 completion:

1. **Complete Microservices** - Implement remaining service logic
2. **Android Development** - Build native Android application
3. **Integration Testing** - End-to-end testing
4. **Performance Optimization** - Load testing and tuning

## Troubleshooting

### Common Issues

**Services not starting:**
```bash
# Check service logs
docker service logs voting-app_<service-name>

# Check node resources
docker node ls
```

**Database connection issues:**
```bash
# Check MySQL logs
docker service logs voting-app_mysql

# Verify network connectivity
docker exec -it <container> ping mysql
```

**Authentication problems:**
```bash
# Check JWT secret configuration
echo $JWT_SECRET

# Verify user service logs
docker service logs voting-app_user-service
```

This completes Phase 2 with a fully functional microservices architecture ready for application development!