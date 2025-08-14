const express = require('express');
const mysql = require('mysql2/promise');
const { body, query, param, validationResult } = require('express-validator');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const compression = require('compression');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3002;

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3001';
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 300;

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'mysql',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'voting_user',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'feature_voting',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Configure logger
const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'feature-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// In-memory cache for performance
const cache = new Map();
const cacheGet = (key) => {
  const item = cache.get(key);
  if (item && Date.now() < item.expiry) {
    return item.value;
  }
  cache.delete(key);
  return null;
};

const cacheSet = (key, value, ttl = CACHE_TTL) => {
  cache.set(key, {
    value,
    expiry: Date.now() + (ttl * 1000)
  });
};

// Middleware setup
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.headers['x-user-id']
  });
  next();
});

// Extract user info from headers (set by API Gateway)
app.use((req, res, next) => {
  if (req.headers['x-user-id']) {
    req.user = {
      id: parseInt(req.headers['x-user-id']),
      role: req.headers['x-user-role'] || 'user'
    };
  }
  next();
});

// Validation middleware
const validateFeatureCreation = [
  body('title').isLength({ min: 3, max: 200 }).trim().escape(),
  body('description').isLength({ min: 10, max: 2000 }).trim(),
  body('category').optional().isLength({ max: 50 }).trim().escape(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('estimated_effort').optional().isIn(['small', 'medium', 'large', 'extra_large']),
  body('target_version').optional().isLength({ max: 20 }).trim()
];

const validateFeatureUpdate = [
  body('title').optional().isLength({ min: 3, max: 200 }).trim().escape(),
  body('description').optional().isLength({ min: 10, max: 2000 }).trim(),
  body('category').optional().isLength({ max: 50 }).trim().escape(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('estimated_effort').optional().isIn(['small', 'medium', 'large', 'extra_large']),
  body('target_version').optional().isLength({ max: 20 }).trim(),
  body('implementation_notes').optional().isLength({ max: 1000 }).trim(),
  body('rejection_reason').optional().isLength({ max: 500 }).trim()
];

const validateStatusUpdate = [
  body('status').isIn(['pending', 'approved', 'rejected', 'implemented', 'archived']),
  body('implementation_notes').optional().isLength({ max: 1000 }).trim(),
  body('rejection_reason').optional().isLength({ max: 500 }).trim()
];

const validateQuery = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'implemented', 'archived']),
  query('category').optional().isLength({ max: 50 }),
  query('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('user_id').optional().isInt({ min: 1 }),
  query('search').optional().isLength({ max: 100 }).trim(),
  query('sort').optional().isIn(['created_at', 'updated_at', 'votes_count', 'title']),
  query('order').optional().isIn(['asc', 'desc'])
];

// Error handling middleware
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

// Authorization middleware
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  next();
};

