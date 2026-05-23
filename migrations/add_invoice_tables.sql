-- ============================================================
-- Invoice Module Migration
-- Run on: portalcanstarlig_pixeltracks
-- ============================================================

-- 1. Add one JSON pricing column to prixel_customers
--    Stores: {"10h": 2.50, "9h": 2.75, "8h": 3.00}
--    Keys: "10h" = 6.67ft channel, "9h" = 6.00ft, "8h" = 5.33ft
ALTER TABLE `prixel_customers`
  ADD COLUMN IF NOT EXISTS `channel_pricing` JSON DEFAULT NULL COMMENT 'Price per foot per channel length: {"10h":2.50,"9h":2.75,"8h":3.00}';

-- 2. Add invoice_id to prixel_orders for quick lookup
--    NULL = no invoice yet, set when invoice is generated
ALTER TABLE `prixel_orders`
  ADD COLUMN IF NOT EXISTS `invoice_id` INT DEFAULT NULL COMMENT 'FK to prixel_invoices.id — set when invoice is generated';


-- 2. Create prixel_invoices table
--    Admin selects completed orders and generates an invoice
--    Supports single-order or multi-order invoices
CREATE TABLE IF NOT EXISTS `prixel_invoices` (
  `id`               INT AUTO_INCREMENT PRIMARY KEY,
  `invoice_number`   VARCHAR(50)    NOT NULL UNIQUE  COMMENT 'e.g. INV-1716100000-3',
  `customer_id`      INT            NOT NULL         COMMENT 'FK to prixel_customers.id',
  `order_ids`        JSON           DEFAULT NULL     COMMENT 'Array of prixel_orders.id values: [1] or [1, 5, 12]',
  `order_details`    JSON           DEFAULT NULL     COMMENT 'Per-order billing snapshot: [{order_id, unit_price, final_length, subtotal}]',

  -- Extra work (invoice-level, not order-level)
  `extra_work`       JSON           DEFAULT NULL     COMMENT 'Extra work line items: [{description, qty, unit_price}]',
  `extra_work_total` DECIMAL(10,2)  DEFAULT 0        COMMENT 'Sum of extra work line totals',

  -- Billing fields (editable from Invoice Edit / Order View)
  `discount_pct`     DECIMAL(5,2)   DEFAULT 0        COMMENT 'Discount % applied',
  `discount_amount`  DECIMAL(10,2)  DEFAULT 0        COMMENT 'Computed discount dollar amount',
  `gst_pct`          DECIMAL(5,2)   DEFAULT 5        COMMENT 'GST % applied',
  `gst_amount`       DECIMAL(10,2)  DEFAULT 0        COMMENT 'Computed GST dollar amount',
  `total_amount`     DECIMAL(10,2)  DEFAULT 0        COMMENT 'Grand total after discount + GST',

  `status`           ENUM('Draft','Sent','Paid','Cancelled') DEFAULT 'Draft',

  `sent_at`          DATETIME       DEFAULT NULL,
  `created_at`       TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_status`      (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
