const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { body, validationResult, param } = require('express-validator');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const NODE_ENV = process.env.NODE_ENV || 'development';

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
  timeout: 60000,
  reconnect: true
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Configure Winston logger
const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'user-service' },
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

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Utility functions
const generateTokens = (user) => {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role || 'user'
  };
  
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
  
  return { accessToken, refreshToken };
};

const hashPassword = async (password) => {
  return await bcrypt.hash(password, BCRYPT_ROUNDS);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Validation middleware
const validateRegistration = [
  body('username').isLength({ min: 3, max: 50 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  body('first_name').optional().isLength({ max: 50 }).trim().escape(),
  body('last_name').optional().isLength({ max: 50 }).trim().escape()
];

const validateLogin = [
  body('username').notEmpty().trim(),
  body('password').notEmpty()
];

const validateProfileUpdate = [
  body('first_name').optional().isLength({ max: 50 }).trim().escape(),
  body('last_name').optional().isLength({ max: 50 }).trim().escape(),
  body('bio').optional().isLength({ max: 500 }).trim(),
  body('avatar_url').optional().isURL()
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
    message: 'User service is healthy',
    timestamp: new Date().toISOString()
  });
});

// Authentication routes

// Register new user
app.post('/auth/register', authLimiter, validateRegistration, handleValidationErrors, async (req, res) => {
  try {
    const { username, email, password, first_name, last_name, bio } = req.body;

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Username or email already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, bio) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, email, passwordHash, first_name || null, last_name || null, bio || null]
    );

    const userId = result.insertId;

    // Get created user
    const [users] = await pool.execute(
      'SELECT id, username, email, first_name, last_name, bio, is_verified, created_at FROM users WHERE id = ?',
      [userId]
    );

    const user = users[0];
    const tokens = generateTokens(user);

    // Store session
    await pool.execute(
      `INSERT INTO user_sessions (user_id, session_token, refresh_token, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [userId, tokens.accessToken, tokens.refreshToken, req.ip, req.get('User-Agent'), 7 * 24 * 60 * 60]
    );

    logger.info('User registered successfully', { userId, username, email });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          bio: user.bio,
          is_verified: user.is_verified,
          created_at: user.created_at
        },
        tokens
      }
    });

  } catch (error) {
    logger.error('Registration error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Login user
app.post('/auth/login', authLimiter, validateLogin, handleValidationErrors, async (req, res) => {
  try {
    const { username, password } = req.body;

    // Get user by username or email
    const [users] = await pool.execute(
      `SELECT id, username, email, password_hash, first_name, last_name, bio, is_verified, is_active 
       FROM users WHERE (username = ? OR email = ?) AND is_active = TRUE`,
      [username, username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = users[0];

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate tokens
    const tokens = generateTokens(user);

    // Store session
    await pool.execute(
      `INSERT INTO user_sessions (user_id, session_token, refresh_token, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [user.id, tokens.accessToken, tokens.refreshToken, req.ip, req.get('User-Agent'), 7 * 24 * 60 * 60]
    );

    logger.info('User logged in successfully', { userId: user.id, username: user.username });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          bio: user.bio,
          is_verified: user.is_verified
        },
        tokens
      }
    });

  } catch (error) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Refresh token
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refresh_token, JWT_SECRET);

    // Check if session exists and is active
    const [sessions] = await pool.execute(
      'SELECT user_id FROM user_sessions WHERE refresh_token = ? AND is_active = TRUE AND expires_at > NOW()',
      [refresh_token]
    );

    if (sessions.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    }

    // Get user
    const [users] = await pool.execute(
      'SELECT id, username, email, first_name, last_name, bio, is_verified FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = users[0];
    const tokens = generateTokens(user);

    // Update session with new tokens
    await pool.execute(
      'UPDATE user_sessions SET session_token = ?, refresh_token = ?, last_activity = NOW() WHERE refresh_token = ?',
      [tokens.accessToken, tokens.refreshToken, refresh_token]
    );

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: { tokens }
    });

  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
});

// Logout user
app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // Deactivate session
    await pool.execute(
      'UPDATE user_sessions SET is_active = FALSE WHERE session_token = ?',
      [token]
    );

    logger.info('User logged out', { userId: req.user.id });

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    logger.error('Logout error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// User management routes

// Get user profile
app.get('/users/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, username, email, first_name, last_name, bio, avatar_url, is_verified, last_login_at, created_at,
              (SELECT COUNT(*) FROM features WHERE user_id = users.id) as features_count,
              (SELECT COUNT(*) FROM votes WHERE user_id = users.id) as votes_count
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user: users[0] }
    });

  } catch (error) {
    logger.error('Get profile error', { error: error.message, userId: req.user.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user by ID
app.get('/users/:id', [
  param('id').isInt({ min: 1 })
], handleValidationErrors, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const [users] = await pool.execute(
      `SELECT id, username, first_name, last_name, bio, avatar_url, is_verified, created_at,
              (SELECT COUNT(*) FROM features WHERE user_id = users.id) as features_count,
              (SELECT COUNT(*) FROM votes WHERE user_id = users.id) as votes_count
       FROM users WHERE id = ? AND is_active = TRUE`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user: users[0] }
    });

  } catch (error) {
    logger.error('Get user error', { error: error.message, targetUserId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update user profile
app.put('/users/profile', authenticateToken, validateProfileUpdate, handleValidationErrors, async (req, res) => {
  try {
    const { first_name, last_name, bio, avatar_url } = req.body;
    const userId = req.user.id;

    await pool.execute(
      'UPDATE users SET first_name = ?, last_name = ?, bio = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?',
      [first_name || null, last_name || null, bio || null, avatar_url || null, userId]
    );

    // Get updated user
    const [users] = await pool.execute(
      'SELECT id, username, email, first_name, last_name, bio, avatar_url, is_verified FROM users WHERE id = ?',
      [userId]
    );

    logger.info('User profile updated', { userId });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: users[0] }
    });

  } catch (error) {
    logger.error('Update profile error', { error: error.message, userId: req.user.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Change password
app.put('/users/password', authenticateToken, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], handleValidationErrors, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    // Get current password hash
    const [users] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const isValidPassword = await verifyPassword(current_password, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const newPasswordHash = await hashPassword(new_password);

    // Update password
    await pool.execute(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [newPasswordHash, userId]
    );

    // Invalidate all sessions except current
    const authHeader = req.headers['authorization'];
    const currentToken = authHeader && authHeader.split(' ')[1];
    
    await pool.execute(
      'UPDATE user_sessions SET is_active = FALSE WHERE user_id = ? AND session_token != ?',
      [userId, currentToken]
    );

    logger.info('Password changed', { userId });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error', { error: error.message, userId: req.user.id });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Delete user account
app.delete('/users/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Soft delete - mark as inactive
    await pool.execute(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = ?',
      [userId]
    );

    // Invalidate all sessions
    await pool.execute(
      'UPDATE user_sessions SET is_active = FALSE WHERE user_id = ?',
      [userId]
    );

    logger.info('User account deleted', { userId });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    logger.error('Delete account error', { error: error.message, userId: req.user.id });
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
  logger.info(`User service running on port ${PORT}`, {
    environment: NODE_ENV,
    dbHost: dbConfig.host
  });
});

module.exports = app;