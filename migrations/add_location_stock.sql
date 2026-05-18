-- Migration: Add location_stock JSON column for multi-location Ready Channel support
-- Date: 2026-05-11
-- Description: Stores per-location piece counts as JSON for Ready Channel inventory
-- Example: {"Warehouse":10,"4783 CAWSEY Terrace SW, Edmonton AB T6W 5M7":20}

-- 1. Add location_stock column (TEXT to store JSON)
ALTER TABLE prixel_inventory
  ADD COLUMN location_stock TEXT DEFAULT NULL AFTER location;

-- 2. Seed existing Ready Channel data: copy current pieces into location_stock JSON
--    e.g. location=Warehouse, pieces=10 → location_stock={"Warehouse":10}
UPDATE prixel_inventory
SET location_stock = CONCAT('{"', COALESCE(location, 'Warehouse'), '":', COALESCE(pieces, 0), '}')
WHERE inventory_type = 'Ready Channel' AND COALESCE(pieces, 0) > 0;
