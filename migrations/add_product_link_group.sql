-- Group registry: each row = one color group
CREATE TABLE IF NOT EXISTS prixel_product_link_groups (
  id INT NOT NULL AUTO_INCREMENT,
  group_name VARCHAR(100) DEFAULT NULL COMMENT 'Human-readable name, e.g. "Pebble Family"',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- Link each product to its group (NULL = no group)
ALTER TABLE prixel_products 
  ADD COLUMN link_group_id INT DEFAULT NULL 
  COMMENT 'FK to prixel_product_link_groups.id — products in same group are interchangeable';
