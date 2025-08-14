const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const responseTime = require('response-time');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Service URLs
const SERVICES = {
  USER_SERVICE: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  FEATURE_SERVICE: process.env.FEATURE_SERVICE_URL || 'http://feature-service:3002',
  VOTING_SERVICE: process.env.VOTING_SERVICE_URL || 'http://voting-service:3003',
  REPORTING_SERVICE: process.env.REPORTING_SERVICE_URL || 'http://reporting-service:3004'
};

// Configure Winston logger
const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-gateway' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Middleware setup
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(compression());
app.use(responseTime());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.headers['x-request-id']
  });
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW) || 900000) / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW) || 900000) / 1000)
    });
  }
});

// Speed limiter for additional protection
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per windowMs without delay
  delayMs: 500 // add 500ms delay per request after delayAfter
});

app.use('/api', limiter);
app.use('/api', speedLimiter);

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      logger.warn('Invalid token attempt', { ip: req.ip, error: err.message });
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

// Optional authentication middleware (for endpoints that work with/without auth)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
    });
  }
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Gateway is healthy',
    timestamp: new Date().toISOString(),
    services: Object.keys(SERVICES)
  });
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Feature Voting API Gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// Proxy configuration for microservices
const createServiceProxy = (target, pathRewrite = {}) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite,
    onError: (err, req, res) => {
      logger.error('Proxy error', { 
        target, 
        path: req.path, 
        error: err.message 
      });
      res.status(503).json({
        success: false,
        error: 'Service temporarily unavailable',
        service: target
      });
    },
    onProxyReq: (proxyReq, req) => {
      // Forward user information to services
      if (req.user) {
        proxyReq.setHeader('X-User-ID', req.user.id);
        proxyReq.setHeader('X-User-Role', req.user.role || 'user');
      }
      // Add request ID for tracing
      proxyReq.setHeader('X-Request-ID', req.headers['x-request-id'] || require('uuid').v4());
    },
    timeout: 30000,
    proxyTimeout: 30000
  });
};

// Route-specific middleware and proxying

// Auth routes (public - no authentication required)
app.use('/api/auth', createServiceProxy(SERVICES.USER_SERVICE, {
  '^/api/auth': '/auth'
}));

// User routes (authenticated)
app.use('/api/users', authenticateToken, createServiceProxy(SERVICES.USER_SERVICE, {
  '^/api/users': '/users'
}));

// Feature routes (mixed - some public, some authenticated)
app.use('/api/features', optionalAuth, createServiceProxy(SERVICES.FEATURE_SERVICE, {
  '^/api/features': '/features'
}));

// Voting routes (authenticated)
app.use('/api/votes', authenticateToken, createServiceProxy(SERVICES.VOTING_SERVICE, {
  '^/api/votes': '/votes'
}));

// Reporting routes (public read, authenticated for detailed reports)
app.use('/api/reports', optionalAuth, createServiceProxy(SERVICES.REPORTING_SERVICE, {
  '^/api/reports': '/reports'
}));

// Input validation middleware for critical endpoints
const validateFeatureCreation = [
  body('title').isLength({ min: 3, max: 200 }).trim().escape(),
  body('description').isLength({ min: 10, max: 2000 }).trim(),
  body('category').optional().isAlpha().isLength({ max: 50 }),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
];

const validateVote = [
  body('feature_id').isInt({ min: 1 }),
  body('vote_type').isIn(['upvote', 'downvote'])
];

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Apply validation to specific routes
app.post('/api/features', validateFeatureCreation, handleValidationErrors);
app.post('/api/votes', validateVote, handleValidationErrors);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  res.status(err.status || 500).json({
    success: false,
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn('Route not found', { path: req.path, method: req.method, ip: req.ip });
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`API Gateway running on port ${PORT}`, {
    environment: NODE_ENV,
    services: SERVICES
  });
});

module.exports = app;