const express = require('express');
const mysql = require('mysql2/promise');
const { body, query, param, validationResult } = require('express-validator');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3003;

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const VOTE_RATE_LIMIT = parseInt(process.env.VOTE_RATE_LIMIT) || 10;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3001';
const FEATURE_SERVICE_URL = process.env.FEATURE_SERVICE_URL || 'http://feature-service:3002';

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
  defaultMeta: { service: 'voting-service' },
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

// Rate limiting for voting endpoints
const votingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: VOTE_RATE_LIMIT,
  message: {
    success: false,
    error: 'Too many votes. Please slow down.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-user-id'] || req.ip
});

// Validation middleware
const validateVote = [
  body('feature_id').isInt({ min: 1 }),
  body('vote_type').isIn(['upvote', 'downvote'])
];

const validateVoteUpdate = [
  body('vote_type').isIn(['upvote', 'downvote'])
];

const validateQuery = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('user_id').optional().isInt({ min: 1 }),
  query('feature_id').optional().isInt({ min: 1 }),
  query('vote_type').optional().isIn(['upvote', 'downvote'])
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Voting service is healthy',
    timestamp: new Date().toISOString()
  });
});

// Cast a vote
app.post('/votes', requireAuth, votingLimiter, validateVote, handleValidationErrors, async (req, res) => {
  try {
    const { feature_id, vote_type } = req.body;
    const userId = req.user.id;

    // Check if feature exists
    const [features] = await pool.execute(
      'SELECT id, user_id, status FROM features WHERE id = ?',
      [feature_id]
    );

    if (features.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    const feature = features[0];

    // Prevent voting on own features
    if (feature.user_id === userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot vote on your own feature'
      });
    }

    // Check if voting is allowed based on feature status
    if (feature.status === 'archived') {
      return res.status(400).json({
        success: false,
        error: 'Cannot vote on archived features'
      });
    }

    // Check if user has already voted on this feature
    const [existingVotes] = await pool.execute(
      'SELECT id, vote_type FROM votes WHERE user_id = ? AND feature_id = ?',
      [userId, feature_id]
    );

    let voteId;
    let action;

    if (existingVotes.length > 0) {
      // User has already voted, update the vote
      const existingVote = existingVotes[0];
      
      if (existingVote.vote_type === vote_type) {
        // Same vote type, remove the vote
        await pool.execute('DELETE FROM votes WHERE id = ?', [existingVote.id]);
        action = 'removed';
        voteId = null;
      } else {
        // Different vote type, update the vote
        await pool.execute(
          'UPDATE votes SET vote_type = ?, updated_at = NOW() WHERE id = ?',
          [vote_type, existingVote.id]
        );
        action = 'updated';
        voteId = existingVote.id;
      }
    } else {
      // New vote
      const [result] = await pool.execute(
        'INSERT INTO votes (user_id, feature_id, vote_type) VALUES (?, ?, ?)',
        [userId, feature_id, vote_type]
      );
      voteId = result.insertId;
      action = 'created';
    }

    // Get updated vote counts for the feature
    const [voteCounts] = await pool.execute(
      `SELECT 
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) - COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as total_votes
       FROM votes WHERE feature_id = ?`,
      [feature_id]
    );

    const counts = voteCounts[0];

    logger.info('Vote processed', {
      userId,
      featureId: feature_id,
      voteType: vote_type,
      action,
      voteId
    });

    res.json({
      success: true,
      message: `Vote ${action} successfully`,
      data: {
        vote_id: voteId,
        action,
        vote_type: action === 'removed' ? null : vote_type,
        feature_id,
        vote_counts: {
          upvotes: counts.upvotes,
          downvotes: counts.downvotes,
          total: counts.total_votes
        }
      }
    });

  } catch (error) {
    if (error.code === 'ER_SIGNAL_EXCEPTION') {
      // Handle custom database errors (from triggers)
      return res.status(400).json({
        success: false,
        error: error.sqlMessage || 'Vote operation failed'
      });
    }

    logger.error('Vote creation error', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update an existing vote
app.put('/votes/:id', requireAuth, validateVoteUpdate, handleValidationErrors, async (req, res) => {
  try {
    const voteId = parseInt(req.params.id);
    const { vote_type } = req.body;
    const userId = req.user.id;

    // Check if vote exists and belongs to user
    const [votes] = await pool.execute(
      'SELECT id, user_id, feature_id, vote_type FROM votes WHERE id = ? AND user_id = ?',
      [voteId, userId]
    );

    if (votes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vote not found or access denied'
      });
    }

    const vote = votes[0];

    if (vote.vote_type === vote_type) {
      return res.status(400).json({
        success: false,
        error: 'Vote type is already set to this value'
      });
    }

    // Update vote
    await pool.execute(
      'UPDATE votes SET vote_type = ?, updated_at = NOW() WHERE id = ?',
      [vote_type, voteId]
    );

    // Get updated vote
    const [updatedVotes] = await pool.execute(
      `SELECT v.*, f.title as feature_title
       FROM votes v
       JOIN features f ON v.feature_id = f.id
       WHERE v.id = ?`,
      [voteId]
    );

    logger.info('Vote updated', { voteId, userId, newVoteType: vote_type });

    res.json({
      success: true,
      message: 'Vote updated successfully',
      data: { vote: updatedVotes[0] }
    });

  } catch (error) {
    logger.error('Vote update error', { error: error.message, voteId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Delete a vote
app.delete('/votes/:id', requireAuth, [
  param('id').isInt({ min: 1 })
], handleValidationErrors, async (req, res) => {
  try {
    const voteId = parseInt(req.params.id);
    const userId = req.user.id;

    // Check if vote exists and belongs to user
    const [votes] = await pool.execute(
      'SELECT id, user_id, feature_id FROM votes WHERE id = ? AND user_id = ?',
      [voteId, userId]
    );

    if (votes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vote not found or access denied'
      });
    }

    const vote = votes[0];

    // Delete vote
    await pool.execute('DELETE FROM votes WHERE id = ?', [voteId]);

    logger.info('Vote deleted', { voteId, userId, featureId: vote.feature_id });

    res.json({
      success: true,
      message: 'Vote deleted successfully'
    });

  } catch (error) {
    logger.error('Vote deletion error', { error: error.message, voteId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get votes with filtering and pagination
app.get('/votes', validateQuery, handleValidationErrors, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      user_id,
      feature_id,
      vote_type
    } = req.query;

    const offset = (page - 1) * limit;

    // Build query conditions
    let whereConditions = [];
    let queryParams = [];

    if (user_id) {
      whereConditions.push('v.user_id = ?');
      queryParams.push(parseInt(user_id));
    }

    if (feature_id) {
      whereConditions.push('v.feature_id = ?');
      queryParams.push(parseInt(feature_id));
    }

    if (vote_type) {
      whereConditions.push('v.vote_type = ?');
      queryParams.push(vote_type);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get votes with user and feature information
    const [votes] = await pool.execute(
      `SELECT v.*, 
              u.username, u.first_name, u.last_name,
              f.title as feature_title, f.status as feature_status
       FROM votes v
       JOIN users u ON v.user_id = u.id
       JOIN features f ON v.feature_id = f.id
       ${whereClause}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM votes v ${whereClause}`,
      queryParams
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        votes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get votes error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get votes for a specific user
app.get('/votes/user/:userId', [
  param('userId').isInt({ min: 1 }),
  ...validateQuery
], handleValidationErrors, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const {
      page = 1,
      limit = 20,
      vote_type
    } = req.query;

    const offset = (page - 1) * limit;

    // Build query conditions
    let whereConditions = ['v.user_id = ?'];
    let queryParams = [userId];

    if (vote_type) {
      whereConditions.push('v.vote_type = ?');
      queryParams.push(vote_type);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Get user's votes
    const [votes] = await pool.execute(
      `SELECT v.*, 
              f.title as feature_title, f.status as feature_status, f.category,
              f.votes_count, f.user_id as feature_owner_id
       FROM votes v
       JOIN features f ON v.feature_id = f.id
       ${whereClause}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM votes v ${whereClause}`,
      queryParams
    );

    const total = countResult[0].total;

    // Get user voting statistics
    const [stats] = await pool.execute(
      `SELECT 
         COUNT(*) as total_votes,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes,
         COUNT(DISTINCT feature_id) as features_voted,
         MIN(created_at) as first_vote,
         MAX(created_at) as last_vote
       FROM votes WHERE user_id = ?`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        votes,
        statistics: stats[0],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get user votes error', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get votes for a specific feature
app.get('/votes/feature/:featureId', [
  param('featureId').isInt({ min: 1 }),
  ...validateQuery
], handleValidationErrors, async (req, res) => {
  try {
    const featureId = parseInt(req.params.featureId);
    const {
      page = 1,
      limit = 20,
      vote_type
    } = req.query;

    const offset = (page - 1) * limit;

    // Check if feature exists
    const [features] = await pool.execute(
      'SELECT id, title, status FROM features WHERE id = ?',
      [featureId]
    );

    if (features.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feature not found'
      });
    }

    // Build query conditions
    let whereConditions = ['v.feature_id = ?'];
    let queryParams = [featureId];

    if (vote_type) {
      whereConditions.push('v.vote_type = ?');
      queryParams.push(vote_type);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Get feature votes
    const [votes] = await pool.execute(
      `SELECT v.*, 
              u.username, u.first_name, u.last_name, u.avatar_url
       FROM votes v
       JOIN users u ON v.user_id = u.id
       ${whereClause}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset]
    );

    // Get total count and vote breakdown
    const [stats] = await pool.execute(
      `SELECT 
         COUNT(*) as total_votes,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes
       FROM votes WHERE feature_id = ?`,
      [featureId]
    );

    // Get recent voting activity (last 7 days)
    const [activity] = await pool.execute(
      `SELECT 
         DATE(created_at) as vote_date,
         COUNT(*) as votes_count,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes
       FROM votes 
       WHERE feature_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DATE(created_at)
       ORDER BY vote_date DESC`,
      [featureId]
    );

    const total = stats[0].total_votes;

    res.json({
      success: true,
      data: {
        feature: features[0],
        votes,
        statistics: stats[0],
        activity,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get feature votes error', { error: error.message, featureId: req.params.featureId });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user's vote on a specific feature
app.get('/votes/user/:userId/feature/:featureId', [
  param('userId').isInt({ min: 1 }),
  param('featureId').isInt({ min: 1 })
], handleValidationErrors, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const featureId = parseInt(req.params.featureId);

    const [votes] = await pool.execute(
      `SELECT v.*, f.title as feature_title, f.status as feature_status
       FROM votes v
       JOIN features f ON v.feature_id = f.id
       WHERE v.user_id = ? AND v.feature_id = ?`,
      [userId, featureId]
    );

    if (votes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vote not found'
      });
    }

    res.json({
      success: true,
      data: { vote: votes[0] }
    });

  } catch (error) {
    logger.error('Get user feature vote error', { 
      error: error.message, 
      userId: req.params.userId,
      featureId: req.params.featureId 
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get voting trends and analytics
app.get('/votes/analytics/trends', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    // Daily voting trends
    const [dailyTrends] = await pool.execute(
      `SELECT 
         DATE(created_at) as vote_date,
         COUNT(*) as total_votes,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes
       FROM votes 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY vote_date ASC`,
      [parseInt(days)]
    );

    // Most active voters
    const [activeVoters] = await pool.execute(
      `SELECT 
         u.id, u.username, u.first_name, u.last_name,
         COUNT(v.id) as vote_count,
         COUNT(CASE WHEN v.vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN v.vote_type = 'downvote' THEN 1 END) as downvotes
       FROM votes v
       JOIN users u ON v.user_id = u.id
       WHERE v.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY u.id
       ORDER BY vote_count DESC
       LIMIT 10`,
      [parseInt(days)]
    );

    // Voting patterns by hour
    const [hourlyPatterns] = await pool.execute(
      `SELECT 
         HOUR(created_at) as hour,
         COUNT(*) as vote_count
       FROM votes 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY HOUR(created_at)
       ORDER BY hour ASC`,
      [parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        daily_trends: dailyTrends,
        active_voters: activeVoters,
        hourly_patterns: hourlyPatterns,
        period_days: parseInt(days)
      }
    });

  } catch (error) {
    logger.error('Get voting trends error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Bulk vote operations (admin only)
app.post('/votes/bulk', requireAuth, [
  body('operations').isArray({ min: 1, max: 100 }),
  body('operations.*.action').isIn(['create', 'update', 'delete']),
  body('operations.*.feature_id').optional().isInt({ min: 1 }),
  body('operations.*.vote_id').optional().isInt({ min: 1 }),
  body('operations.*.vote_type').optional().isIn(['upvote', 'downvote'])
], handleValidationErrors, async (req, res) => {
  try {
    const { operations } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Only admins can perform bulk operations
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const results = [];
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (const op of operations) {
        try {
          let result = { operation: op, success: false };

          switch (op.action) {
            case 'create':
              if (op.feature_id && op.vote_type) {
                const [insertResult] = await connection.execute(
                  'INSERT INTO votes (user_id, feature_id, vote_type) VALUES (?, ?, ?)',
                  [userId, op.feature_id, op.vote_type]
                );
                result.success = true;
                result.vote_id = insertResult.insertId;
              }
              break;

            case 'update':
              if (op.vote_id && op.vote_type) {
                await connection.execute(
                  'UPDATE votes SET vote_type = ?, updated_at = NOW() WHERE id = ?',
                  [op.vote_type, op.vote_id]
                );
                result.success = true;
              }
              break;

            case 'delete':
              if (op.vote_id) {
                await connection.execute('DELETE FROM votes WHERE id = ?', [op.vote_id]);
                result.success = true;
              }
              break;
          }

          results.push(result);
        } catch (opError) {
          results.push({
            operation: op,
            success: false,
            error: opError.message
          });
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const successCount = results.filter(r => r.success).length;

    logger.info('Bulk vote operations completed', {
      adminId: userId,
      totalOperations: operations.length,
      successCount,
      failureCount: operations.length - successCount
    });

    res.json({
      success: true,
      message: `Bulk operations completed: ${successCount}/${operations.length} successful`,
      data: { results }
    });

  } catch (error) {
    logger.error('Bulk vote operations error', { error: error.message, userId: req.user?.id });
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
  logger.info(`Voting service running on port ${PORT}`, {
    environment: NODE_ENV,
    dbHost: dbConfig.host,
    rateLimit: VOTE_RATE_LIMIT
  });
});

module.exports = app;