-- Issue #6: Replace source_location with source_locations JSON column for multi-location dispatch
-- Run once on production DB before deploying.

ALTER TABLE prixel_orders
  DROP COLUMN source_location,
  ADD COLUMN source_locations JSON DEFAULT NULL;
