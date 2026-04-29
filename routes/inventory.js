import { Router } from 'express';
import db from '../db.js';

const router = Router();

const DUPLICATE_MESSAGE = 'This inventory already exists. Please edit existing inventory.';

const normalize = (value) => (value == null ? '' : String(value).trim());
const toNumericLength = (value) => {
  if (value == null || value === '') return null;
  const parsed = parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};
const isRollOrSlitted = (type) => type === 'Full Roll' || type === 'Slitted';
const isReadyChannel = (type) => type === 'Ready Channel';

async function findDuplicateForCreate(payload) {
  const supplier = normalize(payload.supplier);
  const colorName = normalize(payload.color_name);
  const colorCode = normalize(payload.color_code);
  const inventoryType = normalize(payload.inventory_type);

  if (isRollOrSlitted(inventoryType)) {
    const [rows] = await db.query(
      `SELECT id
       FROM prixel_inventory
       WHERE LOWER(TRIM(supplier)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_name)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))
         AND inventory_type = ?
       LIMIT 1`,
      [supplier, colorName, colorCode, inventoryType]
    );
    return rows[0] || null;
  }

  if (isReadyChannel(inventoryType)) {
    const length = toNumericLength(payload.length);
    const holeDistance = normalize(payload.hole_distance || '8');
    const [rows] = await db.query(
      `SELECT id
       FROM prixel_inventory
       WHERE LOWER(TRIM(supplier)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_name)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))
         AND inventory_type = ?
         AND CAST(length AS DECIMAL(10,2)) = CAST(? AS DECIMAL(10,2))
         AND LOWER(TRIM(COALESCE(hole_distance, ''))) = LOWER(TRIM(?))
       LIMIT 1`,
      [supplier, colorName, colorCode, inventoryType, length, holeDistance]
    );
    return rows[0] || null;
  }

  return null;
}

async function findDuplicateForUpdate(id, payload) {
  const supplier = normalize(payload.supplier);
  const colorName = normalize(payload.color_name);
  const colorCode = normalize(payload.color_code);
  const inventoryType = normalize(payload.inventory_type);

  if (isRollOrSlitted(inventoryType)) {
    const [rows] = await db.query(
      `SELECT id
       FROM prixel_inventory
       WHERE id <> ?
         AND LOWER(TRIM(supplier)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_name)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))
         AND inventory_type = ?
       LIMIT 1`,
      [id, supplier, colorName, colorCode, inventoryType]
    );
    return rows[0] || null;
  }

  if (isReadyChannel(inventoryType)) {
    const length = toNumericLength(payload.length);
    const holeDistance = normalize(payload.hole_distance || '8');
    const [rows] = await db.query(
      `SELECT id
       FROM prixel_inventory
       WHERE id <> ?
         AND LOWER(TRIM(supplier)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_name)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))
         AND inventory_type = ?
         AND CAST(length AS DECIMAL(10,2)) = CAST(? AS DECIMAL(10,2))
         AND LOWER(TRIM(COALESCE(hole_distance, ''))) = LOWER(TRIM(?))
       LIMIT 1`,
      [id, supplier, colorName, colorCode, inventoryType, length, holeDistance]
    );
    return rows[0] || null;
  }

  return null;
}

router.get('/', async (req, res) => {
  const { search, inventory_type, supplier, state } = req.query;

  let sql = `SELECT i.*,
    COALESCE(SUM(CASE WHEN h.status = 'held' THEN h.held_quantity ELSE 0 END), 0) as held_quantity,
    COALESCE(SUM(CASE WHEN h.status = 'held' THEN h.held_pieces ELSE 0 END), 0) as held_pieces,
    GREATEST(0, i.quantity - COALESCE(SUM(CASE WHEN h.status = 'held' THEN h.held_quantity ELSE 0 END), 0)) as available_quantity
   FROM prixel_inventory i
   LEFT JOIN prixel_inventory_holds h ON i.id = h.inventory_id`;
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push(`(
      i.supplier       LIKE ? OR
      i.color_name     LIKE ? OR
      i.color_code     LIKE ? OR
      i.state          LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  if (inventory_type) { conditions.push('i.inventory_type = ?'); params.push(inventory_type); }
  if (supplier) { conditions.push('i.supplier = ?'); params.push(supplier); }
  if (state) { conditions.push('i.state = ?'); params.push(state); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' GROUP BY i.id ORDER BY i.created_at DESC';

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
    supplier ?? null,
    color_name ?? null,
    color_code ?? null,
    price ?? null,
    state ?? null,
    channel_length ?? null,
    inventory_type,
    size ?? null,
    quantity ?? null,
    possible_feet ?? null,
    hole_distance ?? '8',
    pieces ?? null,
    length ?? null,
  ];

  try {
    const duplicate = await findDuplicateForCreate(req.body);
    if (duplicate) {
      return res.status(409).json({ message: DUPLICATE_MESSAGE });
    }

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

  try {
    const [existingRows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });
    const current = existingRows[0];

    const merged = {
      ...current,
      supplier: supplier !== undefined ? supplier : current.supplier,
      color_name: color_name !== undefined ? color_name : current.color_name,
      color_code: color_code !== undefined ? color_code : current.color_code,
      inventory_type: inventory_type !== undefined ? inventory_type : current.inventory_type,
      hole_distance: hole_distance !== undefined ? hole_distance : current.hole_distance,
      length: length !== undefined ? length : current.length,
    };

    const duplicate = await findDuplicateForUpdate(req.params.id, merged);
    if (duplicate) {
      return res.status(409).json({ message: DUPLICATE_MESSAGE });
    }

    const fields = [];
    const values = [];

    if (supplier !== undefined) { fields.push('supplier = ?'); values.push(supplier); }
    if (color_name !== undefined) { fields.push('color_name = ?'); values.push(color_name); }
    if (color_code !== undefined) { fields.push('color_code = ?'); values.push(color_code); }
    if (price !== undefined) { fields.push('price = ?'); values.push(price); }
    if (state !== undefined) { fields.push('state = ?'); values.push(state); }
    if (channel_length !== undefined) { fields.push('channel_length = ?'); values.push(channel_length); }
    if (inventory_type !== undefined) { fields.push('inventory_type = ?'); values.push(inventory_type); }
    if (size !== undefined) { fields.push('size = ?'); values.push(size); }
    if (quantity !== undefined) { fields.push('quantity = ?'); values.push(quantity); }
    if (possible_feet !== undefined) { fields.push('possible_feet = ?'); values.push(possible_feet); }
    if (hole_distance !== undefined) { fields.push('hole_distance = ?'); values.push(hole_distance); }
    if (pieces !== undefined) { fields.push('pieces = ?'); values.push(pieces); }
    if (length !== undefined) { fields.push('length = ?'); values.push(length); }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update.' });
    }

    values.push(req.params.id);

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
