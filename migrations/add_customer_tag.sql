-- Migration: Add customer_tag column to prixel_orders
-- Run this in phpMyAdmin or your MySQL client

ALTER TABLE `prixel_orders`
  ADD COLUMN `customer_tag` varchar(100) DEFAULT NULL
  AFTER `customer_id`;
