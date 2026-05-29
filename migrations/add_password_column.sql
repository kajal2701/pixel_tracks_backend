-- Migration: Add password column to prixel_customers
-- The access_code column is kept but no longer used for login.
-- New password column stores Base64-encoded passwords.

ALTER TABLE `prixel_customers`
  ADD COLUMN `password` VARCHAR(255) DEFAULT NULL AFTER `access_code`;
