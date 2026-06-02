-- Add delivery_address column to prixel_customers table
-- Stores the customer's latest delivery address for auto-fill on future orders
ALTER TABLE prixel_customers ADD COLUMN delivery_address TEXT DEFAULT NULL;
