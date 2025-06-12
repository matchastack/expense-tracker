-- Splitwise Clone Database Initialization Script
-- PostgreSQL 12+ compatible

-- Create database (run this separately if needed)
-- CREATE DATABASE splitwise_db;
-- \c splitwise_db;

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types
CREATE TYPE split_type_enum AS ENUM ('equal', 'exact', 'percentage');
CREATE TYPE expense_category_enum AS ENUM (
    'general', 'food', 'utilities', 'rent', 'transportation', 
    'entertainment', 'shopping', 'travel', 'healthcare', 'other'
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
    email VARCHAR(320) UNIQUE, -- RFC 5321 max email length
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Indexes
    CONSTRAINT users_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- Groups table
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
    description TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Constraints
    CONSTRAINT groups_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- Group memberships (many-to-many relationship between users and groups)
CREATE TABLE group_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Ensure unique membership per user per group
    UNIQUE(group_id, user_id)
);

-- Expenses table
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    description VARCHAR(500) NOT NULL CHECK (LENGTH(TRIM(description)) > 0),
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    paid_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    split_type split_type_enum NOT NULL DEFAULT 'equal',
    category expense_category_enum DEFAULT 'general',
    notes TEXT,
    receipt_url VARCHAR(500), -- For storing receipt image URLs
    expense_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    
    -- Constraints
    CONSTRAINT expenses_description_not_empty CHECK (LENGTH(TRIM(description)) > 0),
    CONSTRAINT expenses_positive_amount CHECK (amount > 0)
);

-- Expense splits table (how each expense is divided)
CREATE TABLE expense_splits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
    percentage DECIMAL(5, 2) DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique split per user per expense
    UNIQUE(expense_id, user_id),
    
    -- Constraints
    CONSTRAINT expense_splits_non_negative_amount CHECK (amount >= 0)
);

-- Settlements table (track when debts are settled)
CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    description VARCHAR(500),
    settlement_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_confirmed BOOLEAN DEFAULT FALSE,
    
    -- Constraints
    CONSTRAINT settlements_positive_amount CHECK (amount > 0),
    CONSTRAINT settlements_different_users CHECK (from_user_id != to_user_id)
);

-- Activity log table (for tracking changes and history)
CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL, -- 'expense_added', 'expense_updated', 'settlement_made', etc.
    description TEXT,
    metadata JSONB, -- For storing additional structured data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;

CREATE INDEX idx_groups_created_by ON groups(created_by);
CREATE INDEX idx_groups_active ON groups(is_active) WHERE is_active = TRUE;

CREATE INDEX idx_group_memberships_group_id ON group_memberships(group_id);
CREATE INDEX idx_group_memberships_user_id ON group_memberships(user_id);
CREATE INDEX idx_group_memberships_active ON group_memberships(is_active) WHERE is_active = TRUE;

