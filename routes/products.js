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
    sql += ' AND (product_name LIKE ? OR manufacturer LIKE ? OR color LIKE ?)';
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
  const { product_name, color, color_code, manufacturer, price, stock } = req.body;

  if (!product_name || price == null) {
    return res.status(400).json({ message: 'product_name and price are required.' });
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
      INSERT INTO prixel_products (product_name, color, color_code, manufacturer, price, stock)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const values = [
      product_name,
      color        ?? null,
      color_code   ?? null,
      manufacturer ?? null,
      price,
      stock        ?? 0,
    ];

    const [result] = await db.query(sql, values);
    const [rows] = await db.query('SELECT * FROM prixel_products WHERE id = ?', [result.insertId]);

    res.status(201).json({ message: 'Product created successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create product', error: err.message });
  }
});

// ── PUT /api/products/:id ────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { product_name, color, color_code, manufacturer, price, stock } = req.body;

  const fields = [];
  const values = [];

  if (product_name !== undefined) { fields.push('product_name = ?');  values.push(product_name); }
  if (color        !== undefined) { fields.push('color = ?');         values.push(color); }
  if (color_code   !== undefined) { fields.push('color_code = ?');    values.push(color_code); }
  if (manufacturer !== undefined) { fields.push('manufacturer = ?');  values.push(manufacturer); }
  if (price        !== undefined) { fields.push('price = ?');         values.push(price); }
  if (stock        !== undefined) { fields.push('stock = ?');         values.push(stock); }

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
