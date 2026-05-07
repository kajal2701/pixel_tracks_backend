-- Add status column to prixel_admin_users
-- Allows deactivating users without deleting them
ALTER TABLE prixel_admin_users
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
    COMMENT 'active | inactive';