CREATE INDEX idx_expenses_paid_by ON expenses(paid_by);
CREATE INDEX idx_expenses_group_id ON expenses(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_created_at ON expenses(created_at);
CREATE INDEX idx_expenses_active ON expenses(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX idx_expenses_category ON expenses(category);

CREATE INDEX idx_expense_splits_expense_id ON expense_splits(expense_id);
CREATE INDEX idx_expense_splits_user_id ON expense_splits(user_id);

CREATE INDEX idx_settlements_from_user ON settlements(from_user_id);
CREATE INDEX idx_settlements_to_user ON settlements(to_user_id);
CREATE INDEX idx_settlements_group_id ON settlements(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_settlements_date ON settlements(settlement_date);

CREATE INDEX idx_activity_log_user_id ON activity_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_activity_log_group_id ON activity_log(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_activity_log_expense_id ON activity_log(expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX idx_activity_log_created_at ON activity_log(created_at);

-- Create triggers for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to validate expense splits sum equals expense amount
CREATE OR REPLACE FUNCTION validate_expense_splits()
RETURNS TRIGGER AS $$
DECLARE
    expense_amount DECIMAL(12, 2);
    splits_total DECIMAL(12, 2);
BEGIN
    -- Get the expense amount
    SELECT amount INTO expense_amount FROM expenses WHERE id = NEW.expense_id;
    
    -- Calculate total of all splits for this expense
    SELECT COALESCE(SUM(amount), 0) INTO splits_total 
    FROM expense_splits 
    WHERE expense_id = NEW.expense_id;
    
    -- If this is an update, subtract the old amount and add the new amount
    IF TG_OP = 'UPDATE' THEN
        splits_total = splits_total - OLD.amount + NEW.amount;
    ELSE
        splits_total = splits_total + NEW.amount;
    END IF;
    
    -- Allow small rounding differences (within 1 cent)
    IF ABS(splits_total - expense_amount) > 0.01 THEN
        RAISE EXCEPTION 'Split amounts (%) do not equal expense amount (%). Difference: %', 
            splits_total, expense_amount, ABS(splits_total - expense_amount);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the validation trigger
CREATE TRIGGER validate_expense_splits_trigger
    AFTER INSERT OR UPDATE ON expense_splits
    FOR EACH ROW EXECUTE FUNCTION validate_expense_splits();

-- Function to automatically add group creator as member
CREATE OR REPLACE FUNCTION add_creator_to_group()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO group_memberships (group_id, user_id)
    VALUES (NEW.id, NEW.created_by)
    ON CONFLICT (group_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER add_creator_to_group_trigger
    AFTER INSERT ON groups
    FOR EACH ROW EXECUTE FUNCTION add_creator_to_group();

-- Create useful views
CREATE VIEW user_balances AS
WITH expense_details AS (
    SELECT 
        e.id as expense_id,
        e.amount as total_amount,
        e.paid_by,
        es.user_id,
        es.amount as user_owes,
        e.group_id
    FROM expenses e
    JOIN expense_splits es ON e.id = es.expense_id
    WHERE e.is_deleted = FALSE
),
balance_calculations AS (
    SELECT 
        ed.user_id,
        ed.group_id,
        CASE 
            WHEN ed.paid_by = ed.user_id THEN ed.total_amount - ed.user_owes  -- Amount others owe this user
            ELSE -ed.user_owes  -- Amount this user owes
        END as balance_amount
    FROM expense_details ed
)
SELECT 
    user_id,
    group_id,
    SUM(balance_amount) as net_balance
FROM balance_calculations
GROUP BY user_id, group_id;

-- View for group summaries
CREATE VIEW group_summaries AS
SELECT 
    g.id,
    g.name,
    g.description,
    g.created_by,
    g.created_at,
    COUNT(DISTINCT gm.user_id) as member_count,
    COUNT(DISTINCT e.id) as expense_count,
    COALESCE(SUM(e.amount), 0) as total_expenses
FROM groups g
LEFT JOIN group_memberships gm ON g.id = gm.group_id AND gm.is_active = TRUE
LEFT JOIN expenses e ON g.id = e.group_id AND e.is_deleted = FALSE
WHERE g.is_active = TRUE
GROUP BY g.id, g.name, g.description, g.created_by, g.created_at;

-- Insert some sample data (optional - remove if not needed)
/*
-- Sample users
INSERT INTO users (name, email) VALUES 
    ('Alice Johnson', 'alice@example.com'),
    ('Bob Smith', 'bob@example.com'),
    ('Charlie Brown', 'charlie@example.com');

-- Sample groups
INSERT INTO groups (name, description, created_by) VALUES 
    ('Roommates', 'Shared apartment expenses', (SELECT id FROM users WHERE name = 'Alice Johnson'));

-- Sample group memberships
INSERT INTO group_memberships (group_id, user_id) 
SELECT g.id, u.id 
FROM groups g, users u 
WHERE g.name = 'Roommates' AND u.name IN ('Bob Smith', 'Charlie Brown');
*/

-- Grant permissions (adjust as needed for your application user)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

COMMIT;