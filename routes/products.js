import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ── GET /api/products ────────────────────────────────────────────
// Query params: ?search=  ?color=
router.get('/', async (req, res) => {
  const { search, color } = req.query;

  let sql = `
    SELECT p.*, g.group_name 
    FROM prixel_products p 
    LEFT JOIN prixel_product_link_groups g ON p.link_group_id = g.id 
    WHERE 1=1
  `;
  const params = [];

  if (color) {
    sql += ' AND p.color = ?';
    params.push(color);
  }
  if (search) {
    sql += ' AND (p.manufacturer LIKE ? OR p.color LIKE ? OR p.color_code LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  sql += ' ORDER BY p.created_at DESC';

  try {
    const [results] = await db.query(sql, params);
    res.json({ data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch products', error: err.message });
  }
});

// ── GET /api/products/link-groups ────────────────────────────────
router.get('/link-groups', async (req, res) => {
  try {
    const [groups] = await db.query('SELECT * FROM prixel_product_link_groups ORDER BY created_at DESC');
    const [products] = await db.query('SELECT id, manufacturer, color, color_code, link_group_id FROM prixel_products WHERE link_group_id IS NOT NULL');
    
    // Group products by link_group_id
    const productsByGroup = products.reduce((acc, p) => {
      if (!acc[p.link_group_id]) acc[p.link_group_id] = [];
      acc[p.link_group_id].push(p);
      return acc;
    }, {});

    const result = groups.map(g => ({
      ...g,
      products: productsByGroup[g.id] || []
    }));

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch link groups', error: err.message });
  }
});

// ── POST /api/products/link-groups ───────────────────────────────
router.post('/link-groups', async (req, res) => {
  const { group_name, product_ids } = req.body;
  if (!product_ids || !Array.isArray(product_ids) || product_ids.length < 2) {
    return res.status(400).json({ message: 'At least two product IDs are required.' });
  }

  try {
    const [result] = await db.query('INSERT INTO prixel_product_link_groups (group_name) VALUES (?)', [group_name || null]);
    const groupId = result.insertId;

    await db.query('UPDATE prixel_products SET link_group_id = ? WHERE id IN (?)', [groupId, product_ids]);
    
    res.status(201).json({ message: 'Group created successfully', data: { id: groupId, group_name } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create link group', error: err.message });
  }
});

// ── PUT /api/products/link-groups/:id ────────────────────────────
router.put('/link-groups/:id', async (req, res) => {
  const { group_name, product_ids } = req.body;
  const groupId = req.params.id;

  try {
    if (group_name !== undefined) {
      await db.query('UPDATE prixel_product_link_groups SET group_name = ? WHERE id = ?', [group_name || null, groupId]);
    }
    
    if (product_ids && Array.isArray(product_ids)) {
      // Clear old products
      await db.query('UPDATE prixel_products SET link_group_id = NULL WHERE link_group_id = ?', [groupId]);
      // Set new products
      if (product_ids.length > 0) {
        await db.query('UPDATE prixel_products SET link_group_id = ? WHERE id IN (?)', [groupId, product_ids]);
      }
    }
    
    res.json({ message: 'Group updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update link group', error: err.message });
  }
});

// ── DELETE /api/products/link-groups/:id ─────────────────────────
router.delete('/link-groups/:id', async (req, res) => {
  const groupId = req.params.id;
  try {
    await db.query('UPDATE prixel_products SET link_group_id = NULL WHERE link_group_id = ?', [groupId]);
    await db.query('DELETE FROM prixel_product_link_groups WHERE id = ?', [groupId]);
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete link group', error: err.message });
  }
});


// ── GET /api/products/:id ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, g.group_name 
      FROM prixel_products p 
      LEFT JOIN prixel_product_link_groups g ON p.link_group_id = g.id 
      WHERE p.id = ?
    `, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch product', error: err.message });
  }
});

// ── POST /api/products ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const { product_name, color, color_code, manufacturer, price, stock,
    full_roll_length, slits_per_roll, slitted_roll_length } = req.body;

  if (!manufacturer || !color) {
    return res.status(400).json({ message: 'manufacturer and color are required.' });
  }

  try {
    // Check for duplicate product (color_code + manufacturer combination)
    if (color_code && manufacturer) {
      const [existing] = await db.query(
        'SELECT id FROM prixel_products WHERE color_code = ? AND manufacturer = ?',
        [color_code, manufacturer]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          message: 'Product with this color code and manufacturer already exists',
          existingProductId: existing[0].id
        });
      }
    }

    const sql = `
      INSERT INTO prixel_products (product_name, color, color_code, manufacturer, price, stock,
                                   full_roll_length, slits_per_roll, slitted_roll_length)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      product_name ?? '',
      color ?? null,
      color_code ?? null,
      manufacturer ?? null,
      price ?? 0,
      stock ?? 0,
      full_roll_length ?? 98.00,
      slits_per_roll ?? 6,
      slitted_roll_length ?? 98.00,
    ];

    const [result] = await db.query(sql, values);

    // Auto-create 0 qty inventory for the new product
    await db.query(
      `INSERT INTO prixel_inventory 
       (supplier, color_name, color_code, inventory_type, quantity, size, state, location)
       VALUES (?, ?, ?, 'Full Roll', 0, ?, 'active', 'Warehouse')`,
      [manufacturer ?? null, color ?? null, color_code ?? null, full_roll_length ?? 98.00]
    );

    const [rows] = await db.query('SELECT * FROM prixel_products WHERE id = ?', [result.insertId]);

    res.status(201).json({ message: 'Product created successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create product', error: err.message });
  }
});

// ── PUT /api/products/:id ────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { product_name, color, color_code, manufacturer, price, stock,
    full_roll_length, slits_per_roll, slitted_roll_length } = req.body;

  const fields = [];
  const values = [];

  if (product_name !== undefined) { fields.push('product_name = ?'); values.push(product_name); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color); }
  if (color_code !== undefined) { fields.push('color_code = ?'); values.push(color_code); }
  if (manufacturer !== undefined) { fields.push('manufacturer = ?'); values.push(manufacturer); }
  if (price !== undefined) { fields.push('price = ?'); values.push(price); }
  if (stock !== undefined) { fields.push('stock = ?'); values.push(stock); }
  if (full_roll_length !== undefined) { fields.push('full_roll_length = ?'); values.push(full_roll_length); }
  if (slits_per_roll !== undefined) { fields.push('slits_per_roll = ?'); values.push(slits_per_roll); }
  if (slitted_roll_length !== undefined) { fields.push('slitted_roll_length = ?'); values.push(slitted_roll_length); }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'No fields provided to update.' });
  }

  try {
    // Check for duplicate product (color_code + manufacturer combination) when updating these fields
    if ((color_code !== undefined || manufacturer !== undefined) && color_code && manufacturer) {
      const [existing] = await db.query(
        'SELECT id FROM prixel_products WHERE color_code = ? AND manufacturer = ? AND id != ?',
        [color_code, manufacturer, req.params.id]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          message: 'Product with this color code and manufacturer already exists',
          existingProductId: existing[0].id
        });
      }
    }

    values.push(req.params.id);

    const [result] = await db.query(
      `UPDATE prixel_products SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Product not found' });

    const [rows] = await db.query('SELECT * FROM prixel_products WHERE id = ?', [req.params.id]);
    res.json({ message: 'Product updated successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update product', error: err.message });
  }
});

// ── DELETE /api/products/:id ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM prixel_products WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete product', error: err.message });
  }
});

export default router;
