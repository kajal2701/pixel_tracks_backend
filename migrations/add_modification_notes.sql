-- Migration: Add modification_notes column to prixel_orders
-- Purpose: Store modification requests when admin can't confirm an order
-- Run this on the database before deploying

ALTER TABLE prixel_orders
ADD COLUMN modification_notes TEXT DEFAULT NULL;
