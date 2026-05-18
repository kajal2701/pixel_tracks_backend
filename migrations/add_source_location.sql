-- Add source_location column to track where inventory was picked from at dispatch
-- This is used by the Completed handler to know where to deduct inventory
ALTER TABLE prixel_orders ADD COLUMN source_location VARCHAR(500) NULL AFTER delivery_address;
