-- ============================================================
-- Payment Module Migration
-- Run on: portalcanstarlig_pixeltracks
-- ============================================================

-- 1. Expand the status ENUM to include 'Payment Submitted'
ALTER TABLE `prixel_invoices`
  MODIFY COLUMN `status` ENUM('Draft','Sent','Payment Submitted','Paid','Cancelled') DEFAULT 'Draft';

-- 2. Add payment tracking columns
ALTER TABLE `prixel_invoices`
  ADD COLUMN IF NOT EXISTS `payment_screenshot`    VARCHAR(255) DEFAULT NULL COMMENT 'Filename of uploaded e-transfer screenshot',
  ADD COLUMN IF NOT EXISTS `payment_submitted_at`  DATETIME     DEFAULT NULL COMMENT 'When admin uploaded the payment proof',
  ADD COLUMN IF NOT EXISTS `payment_confirmed_at`  DATETIME     DEFAULT NULL COMMENT 'When admin confirmed the payment',
  ADD COLUMN IF NOT EXISTS `payment_note`          TEXT         DEFAULT NULL COMMENT 'Optional admin note on payment';
