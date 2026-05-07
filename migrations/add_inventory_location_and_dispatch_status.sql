-- Migration: Add inventory location + widen order_status for "Ready for Pickup/Delivery"
-- Run once against your database before deploying the updated API
-- Date: 2026-04-30

-- 1. Widen order_status from VARCHAR(20) to VARCHAR(30)
--    Reason: "Ready for Pickup/Delivery" = 25 characters, exceeds current limit
ALTER TABLE prixel_orders
  MODIFY COLUMN order_status VARCHAR(30) NOT NULL DEFAULT 'Pending';

-- 2. Add location column to inventory (default: Warehouse)
--    Tracks where each inventory item is physically stored
ALTER TABLE prixel_inventory
  ADD COLUMN location VARCHAR(100) DEFAULT 'Warehouse' AFTER state;
