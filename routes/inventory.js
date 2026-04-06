import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ── GET /api/inventory ──────────────────────────────────────────
router.get('/', async (req, res) => {
  const { search, inventory_type, supplier, state } = req.query;

  let sql = 'SELECT * FROM prixel_inventory';
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push(`(
      supplier       LIKE ? OR
      color_name     LIKE ? OR
      color_code     LIKE ? OR
      state          LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  if (inventory_type) { conditions.push('inventory_type = ?'); params.push(inventory_type); }
  if (supplier)       { conditions.push('supplier = ?');       params.push(supplier); }
  if (state)          { conditions.push('state = ?');          params.push(state); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  try {
    const [results] = await db.query(sql, params);
    res.json({ data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch inventory', error: err.message });
  }
});

// ── GET /api/inventory/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [req.params.id]);
    if (results.length === 0) return res.status(404).json({ message: 'Inventory item not found' });
    res.json({ data: results[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch inventory item', error: err.message });
  }
});

// ── POST /api/inventory ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    supplier, color_name, color_code, price, state, channel_length,
    inventory_type, size, quantity, possible_feet,
    hole_distance, pieces, length,
  } = req.body;

  if (!inventory_type) {
    return res.status(400).json({ message: 'inventory_type is required.' });
  }

  const validTypes = ['Full Roll', 'Slitted', 'Ready Channel'];
  if (!validTypes.includes(inventory_type)) {
    return res.status(400).json({ message: `inventory_type must be one of: ${validTypes.join(', ')}` });
  }

  const sql = `
    INSERT INTO prixel_inventory
      (supplier, color_name, color_code, price, state, channel_length,
       inventory_type, size, quantity, possible_feet,
       hole_distance, pieces, length)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    supplier       ?? null,
    color_name     ?? null,
    color_code     ?? null,
    price          ?? null,
    state          ?? null,
    channel_length ?? null,
    inventory_type,
    size           ?? null,
    quantity       ?? null,
    possible_feet  ?? null,
    hole_distance  ?? '8/9 inch',
    pieces         ?? null,
    length         ?? null,
  ];

  try {
    const [result] = await db.query(sql, values);
    const [rows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [result.insertId]);
    res.status(201).json({ message: 'Inventory item created successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create inventory item', error: err.message });
  }
});

// ── PUT /api/inventory/:id ──────────────────────────────────────
router.put('/:id', async (req, res) => {
  const {
    supplier, color_name, color_code, price, state, channel_length,
    inventory_type, size, quantity, possible_feet,
    hole_distance, pieces, length,
  } = req.body;

  if (inventory_type !== undefined) {
    const validTypes = ['Full Roll', 'Slitted', 'Ready Channel'];
    if (!validTypes.includes(inventory_type)) {
      return res.status(400).json({ message: `inventory_type must be one of: ${validTypes.join(', ')}` });
    }
  }

  const fields = [];
  const values = [];

  if (supplier        !== undefined) { fields.push('supplier = ?');        values.push(supplier); }
  if (color_name      !== undefined) { fields.push('color_name = ?');      values.push(color_name); }
  if (color_code      !== undefined) { fields.push('color_code = ?');      values.push(color_code); }
  if (price           !== undefined) { fields.push('price = ?');           values.push(price); }
  if (state           !== undefined) { fields.push('state = ?');           values.push(state); }
  if (channel_length  !== undefined) { fields.push('channel_length = ?');  values.push(channel_length); }
  if (inventory_type  !== undefined) { fields.push('inventory_type = ?');  values.push(inventory_type); }
  if (size            !== undefined) { fields.push('size = ?');            values.push(size); }
  if (quantity        !== undefined) { fields.push('quantity = ?');        values.push(quantity); }
  if (possible_feet   !== undefined) { fields.push('possible_feet = ?');   values.push(possible_feet); }
  if (hole_distance   !== undefined) { fields.push('hole_distance = ?');   values.push(hole_distance); }
  if (pieces          !== undefined) { fields.push('pieces = ?');          values.push(pieces); }
  if (length          !== undefined) { fields.push('length = ?');          values.push(length); }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'No fields provided to update.' });
  }

  values.push(req.params.id);

  try {
    const [result] = await db.query(
      `UPDATE prixel_inventory SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Inventory item not found' });

    const [rows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [req.params.id]);
    res.json({ message: 'Inventory item updated successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update inventory item', error: err.message });
  }
});

// ── DELETE /api/inventory/:id ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM prixel_inventory WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Inventory item not found' });
    res.json({ message: 'Inventory item deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete inventory item', error: err.message });
  }
});

export default router;
