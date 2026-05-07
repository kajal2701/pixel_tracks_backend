-- Migration: Add customer_notes column to prixel_orders
-- Keeps additional_notes for admin, adds customer_notes for customer input at order creation
-- Date: 2026-05-01

ALTER TABLE prixel_orders
  ADD COLUMN customer_notes TEXT DEFAULT NULL AFTER additional_notes;
