-- Migration: add delivery fields to prixel_orders
-- Run once against your database before deploying the updated API

ALTER TABLE prixel_orders
  ADD COLUMN delivery_method   VARCHAR(20)  DEFAULT NULL AFTER final_length,
  ADD COLUMN pickup_location   VARCHAR(255) DEFAULT NULL AFTER delivery_method,
  ADD COLUMN pickup_date       DATE         DEFAULT NULL AFTER pickup_location,
  ADD COLUMN delivery_address  TEXT         DEFAULT NULL AFTER pickup_date;
