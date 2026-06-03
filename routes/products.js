import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ── GET /api/products ────────────────────────────────────────────
// Query params: ?search=  ?color=
router.get('/', async (req, res) => {
  const { search, color } = req.query;

  let sql = 'SELECT * FROM prixel_products WHERE 1=1';
  const params = [];

  if (color) {
    sql += ' AND color = ?';
    params.push(color);
  }
  if (search) {
    sql += ' AND (manufacturer LIKE ? OR color LIKE ? OR color_code LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  sql += ' ORDER BY created_at DESC';

  try {
    const [results] = await db.query(sql, params);
    res.json({ data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch products', error: err.message });
  }
});

// ── GET /api/products/:id ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM prixel_products WHERE id = ?', [req.params.id]);
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
