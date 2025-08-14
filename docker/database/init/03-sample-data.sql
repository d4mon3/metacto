-- Sample Data for Feature Voting System
-- This file populates the database with initial test data for development

USE feature_voting;

-- Insert sample users
INSERT INTO users (username, email, password_hash, first_name, last_name, bio, is_verified) VALUES
('admin', 'admin@votingapp.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'Admin', 'User', 'System administrator', TRUE),
('johndoe', 'john@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'John', 'Doe', 'Full-stack developer passionate about UX', TRUE),
('janedoe', 'jane@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'Jane', 'Doe', 'Product manager with 5+ years experience', TRUE),
('bobsmith', 'bob@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'Bob', 'Smith', 'QA engineer and automation specialist', TRUE),
('alicechen', 'alice@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'Alice', 'Chen', 'UI/UX designer focused on accessibility', TRUE),
('mikejohnson', 'mike@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'Mike', 'Johnson', 'DevOps engineer and cloud architect', TRUE),
('sarahwilson', 'sarah@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'Sarah', 'Wilson', 'Business analyst and data enthusiast', TRUE),
('davidlee', 'david@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiMUcSsU7x.S', 'David', 'Lee', 'Mobile app developer (iOS & Android)', TRUE);

-- Note: Password for all test users is 'password123'

-- Insert sample features
INSERT INTO features (title, description, user_id, status, priority, category, estimated_effort) VALUES
('Dark Mode Support', 'Add dark mode theme option to improve user experience during low-light conditions. Should include automatic switching based on system preferences.', 2, 'approved', 'high', 'ui-ux', 'medium'),

('Push Notifications', 'Implement push notifications for new feature updates, votes on user''s features, and important announcements. Should be configurable by users.', 3, 'pending', 'medium', 'mobile', 'large'),

('Advanced Search Filters', 'Add filtering options to search features by category, status, priority, date range, and vote count. Include sorting capabilities.', 4, 'pending', 'medium', 'functionality', 'medium'),

('Two-Factor Authentication', 'Enhance security by adding 2FA support with SMS, email, and authenticator app options for user accounts.', 5, 'approved', 'high', 'security', 'large'),

('Feature Comments System', 'Allow users to comment on features for discussions, clarifications, and feedback. Include reply functionality and moderation tools.', 2, 'pending', 'low', 'social', 'large'),

('Export Data', 'Provide ability to export voting data, feature lists, and reports in CSV, JSON, and PDF formats for analysis.', 6, 'pending', 'low', 'data', 'small'),

('Real-time Vote Updates', 'Implement WebSocket or SSE for real-time vote count updates without page refresh. Improve user engagement.', 7, 'implemented', 'medium', 'functionality', 'medium'),

('Mobile App Offline Mode', 'Add offline capability to view previously loaded features and sync votes when connection is restored.', 8, 'pending', 'high', 'mobile', 'extra_large'),

('Feature Categories Management', 'Allow administrators to create, edit, and manage feature categories. Include category-based permissions.', 1, 'approved', 'medium', 'admin', 'medium'),

('Voting Analytics Dashboard', 'Create comprehensive analytics dashboard showing voting trends, popular categories, user engagement metrics.', 3, 'pending', 'low', 'analytics', 'large'),

('Feature Roadmap View', 'Display approved features in a timeline/roadmap format showing planned implementation dates and progress.', 4, 'pending', 'medium', 'ui-ux', 'medium'),

('User Profile Customization', 'Allow users to customize their profiles with avatars, bio, social links, and privacy settings.', 5, 'rejected', 'low', 'social', 'small'),

('Bulk Actions for Admins', 'Enable administrators to perform bulk operations like status changes, category assignments, and deletions.', 1, 'approved', 'medium', 'admin', 'small'),

('Feature Voting History', 'Show users their complete voting history with ability to change votes and view voting patterns.', 6, 'pending', 'low', 'functionality', 'small'),

('Integration with GitHub/Jira', 'Connect features with external project management tools to track implementation progress automatically.', 7, 'pending', 'high', 'integration', 'extra_large');

-- Insert sample votes (ensuring no self-votes due to trigger)
INSERT INTO votes (user_id, feature_id, vote_type) VALUES
-- Votes for Dark Mode Support (feature_id: 1, owner: user_id 2)
(1, 1, 'upvote'),
(3, 1, 'upvote'),
(4, 1, 'upvote'),
(5, 1, 'upvote'),
(6, 1, 'upvote'),
(7, 1, 'upvote'),
(8, 1, 'upvote'),

-- Votes for Push Notifications (feature_id: 2, owner: user_id 3)
(1, 2, 'upvote'),
(2, 2, 'upvote'),
(4, 2, 'upvote'),
(5, 2, 'upvote'),
(6, 2, 'downvote'),
(7, 2, 'upvote'),

-- Votes for Advanced Search Filters (feature_id: 3, owner: user_id 4)
(1, 3, 'upvote'),
(2, 3, 'upvote'),
(3, 3, 'upvote'),
(5, 3, 'upvote'),
(6, 3, 'upvote'),

-- Votes for Two-Factor Authentication (feature_id: 4, owner: user_id 5)
(1, 4, 'upvote'),
(2, 4, 'upvote'),
(3, 4, 'upvote'),
(4, 4, 'upvote'),
(6, 4, 'upvote'),
(7, 4, 'upvote'),
(8, 4, 'upvote'),

-- Votes for Feature Comments System (feature_id: 5, owner: user_id 2)
(1, 5, 'upvote'),
(3, 5, 'upvote'),
(4, 5, 'downvote'),
(5, 5, 'upvote'),
(6, 5, 'upvote'),

-- Votes for Export Data (feature_id: 6, owner: user_id 6)
(1, 6, 'upvote'),
(2, 6, 'downvote'),
(3, 6, 'upvote'),
(4, 6, 'upvote'),

-- Votes for Real-time Vote Updates (feature_id: 7, owner: user_id 7)
(1, 7, 'upvote'),
(2, 7, 'upvote'),
(3, 7, 'upvote'),
(4, 7, 'upvote'),
(5, 7, 'upvote'),
(6, 7, 'upvote'),
(8, 7, 'upvote'),

-- Votes for Mobile App Offline Mode (feature_id: 8, owner: user_id 8)
(1, 8, 'upvote'),
(2, 8, 'upvote'),
(3, 8, 'upvote'),
(4, 8, 'upvote'),
(5, 8, 'downvote'),
(6, 8, 'upvote'),
(7, 8, 'upvote'),

-- Votes for Feature Categories Management (feature_id: 9, owner: user_id 1)
(2, 9, 'upvote'),
(3, 9, 'upvote'),
(4, 9, 'upvote'),
(5, 9, 'upvote'),

-- Votes for Voting Analytics Dashboard (feature_id: 10, owner: user_id 3)
(1, 10, 'upvote'),
(2, 10, 'upvote'),
(4, 10, 'upvote'),
(5, 10, 'downvote'),
(6, 10, 'upvote'),

-- More scattered votes for other features
(1, 11, 'upvote'),
(2, 11, 'upvote'),
(3, 11, 'upvote'),

(1, 12, 'downvote'),
(2, 12, 'downvote'),
(3, 12, 'downvote'),

(1, 13, 'upvote'),
(2, 13, 'upvote'),
(3, 13, 'upvote'),
(4, 13, 'upvote'),

(1, 14, 'upvote'),
(2, 14, 'upvote'),

(1, 15, 'upvote'),
(2, 15, 'upvote'),
(3, 15, 'downvote'),
(4, 15, 'upvote');

-- Insert sample comments
INSERT INTO comments (feature_id, user_id, content) VALUES
(1, 3, 'This would be amazing! Dark mode is essential for mobile apps these days.'),
(1, 4, 'Agreed! Should also consider OLED-friendly pure black option.'),
(1, 5, 'Make sure to follow OS-level dark mode settings automatically.'),

(2, 2, 'Push notifications are great, but please make them easily configurable. Too many apps spam users.'),
(2, 4, 'Should include rich notifications with action buttons for quick responses.'),

(4, 3, 'Security is paramount. Consider supporting hardware keys like YubiKey too.'),
(4, 6, 'SMS 2FA has security concerns. Push-based or TOTP would be better.'),

(7, 1, 'This feature has been implemented and works great! Real-time updates are smooth.'),
(7, 3, 'Confirmed working well on mobile. No noticeable performance impact.'),

(8, 2, 'Offline mode would be huge for users with poor connectivity.'),
(8, 4, 'Consider implementing progressive sync - most important data first.'),

(10, 5, 'Analytics dashboard should include user engagement metrics and voting patterns.'),
(10, 6, 'Would love to see geographic distribution of votes if possible.');

-- Insert sample notifications
INSERT INTO notifications (user_id, type, title, message, related_entity_type, related_entity_id) VALUES
(2, 'vote_received', 'New Vote on Your Feature', 'Your feature "Dark Mode Support" received an upvote', 'feature', 1),
(3, 'vote_received', 'New Vote on Your Feature', 'Your feature "Push Notifications" received an upvote', 'feature', 2),
(2, 'feature_status_changed', 'Feature Status Updated', 'Your feature "Dark Mode Support" status changed from pending to approved', 'feature', 1),
(5, 'feature_status_changed', 'Feature Status Updated', 'Your feature "Two-Factor Authentication" status changed from pending to approved', 'feature', 4),
(7, 'feature_status_changed', 'Feature Status Updated', 'Your feature "Real-time Vote Updates" status changed from approved to implemented', 'feature', 7),
(5, 'feature_status_changed', 'Feature Status Updated', 'Your feature "User Profile Customization" status changed from pending to rejected', 'feature', 12);

-- Update last_login for some users to make data more realistic
UPDATE users SET last_login_at = DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 7) DAY) WHERE id IN (2, 3, 4, 5);
UPDATE users SET last_login_at = DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 24) HOUR) WHERE id IN (1, 6, 7, 8);

-- Add some implementation and approval timestamps
UPDATE features SET approved_at = DATE_SUB(NOW(), INTERVAL 5 DAY) WHERE status = 'approved';
UPDATE features SET implemented_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE status = 'implemented';

-- Update some features with implementation notes
UPDATE features 
SET implementation_notes = 'Implemented using CSS custom properties and localStorage for persistence. Includes automatic OS preference detection.'
WHERE id = 7;

UPDATE features 
SET rejection_reason = 'Low priority feature that duplicates existing functionality in user settings. Consider as future enhancement.'
WHERE id = 12;

-- Verify data integrity by checking vote counts match calculated values
-- This query should return matching counts for all features
SELECT 
    f.id,
    f.title,
    f.votes_count as stored_count,
    f.upvotes_count as stored_upvotes,
    f.downvotes_count as stored_downvotes,
    COALESCE(v.calculated_total, 0) as calculated_total,
    COALESCE(v.calculated_upvotes, 0) as calculated_upvotes,
    COALESCE(v.calculated_downvotes, 0) as calculated_downvotes
FROM features f
LEFT JOIN (
    SELECT 
        feature_id,
        SUM(CASE WHEN vote_type = 'upvote' THEN 1 ELSE -1 END) as calculated_total,
        SUM(CASE WHEN vote_type = 'upvote' THEN 1 ELSE 0 END) as calculated_upvotes,
        SUM(CASE WHEN vote_type = 'downvote' THEN 1 ELSE 0 END) as calculated_downvotes
    FROM votes 
    GROUP BY feature_id
) v ON f.id = v.feature_id
ORDER BY f.id;