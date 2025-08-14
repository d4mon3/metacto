# Microservices Dockerfiles

## Feature Service - feature-service/Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:18-alpine AS production

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --chown=nodeuser:nodejs . .

EXPOSE 3002
USER nodeuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

CMD ["node", "server.js"]
```

## Voting Service - voting-service/Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:18-alpine AS production

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --chown=nodeuser:nodejs . .

EXPOSE 3003
USER nodeuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3003/health || exit 1

CMD ["node", "server.js"]
```

## Reporting Service - reporting-service/Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:18-alpine AS production

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --chown=nodeuser:nodejs . .

EXPOSE 3004
USER nodeuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3004/health || exit 1

CMD ["node", "server.js"]
```