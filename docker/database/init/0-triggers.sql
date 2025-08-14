-- Database Triggers for Feature Voting System
-- These triggers maintain data consistency and automate common operations

USE feature_voting;

-- Delimiter change for trigger creation
DELIMITER $$

-- Trigger: Update votes count when a vote is inserted
CREATE TRIGGER update_votes_count_after_insert
    AFTER INSERT ON votes
    FOR EACH ROW
BEGIN
    DECLARE upvote_count INT DEFAULT 0;
    DECLARE downvote_count INT DEFAULT 0;
    
    -- Count upvotes and downvotes for the feature
    SELECT 
        COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END),
        COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END)
    INTO upvote_count, downvote_count
    FROM votes 
    WHERE feature_id = NEW.feature_id;
    
    -- Update the features table with new counts
    UPDATE features 
    SET 
        votes_count = upvote_count - downvote_count,
        upvotes_count = upvote_count,
        downvotes_count = downvote_count,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.feature_id;
    
    -- Create notification for feature owner (if not self-vote)
    IF NEW.user_id != (SELECT user_id FROM features WHERE id = NEW.feature_id) THEN
        INSERT INTO notifications (user_id, type, title, message, related_entity_type, related_entity_id)
        SELECT 
            f.user_id,
            'vote_received',
            'New Vote on Your Feature',
            CONCAT('Your feature "', f.title, '" received a ', NEW.vote_type),
            'feature',
            NEW.feature_id
        FROM features f
        WHERE f.id = NEW.feature_id;
    END IF;
END$$

-- Trigger: Update votes count when a vote is updated (changed from upvote to downvote or vice versa)
CREATE TRIGGER update_votes_count_after_update
    AFTER UPDATE ON votes
    FOR EACH ROW
BEGIN
    DECLARE upvote_count INT DEFAULT 0;
    DECLARE downvote_count INT DEFAULT 0;
    
    -- Only update if vote_type changed
    IF OLD.vote_type != NEW.vote_type THEN
        -- Count upvotes and downvotes for the feature
        SELECT 
            COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END),
            COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END)
        INTO upvote_count, downvote_count
        FROM votes 
        WHERE feature_id = NEW.feature_id;
        
        -- Update the features table with new counts
        UPDATE features 
        SET 
            votes_count = upvote_count - downvote_count,
            upvotes_count = upvote_count,
            downvotes_count = downvote_count,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.feature_id;
    END IF;
END$$

-- Trigger: Update votes count when a vote is deleted
CREATE TRIGGER update_votes_count_after_delete
    AFTER DELETE ON votes
    FOR EACH ROW
BEGIN
    DECLARE upvote_count INT DEFAULT 0;
    DECLARE downvote_count INT DEFAULT 0;
    
    -- Count remaining upvotes and downvotes for the feature
    SELECT 
        COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END),
        COUNT(CASE WHEN vote_type = 'downvote' THEN 1 END)
    INTO upvote_count, downvote_count
    FROM votes 
    WHERE feature_id = OLD.feature_id;
    
    -- Update the features table with new counts
    UPDATE features 
    SET 
        votes_count = upvote_count - downvote_count,
        upvotes_count = upvote_count,
        downvotes_count = downvote_count,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.feature_id;
END$$

-- Trigger: Log activity when a feature is created
CREATE TRIGGER log_feature_create
    AFTER INSERT ON features
    FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (
        NEW.user_id,
        'feature_created',
        'feature',
        NEW.id,
        JSON_OBJECT(
            'title', NEW.title,
            'description', NEW.description,
            'status', NEW.status,
            'priority', NEW.priority,
            'category', NEW.category
        )
    );
END$$

-- Trigger: Log activity when a feature is updated
CREATE TRIGGER log_feature_update
    AFTER UPDATE ON features
    FOR EACH ROW
