const express = require('express');
const mysql = require('mysql2/promise');
const { query, validationResult } = require('express-validator');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const compression = require('compression');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3004;

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 180;
const REPORT_BATCH_SIZE = parseInt(process.env.REPORT_BATCH_SIZE) || 1000;

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
  defaultMeta: { service: 'reporting-service' },
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
const validateReportQuery = [
  query('days').optional().isInt({ min: 1, max: 365 }),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'implemented', 'archived']),
  query('category').optional().isLength({ max: 50 }),
  query('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Reporting service is healthy',
    timestamp: new Date().toISOString()
  });
});

// Get all features with their vote counts
app.get('/reports/features/votes/all', validateReportQuery, handleValidationErrors, async (req, res) => {
  try {
    const { limit = 100, status, category, priority } = req.query;
    const cacheKey = `features_votes_all:${JSON.stringify(req.query)}`;
    
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

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const [features] = await pool.execute(
      `SELECT 
         f.id, f.title, f.description, f.status, f.priority, f.category,
         f.votes_count, f.upvotes_count, f.downvotes_count,
         f.created_at, f.updated_at,
         u.username, u.first_name, u.last_name,
         COALESCE(vc.comments_count, 0) as comments_count,
         CASE 
           WHEN f.votes_count > 0 THEN ROUND((f.upvotes_count / (f.upvotes_count + f.downvotes_count)) * 100, 2)
           ELSE 0 
         END as approval_rate
       FROM features f
       JOIN users u ON f.user_id = u.id
       LEFT JOIN (
         SELECT feature_id, COUNT(*) as comments_count 
         FROM comments 
         GROUP BY feature_id
       ) vc ON f.id = vc.feature_id
       ${whereClause}
       ORDER BY f.votes_count DESC, f.created_at DESC
       LIMIT ?`,
      [...queryParams, parseInt(limit)]
    );

    // Calculate summary statistics
    const [summary] = await pool.execute(
      `SELECT 
         COUNT(*) as total_features,
         SUM(f.votes_count) as total_votes,
         AVG(f.votes_count) as avg_votes_per_feature,
         MAX(f.votes_count) as max_votes,
         SUM(f.upvotes_count) as total_upvotes,
         SUM(f.downvotes_count) as total_downvotes
       FROM features f ${whereClause}`,
      queryParams
    );

    const response = {
      success: true,
      data: {
        features,
        summary: summary[0],
        filters: { status, category, priority, limit: parseInt(limit) }
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get features votes all error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get vote details for a specific feature
app.get('/reports/features/votes/:featureId', validateReportQuery, handleValidationErrors, async (req, res) => {
  try {
    const featureId = parseInt(req.params.featureId);
    const { days = 30 } = req.query;
    const cacheKey = `feature_votes:${featureId}:${days}`;
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get feature details
    const [features] = await pool.execute(
      `SELECT f.*, u.username, u.first_name, u.last_name
       FROM features f
       JOIN users u ON f.user_id = u.id
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

    // Get voting timeline
    const [timeline] = await pool.execute(
      `SELECT 
         DATE(created_at) as vote_date,
         COUNT(*) as total_votes,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes
       FROM votes 
       WHERE feature_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY vote_date ASC`,
      [featureId, parseInt(days)]
    );

    // Get voter demographics
    const [demographics] = await pool.execute(
      `SELECT 
         v.vote_type,
         COUNT(*) as count,
         COUNT(DISTINCT v.user_id) as unique_voters,
         AVG(DATEDIFF(NOW(), u.created_at)) as avg_user_age_days
       FROM votes v
       JOIN users u ON v.user_id = u.id
       WHERE v.feature_id = ?
       GROUP BY v.vote_type`,
      [featureId]
    );

    // Get recent voters
    const [recentVoters] = await pool.execute(
      `SELECT 
         v.vote_type, v.created_at,
         u.username, u.first_name, u.last_name
       FROM votes v
       JOIN users u ON v.user_id = u.id
       WHERE v.feature_id = ?
       ORDER BY v.created_at DESC
       LIMIT 20`,
      [featureId]
    );

    const response = {
      success: true,
      data: {
        feature,
        timeline,
        demographics,
        recent_voters: recentVoters,
        period_days: parseInt(days)
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get feature votes error', { error: error.message, featureId: req.params.featureId });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get features grouped by status
app.get('/reports/features/status', validateReportQuery, handleValidationErrors, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const cacheKey = `features_status:${days}`;
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get status distribution
    const [statusDistribution] = await pool.execute(
      `SELECT 
         status,
         COUNT(*) as count,
         AVG(votes_count) as avg_votes,
         SUM(votes_count) as total_votes,
         COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as recent_count
       FROM features
       GROUP BY status
       ORDER BY 
         CASE status
           WHEN 'pending' THEN 1
           WHEN 'approved' THEN 2
           WHEN 'implemented' THEN 3
           WHEN 'rejected' THEN 4
           WHEN 'archived' THEN 5
         END`,
      [parseInt(days)]
    );

    // Get status transition timeline
    const [transitions] = await pool.execute(
      `SELECT 
         DATE(updated_at) as transition_date,
         status,
         COUNT(*) as transitions_count
       FROM features
       WHERE updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(updated_at), status
       ORDER BY transition_date ASC`,
      [parseInt(days)]
    );

    // Get average time in each status
    const [avgTimes] = await pool.execute(
      `SELECT 
         status,
         AVG(CASE 
           WHEN status = 'approved' AND approved_at IS NOT NULL 
           THEN DATEDIFF(approved_at, created_at)
           WHEN status = 'implemented' AND implemented_at IS NOT NULL 
           THEN DATEDIFF(implemented_at, COALESCE(approved_at, created_at))
           ELSE DATEDIFF(NOW(), created_at)
         END) as avg_days_in_status
       FROM features
       GROUP BY status`
    );

    const response = {
      success: true,
      data: {
        status_distribution: statusDistribution,
        transitions: transitions,
        average_times: avgTimes,
        period_days: parseInt(days)
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get features status error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get voting trends and results
app.get('/reports/features/trends', validateReportQuery, handleValidationErrors, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const cacheKey = `voting_trends:${days}`;
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Daily voting activity
    const [dailyActivity] = await pool.execute(
      `SELECT 
         DATE(created_at) as vote_date,
         COUNT(*) as total_votes,
         COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END) as upvotes,
         COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END) as downvotes,
         COUNT(DISTINCT user_id) as unique_voters,
         COUNT(DISTINCT feature_id) as features_voted_on
       FROM votes
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY vote_date ASC`,
      [parseInt(days)]
    );

    // Top performing features
    const [topFeatures] = await pool.execute(
      `SELECT 
         f.id, f.title, f.status, f.category,
         f.votes_count, f.upvotes_count, f.downvotes_count,
         u.username as author,
         ROUND((f.upvotes_count / GREATEST(f.upvotes_count + f.downvotes_count, 1)) * 100, 2) as approval_rate
       FROM features f
       JOIN users u ON f.user_id = u.id
       WHERE f.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY f.votes_count DESC
       LIMIT 10`,
      [parseInt(days)]
    );

    // Category performance
    const [categoryStats] = await pool.execute(
      `SELECT 
         f.category,
         COUNT(*) as feature_count,
         SUM(f.votes_count) as total_votes,
         AVG(f.votes_count) as avg_votes_per_feature,
         AVG(CASE WHEN f.upvotes_count + f.downvotes_count > 0 
             THEN (f.upvotes_count / (f.upvotes_count + f.downvotes_count)) * 100 
             ELSE 0 END) as avg_approval_rate
       FROM features f
       WHERE f.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY f.category
       ORDER BY total_votes DESC`,
      [parseInt(days)]
    );

    // User engagement stats
    const [userEngagement] = await pool.execute(
      `SELECT 
         COUNT(DISTINCT v.user_id) as active_voters,
         COUNT(DISTINCT f.user_id) as active_creators,
         AVG(daily_votes.votes_per_user) as avg_votes_per_active_user
       FROM votes v
       JOIN features f ON v.feature_id = f.id
       JOIN (
         SELECT user_id, COUNT(*) as votes_per_user
         FROM votes
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY user_id
       ) daily_votes ON v.user_id = daily_votes.user_id
       WHERE v.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [parseInt(days), parseInt(days)]
    );

    const response = {
      success: true,
      data: {
        daily_activity: dailyActivity,
        top_features: topFeatures,
        category_stats: categoryStats,
        user_engagement: userEngagement[0],
        period_days: parseInt(days)
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get voting trends error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get feature results and outcomes
app.get('/reports/features/results', validateReportQuery, handleValidationErrors, async (req, res) => {
  try {
    const { limit = 50, status } = req.query;
    const cacheKey = `feature_results:${limit}:${status}`;
    
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
    } else {
      // Default to completed features
      whereConditions.push("f.status IN ('implemented', 'rejected', 'archived')");
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Get features with their outcomes
    const [results] = await pool.execute(
      `SELECT 
         f.id, f.title, f.status, f.priority, f.category,
         f.votes_count, f.upvotes_count, f.downvotes_count,
         f.created_at, f.approved_at, f.implemented_at,
         f.implementation_notes, f.rejection_reason,
         u.username as author_username,
         u.first_name as author_first_name,
         u.last_name as author_last_name,
         CASE 
           WHEN f.implemented_at IS NOT NULL AND f.approved_at IS NOT NULL
           THEN DATEDIFF(f.implemented_at, f.approved_at)
           ELSE NULL
         END as implementation_days,
         CASE 
           WHEN f.approved_at IS NOT NULL
           THEN DATEDIFF(f.approved_at, f.created_at)
           ELSE NULL
         END as approval_days,
         ROUND((f.upvotes_count / GREATEST(f.upvotes_count + f.downvotes_count, 1)) * 100, 2) as approval_rate
       FROM features f
       JOIN users u ON f.user_id = u.id
       ${whereClause}
       ORDER BY f.votes_count DESC, f.updated_at DESC
       LIMIT ?`,
      [...queryParams, parseInt(limit)]
    );

    // Calculate outcome statistics
    const [outcomeStats] = await pool.execute(
      `SELECT 
         COUNT(*) as total_completed,
         COUNT(CASE WHEN status = 'implemented' THEN 1 END) as implemented_count,
         COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count,
         COUNT(CASE WHEN status = 'archived' THEN 1 END) as archived_count,
         AVG(CASE WHEN implemented_at IS NOT NULL AND approved_at IS NOT NULL 
             THEN DATEDIFF(implemented_at, approved_at) END) as avg_implementation_days,
         AVG(CASE WHEN approved_at IS NOT NULL 
             THEN DATEDIFF(approved_at, created_at) END) as avg_approval_days,
         AVG(votes_count) as avg_votes_for_completed
       FROM features f ${whereClause}`,
      queryParams
    );

    // Get implementation success rate by category
    const [categorySuccess] = await pool.execute(
      `SELECT 
         category,
         COUNT(*) as total_features,
         COUNT(CASE WHEN status = 'implemented' THEN 1 END) as implemented,
         ROUND((COUNT(CASE WHEN status = 'implemented' THEN 1 END) / COUNT(*)) * 100, 2) as implementation_rate,
         AVG(votes_count) as avg_votes
       FROM features f ${whereClause}
       GROUP BY category
       ORDER BY implementation_rate DESC`,
      queryParams
    );

    const response = {
      success: true,
      data: {
        results,
        outcome_stats: outcomeStats[0],
        category_success: categorySuccess,
        filters: { status, limit: parseInt(limit) }
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get feature results error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user activity report
app.get('/reports/users/activity', validateReportQuery, handleValidationErrors, async (req, res) => {
  try {
    const { days = 30, limit = 20 } = req.query;
    const cacheKey = `user_activity:${days}:${limit}`;
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get most active users
    const [activeUsers] = await pool.execute(
      `SELECT 
         u.id, u.username, u.first_name, u.last_name,
         COUNT(DISTINCT f.id) as features_created,
         COUNT(DISTINCT v.id) as votes_cast,
         COUNT(DISTINCT c.id) as comments_made,
         MAX(GREATEST(
           COALESCE(f.created_at, '1970-01-01'),
           COALESCE(v.created_at, '1970-01-01'),
           COALESCE(c.created_at, '1970-01-01')
         )) as last_activity
       FROM users u
       LEFT JOIN features f ON u.id = f.user_id 
         AND f.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       LEFT JOIN votes v ON u.id = v.user_id 
         AND v.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       LEFT JOIN comments c ON u.id = c.user_id 
         AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       WHERE u.is_active = TRUE
       GROUP BY u.id
       HAVING (features_created > 0 OR votes_cast > 0 OR comments_made > 0)
       ORDER BY (features_created + votes_cast + comments_made) DESC
       LIMIT ?`,
      [parseInt(days), parseInt(days), parseInt(days), parseInt(limit)]
    );

    // Get user engagement metrics
    const [engagementMetrics] = await pool.execute(
      `SELECT 
         COUNT(DISTINCT u.id) as total_active_users,
         AVG(user_stats.features_created) as avg_features_per_user,
         AVG(user_stats.votes_cast) as avg_votes_per_user,
         AVG(user_stats.comments_made) as avg_comments_per_user
       FROM users u
       JOIN (
         SELECT 
           u.id,
           COUNT(DISTINCT f.id) as features_created,
           COUNT(DISTINCT v.id) as votes_cast,
           COUNT(DISTINCT c.id) as comments_made
         FROM users u
         LEFT JOIN features f ON u.id = f.user_id 
           AND f.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         LEFT JOIN votes v ON u.id = v.user_id 
           AND v.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         LEFT JOIN comments c ON u.id = c.user_id 
           AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         WHERE u.is_active = TRUE
         GROUP BY u.id
         HAVING (features_created > 0 OR votes_cast > 0 OR comments_made > 0)
       ) user_stats ON u.id = user_stats.id`,
      [parseInt(days), parseInt(days), parseInt(days)]
    );

    // Get new user registrations
    const [newUsers] = await pool.execute(
      `SELECT 
         DATE(created_at) as registration_date,
         COUNT(*) as new_registrations
       FROM users
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY registration_date ASC`,
      [parseInt(days)]
    );

    const response = {
      success: true,
      data: {
        active_users: activeUsers,
        engagement_metrics: engagementMetrics[0],
        new_users: newUsers,
        period_days: parseInt(days)
      }
    };

    // Cache response
    cacheSet(cacheKey, response);

    res.json(response);

  } catch (error) {
    logger.error('Get user activity error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get system-wide analytics dashboard
app.get('/reports/dashboard', async (req, res) => {
  try {
    const cacheKey = 'dashboard_analytics';
    
    // Check cache
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Overall system statistics
    const [systemStats] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE is_active = TRUE) as total_users,
        (SELECT COUNT(*) FROM features) as total_features,
        (SELECT COUNT(*) FROM votes) as total_votes,
        (SELECT COUNT(*) FROM comments) as total_comments,
        (SELECT COUNT(*) FROM features WHERE status = 'pending') as pending_features,
        (SELECT COUNT(*) FROM features WHERE status = 'implemented') as implemented_features,
        (SELECT AVG(votes_count) FROM features) as avg_votes_per_feature,
        (SELECT COUNT(DISTINCT user_id) FROM votes WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as active_voters_week
    `);

    // Recent activity (last 7 days)
    const [recentActivity] = await pool.execute(`
      SELECT 
        DATE(created_at) as activity_date,
        'feature' as activity_type,
        COUNT(*) as count
      FROM features
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      
      UNION ALL
      
      SELECT 
        DATE(created_at) as activity_date,
        'vote' as activity_type,
        COUNT(*) as count
      FROM votes
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      
      UNION ALL
      
      SELECT 
        DATE(created_at) as activity_date,
        'comment' as activity_type,
        COUNT(*) as count
      FROM comments
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      
      ORDER BY activity_date ASC, activity_type
    `);

    // Top categories
    const [topCategories] = await pool.execute(`
      SELECT 
        category,
        COUNT(*) as feature_count,
        SUM(votes_count) as total_votes,
        AVG(votes_count) as avg_votes
      FROM features
      WHERE category IS NOT NULL
      GROUP BY category
      ORDER BY total_votes DESC
      LIMIT 10
    `);

    // Performance metrics
    const [performanceMetrics] = await pool.execute(`
      SELECT 
        AVG(CASE WHEN approved_at IS NOT NULL 
            THEN DATEDIFF(approved_at, created_at) END) as avg_approval_time_days,
        AVG(CASE WHEN implemented_at IS NOT NULL AND approved_at IS NOT NULL 
            THEN DATEDIFF(implemented_at, approved_at) END) as avg_implementation_time_days,
        (SELECT COUNT(*) FROM features WHERE status = 'implemented') / 
        (SELECT COUNT(*) FROM features WHERE status IN ('implemented', 'rejected')) * 100 as implementation_success_rate
    `);

    const response = {
      success: true,
      data: {
        system_stats: systemStats[0],
        recent_activity: recentActivity,
        top_categories: topCategories,
        performance_metrics: performanceMetrics[0],
        generated_at: new Date().toISOString()
      }
    };

    // Cache response for shorter time (dashboard should be more real-time)
    cacheSet(cacheKey, response, 60); // 1 minute cache

    res.json(response);

  } catch (error) {
    logger.error('Get dashboard analytics error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Export data endpoint (CSV format)
app.get('/reports/export/csv', async (req, res) => {
  try {
    const { type = 'features', days = 30 } = req.query;
    
    let csvData = '';
    let filename = '';

    switch (type) {
      case 'features':
        const [features] = await pool.execute(`
          SELECT 
            f.id, f.title, f.status, f.priority, f.category,
            f.votes_count, f.upvotes_count, f.downvotes_count,
            f.created_at, u.username as author
          FROM features f
          JOIN users u ON f.user_id = u.id
          WHERE f.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ORDER BY f.created_at DESC
        `, [parseInt(days)]);
        
        csvData = 'ID,Title,Status,Priority,Category,Total Votes,Upvotes,Downvotes,Created At,Author\n';
        features.forEach(f => {
          csvData += `${f.id},"${f.title}",${f.status},${f.priority},${f.category},${f.votes_count},${f.upvotes_count},${f.downvotes_count},${f.created_at},${f.author}\n`;
        });
        filename = `features_${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'votes':
        const [votes] = await pool.execute(`
          SELECT 
            v.id, v.vote_type, v.created_at,
            f.title as feature_title, u.username as voter
          FROM votes v
          JOIN features f ON v.feature_id = f.id
          JOIN users u ON v.user_id = u.id
          WHERE v.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ORDER BY v.created_at DESC
        `, [parseInt(days)]);
        
        csvData = 'Vote ID,Vote Type,Feature Title,Voter,Created At\n';
        votes.forEach(v => {
          csvData += `${v.id},${v.vote_type},"${v.feature_title}",${v.voter},${v.created_at}\n`;
        });
        filename = `votes_${new Date().toISOString().split('T')[0]}.csv`;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid export type. Supported types: features, votes'
        });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csvData);

  } catch (error) {
    logger.error('Export CSV error', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Clear cache endpoint (admin only)
app.post('/reports/cache/clear', (req, res) => {
  try {
    // Check if user is admin (in real app, this would be properly authenticated)
    const userRole = req.headers['x-user-role'];
    
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    cache.clear();
    
    logger.info('Report cache cleared', { adminId: req.headers['x-user-id'] });
    
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });

  } catch (error) {
    logger.error('Clear cache error', { error: error.message });
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
  logger.info(`Reporting service running on port ${PORT}`, {
    environment: NODE_ENV,
    dbHost: dbConfig.host,
    cacheEnabled: true
  });
});

module.exports = app;