const requireOwnershipOrAdmin = async (req, res, next) => {
  try {
    const featureId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
      return next();
    }

    const [features] = await pool.execute(
      'SELECT user_id FROM features WHERE id = ?',
      [featureId]
    );

    if (features.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    if (features[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    next();
  } catch (error) {
    logger.error('Authorization error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Feature service is healthy',
    timestamp: new Date().toISOString()
  });
});

// Get all features with filtering, pagination, and search
app.get('/features', validateQuery, handleValidationErrors, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      category,
      priority,
      user_id,
      search,
      sort = 'created_at',
      order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;
    const cacheKey = `features:${JSON.stringify(req.query)}`;
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Build query conditions
    let whereConditions = [];
    let queryParams = [];

    if (status) {
      whereConditions.push('f.status = ?');
      queryParams.push(status);
    }

    if (category) {
      whereConditions.push('f.category = ?');
      queryParams.push(category);
    }

    if (priority) {
      whereConditions.push('f.priority = ?');
      queryParams.push(priority);
    }

    if (user_id) {
      whereConditions.push('f.user_id = ?');
      queryParams.push(parseInt(user_id));
    }

    if (search) {
      whereConditions.push('(MATCH(f.title, f.description) AGAINST(? IN BOOLEAN MODE) OR f.title LIKE ? OR f.description LIKE ?)');
      queryParams.push(`+${search}*`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const orderClause = `ORDER BY f.${sort} ${order.toUpperCase()}`;

    // Get features with user information
    const [features] = await pool.execute(
      `SELECT f.*, 
              u.username, u.first_name, u.last_name,
              COALESCE(vc.comments_count, 0) as comments_count
       FROM features f
       JOIN users u ON f.user_id = u.id
       LEFT JOIN (
         SELECT feature_id, COUNT(*) as comments_count 
         FROM comments 
         GROUP BY feature_id
       ) vc ON f.id = vc.feature_id
       ${whereClause}
       ${orderClause}
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM features f ${whereClause}`,
      queryParams
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    const response = {
      success: true,
      data: {
        features,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get features error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get feature by ID
app.get('/features/:id', [
  param('id').isInt({ min: 1 })
], handleValidationErrors, async (req, res) => {
  try {
    const featureId = parseInt(req.params.id);
    const cacheKey = `feature:${featureId}`;
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [features] = await pool.execute(
      `SELECT f.*, 
              u.username, u.first_name, u.last_name, u.avatar_url,
              COALESCE(vc.comments_count, 0) as comments_count
       FROM features f
       JOIN users u ON f.user_id = u.id
       LEFT JOIN (
         SELECT feature_id, COUNT(*) as comments_count 
         FROM comments 
         GROUP BY feature_id
       ) vc ON f.id = vc.feature_id
       WHERE f.id = ?`,
      [featureId]
    );

    if (features.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    const feature = features[0];

    // Get recent comments
    const [comments] = await pool.execute(
      `SELECT c.*, u.username, u.first_name, u.last_name, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.feature_id = ?
       ORDER BY c.created_at DESC
       LIMIT 10`,
      [featureId]
    );

    const response = {
      success: true,
      data: {
        feature,
        comments
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get feature error', { error: error.message, featureId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Create new feature
app.post('/features', requireAuth, validateFeatureCreation, handleValidationErrors, async (req, res) => {
  try {
    const {
      title,
      description,
      category = 'general',
      priority = 'medium',
      estimated_effort,
      target_version
    } = req.body;

    const userId = req.user.id;

    const [result] = await pool.execute(
      `INSERT INTO features (title, description, user_id, category, priority, estimated_effort, target_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, description, userId, category, priority, estimated_effort || null, target_version || null]
    );

    const featureId = result.insertId;

    // Get created feature with user info
    const [features] = await pool.execute(
      `SELECT f.*, u.username, u.first_name, u.last_name
       FROM features f
       JOIN users u ON f.user_id = u.id
       WHERE f.id = ?`,
      [featureId]
    );

    // Clear relevant caches
    cache.clear();

    logger.info('Feature created', { featureId, userId, title });

    res.status(201).json({
      success: true,
      message: 'Feature created successfully',
      data: { feature: features[0] }
    });

  } catch (error) {
    logger.error('Create feature error', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update feature
app.put('/features/:id', requireAuth, requireOwnershipOrAdmin, [
  param('id').isInt({ min: 1 }),
  ...validateFeatureUpdate
], handleValidationErrors, async (req, res) => {
  try {
    const featureId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role;

    const {
      title,
      description,
      category,
      priority,
      estimated_effort,
      target_version,
      implementation_notes,
      rejection_reason
    } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (category !== undefined) {
      updates.push('category = ?');
      values.push(category);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      values.push(priority);
    }
    if (estimated_effort !== undefined) {
      updates.push('estimated_effort = ?');
      values.push(estimated_effort);
    }
    if (target_version !== undefined) {
      updates.push('target_version = ?');
      values.push(target_version);
    }

    // Only admins can update these fields
    if (userRole === 'admin') {
      if (implementation_notes !== undefined) {
        updates.push('implementation_notes = ?');
        values.push(implementation_notes);
      }
      if (rejection_reason !== undefined) {
        updates.push('rejection_reason = ?');
        values.push(rejection_reason);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    updates.push('updated_at = NOW()');
    values.push(featureId);

    await pool.execute(
      `UPDATE features SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Get updated feature
    const [features] = await pool.execute(
      `SELECT f.*, u.username, u.first_name, u.last_name
       FROM features f
       JOIN users u ON f.user_id = u.id
       WHERE f.id = ?`,
      [featureId]
    );

    // Clear caches
    cache.clear();

    logger.info('Feature updated', { featureId, userId });

    res.json({
      success: true,
      message: 'Feature updated successfully',
      data: { feature: features[0] }
    });

  } catch (error) {
    logger.error('Update feature error', { error: error.message, featureId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update feature status (admin only)
app.patch('/features/:id/status', requireAuth, [
  param('id').isInt({ min: 1 }),
  ...validateStatusUpdate
], handleValidationErrors, async (req, res) => {
  try {
    const featureId = parseInt(req.params.id);
    const { status, implementation_notes, rejection_reason } = req.body;
    const userRole = req.user.role;

    // Only admins can change status
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Check if feature exists
    const [existingFeatures] = await pool.execute(
      'SELECT id, status FROM features WHERE id = ?',
      [featureId]
    );

    if (existingFeatures.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    // Update status
    const updates = ['status = ?', 'updated_at = NOW()'];
    const values = [status];

    if (implementation_notes) {
      updates.push('implementation_notes = ?');
      values.push(implementation_notes);
    }

    if (rejection_reason) {
      updates.push('rejection_reason = ?');
      values.push(rejection_reason);
    }

    // Set timestamp based on status
    if (status === 'approved') {
      updates.push('approved_at = NOW()');
    } else if (status === 'implemented') {
      updates.push('implemented_at = NOW()');
    }

    values.push(featureId);

    await pool.execute(
      `UPDATE features SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Get updated feature
    const [features] = await pool.execute(
      `SELECT f.*, u.username, u.first_name, u.last_name
       FROM features f
       JOIN users u ON f.user_id = u.id
       WHERE f.id = ?`,
      [featureId]
    );

    // Clear caches
    cache.clear();

    logger.info('Feature status updated', { featureId, status, adminId: req.user.id });

    res.json({
      success: true,
      message: 'Feature status updated successfully',
      data: { feature: features[0] }
    });

  } catch (error) {
    logger.error('Update feature status error', { error: error.message, featureId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Delete feature
app.delete('/features/:id', requireAuth, requireOwnershipOrAdmin, [
  param('id').isInt({ min: 1 })
], handleValidationErrors, async (req, res) => {
  try {
    const featureId = parseInt(req.params.id);
    const userId = req.user.id;

    // Check if feature exists
    const [features] = await pool.execute(
      'SELECT id, title FROM features WHERE id = ?',
      [featureId]
    );

    if (features.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    // Delete feature (CASCADE will handle related records)
    await pool.execute('DELETE FROM features WHERE id = ?', [featureId]);

    // Clear caches
    cache.clear();

    logger.info('Feature deleted', { featureId, userId, title: features[0].title });

    res.json({
      success: true,
      message: 'Feature deleted successfully'
    });

  } catch (error) {
    logger.error('Delete feature error', { error: error.message, featureId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get feature categories
app.get('/features/meta/categories', async (req, res) => {
  try {
    const cacheKey = 'categories';
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [categories] = await pool.execute(
      `SELECT category, COUNT(*) as count
       FROM features
       WHERE category IS NOT NULL
       GROUP BY category
       ORDER BY count DESC, category ASC`
    );

    const response = {
      success: true,
      data: { categories }
    };

    cacheSet(cacheKey, response, 600); // Cache for 10 minutes

    res.json(response);

  } catch (error) {
    logger.error('Get categories error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get feature statistics
app.get('/features/meta/stats', async (req, res) => {
  try {
    const cacheKey = 'feature_stats';
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_features,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'implemented' THEN 1 END) as implemented,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN priority = 'high' OR priority = 'critical' THEN 1 END) as high_priority,
        AVG(votes_count) as avg_votes,
        MAX(votes_count) as max_votes
      FROM features
    `);

    const response = {
      success: true,
      data: { stats: stats[0] }
    };

    cacheSet(cacheKey, response, 300); // Cache for 5 minutes

    res.json(response);

  } catch (error) {
    logger.error('Get stats error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Search features
app.get('/features/search', [
  query('q').isLength({ min: 2, max: 100 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 50 })
], handleValidationErrors, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    const cacheKey = `search:${q}:${limit}`;
    
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [features] = await pool.execute(
      `SELECT f.id, f.title, f.description, f.status, f.votes_count, f.category,
              u.username, u.first_name, u.last_name,
              MATCH(f.title, f.description) AGAINST(? IN BOOLEAN MODE) as relevance
       FROM features f
       JOIN users u ON f.user_id = u.id
       WHERE MATCH(f.title, f.description) AGAINST(? IN BOOLEAN MODE)
          OR f.title LIKE ? 
          OR f.description LIKE ?
       ORDER BY relevance DESC, f.votes_count DESC
       LIMIT ?`,
      [`+${q}*`, `+${q}*`, `%${q}%`, `%${q}%`, parseInt(limit)]
    );

    const response = {
      success: true,
      data: { features, query: q }
    };

    cacheSet(cacheKey, response, 180); // Cache for 3 minutes

    res.json(response);

  } catch (error) {
    logger.error('Search features error', { error: error.message, query: req.query.q });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(err.status || 500).json({
    success: false,
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing database connections...');
  await pool.end();
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Feature service running on port ${PORT}`, {
    environment: NODE_ENV,
    dbHost: dbConfig.host
  });
});

module.exports = app;