BEGIN
    -- Only log if significant fields changed (not just vote counts or timestamps)
    IF OLD.title != NEW.title OR 
       OLD.description != NEW.description OR 
       OLD.status != NEW.status OR 
       OLD.priority != NEW.priority OR 
       OLD.category != NEW.category OR
       OLD.implementation_notes != NEW.implementation_notes OR
       OLD.rejection_reason != NEW.rejection_reason THEN
        
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, old_values, new_values)
        VALUES (
            NEW.user_id,
            'feature_updated',
            'feature',
            NEW.id,
            JSON_OBJECT(
                'title', OLD.title,
                'description', OLD.description,
                'status', OLD.status,
                'priority', OLD.priority,
                'category', OLD.category,
                'implementation_notes', OLD.implementation_notes,
                'rejection_reason', OLD.rejection_reason
            ),
            JSON_OBJECT(
                'title', NEW.title,
                'description', NEW.description,
                'status', NEW.status,
                'priority', NEW.priority,
                'category', NEW.category,
                'implementation_notes', NEW.implementation_notes,
                'rejection_reason', NEW.rejection_reason
            )
        );
        
        -- Create notification for status changes
        IF OLD.status != NEW.status THEN
            INSERT INTO notifications (user_id, type, title, message, related_entity_type, related_entity_id)
            VALUES (
                NEW.user_id,
                'feature_status_changed',
                'Feature Status Updated',
                CONCAT('Your feature "', NEW.title, '" status changed from ', OLD.status, ' to ', NEW.status),
                'feature',
                NEW.id
            );
        END IF;
    END IF;
END$$

-- Trigger: Log activity when a user registers
CREATE TRIGGER log_user_create
    AFTER INSERT ON users
    FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (
        NEW.id,
        'user_registered',
        'user',
        NEW.id,
        JSON_OBJECT(
            'username', NEW.username,
            'email', NEW.email,
            'first_name', NEW.first_name,
            'last_name', NEW.last_name
        )
    );
END$$

-- Trigger: Log voting activity
CREATE TRIGGER log_vote_activity
    AFTER INSERT ON votes
    FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (
        NEW.user_id,
        CONCAT('vote_', NEW.vote_type),
        'feature',
        NEW.feature_id,
        JSON_OBJECT(
            'vote_type', NEW.vote_type,
            'vote_id', NEW.id
        )
    );
END$$

-- Trigger: Clean up expired sessions automatically
CREATE TRIGGER cleanup_expired_sessions
    BEFORE INSERT ON user_sessions
    FOR EACH ROW
BEGIN
    -- Clean up expired sessions for this user before inserting new one
    DELETE FROM user_sessions 
    WHERE user_id = NEW.user_id 
    AND expires_at < CURRENT_TIMESTAMP;
END$$

-- Trigger: Update user last_login when session is created
CREATE TRIGGER update_user_last_login
    AFTER INSERT ON user_sessions
    FOR EACH ROW
BEGIN
    UPDATE users 
    SET last_login_at = CURRENT_TIMESTAMP
    WHERE id = NEW.user_id;
END$$

-- Trigger: Auto-mark notifications as related to deleted entities
CREATE TRIGGER cleanup_notifications_on_feature_delete
    AFTER DELETE ON features
    FOR EACH ROW
BEGIN
    -- Mark notifications related to deleted feature as read
    UPDATE notifications 
    SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
    WHERE related_entity_type = 'feature' 
    AND related_entity_id = OLD.id;
END$$

-- Trigger: Validate feature status transitions
CREATE TRIGGER validate_feature_status_transition
    BEFORE UPDATE ON features
    FOR EACH ROW
BEGIN
    -- Define valid status transitions
    IF OLD.status != NEW.status THEN
        CASE OLD.status
            WHEN 'pending' THEN
                IF NEW.status NOT IN ('approved', 'rejected', 'archived') THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid status transition from pending';
                END IF;
            WHEN 'approved' THEN
                IF NEW.status NOT IN ('implemented', 'archived', 'pending') THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid status transition from approved';
                END IF;
            WHEN 'rejected' THEN
                IF NEW.status NOT IN ('pending', 'archived') THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid status transition from rejected';
                END IF;
            WHEN 'implemented' THEN
                IF NEW.status NOT IN ('archived') THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid status transition from implemented';
                END IF;
            WHEN 'archived' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot change status of archived feature';
        END CASE;
        
        -- Set timestamps for status changes
        CASE NEW.status
            WHEN 'approved' THEN
                SET NEW.approved_at = CURRENT_TIMESTAMP;
            WHEN