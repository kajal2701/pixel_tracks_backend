import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ── Helper: generate order_id ───────────────────────────────────
const generateOrderId = (customer_id) =>
  `ORD-${Math.floor(Date.now() / 1000)}-${customer_id}`;

// ── GET /api/orders ─────────────────────────────────────────────
// Query params: ?status=  ?customer_id=  ?search=  ?quick_access=
router.get('/', async (req, res) => {
  const { status, customer_id, search, quick_access } = req.query;

  let sql = `
    SELECT o.*, c.company_name, c.contact_name, c.email
    FROM prixel_orders o
    LEFT JOIN prixel_customers c ON c.id = o.customer_id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND o.order_status = ?';
    params.push(status);
  }
  if (customer_id) {
    sql += ' AND o.customer_id = ?';
    params.push(customer_id);
  }
  if (quick_access) {
    sql += ' AND o.quick_access = ?';
    params.push(quick_access);
  }
  if (search) {
    sql += ` AND (
      o.order_id        LIKE ? OR
      o.color           LIKE ? OR
      o.channel_type    LIKE ? OR
      o.order_status    LIKE ? OR
      c.company_name    LIKE ? OR
      c.contact_name    LIKE ?
    )`;
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }

  sql += ' ORDER BY o.created_at DESC';

  try {
    const [results] = await db.query(sql, params);

    const summary = {
      total:     results.length,
      pending:   results.filter((o) => o.order_status === 'Pending').length,
      confirmed: results.filter((o) => o.order_status === 'Confirmed').length,
      cancelled: results.filter((o) => o.order_status === 'Cancelled').length,
      ready:     results.filter((o) => o.order_status === 'Ready').length,
    };

    res.json({ data: results, summary });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch orders', error: err.message });
  }
});

// ── GET /api/orders/:id ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const sql = `
    SELECT o.*, c.company_name, c.contact_name, c.email
    FROM prixel_orders o
    LEFT JOIN prixel_customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `;
  try {
    const [results] = await db.query(sql, [req.params.id]);
    if (results.length === 0) return res.status(404).json({ message: 'Order not found' });
    res.json({ data: results[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch order', error: err.message });
  }
});

// ── POST /api/orders ────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    customer_id, channel_type, color, hole_distance,
    channel_length, total_length, total_pieces, final_length,
    order_status, additional_notes, notes, quick_access,
    delivery_method, pickup_location, pickup_date, delivery_address,
  } = req.body;

  if (!customer_id || !channel_type || !color || !hole_distance ||
      channel_length == null || total_length == null ||
      total_pieces == null || final_length == null) {
    return res.status(400).json({
      message: 'customer_id, channel_type, color, hole_distance, channel_length, total_length, total_pieces, and final_length are required.',
    });
  }

  if (!delivery_method || !['pickup', 'delivery'].includes(delivery_method)) {
    return res.status(400).json({ message: 'delivery_method must be "pickup" or "delivery".' });
  }
  if (delivery_method === 'pickup' && !pickup_location) {
    return res.status(400).json({ message: 'pickup_location is required when delivery_method is "pickup".' });
  }
  if (delivery_method === 'delivery' && !delivery_address) {
    return res.status(400).json({ message: 'delivery_address is required when delivery_method is "delivery".' });
  }

  try {
    const [customers] = await db.query('SELECT id FROM prixel_customers WHERE id = ?', [customer_id]);
    if (customers.length === 0) return res.status(404).json({ message: 'Customer not found.' });

    const order_id = generateOrderId(customer_id);

    const sql = `
      INSERT INTO prixel_orders
        (order_id, customer_id, channel_type, color, hole_distance,
         channel_length, total_length, total_pieces, final_length,
         delivery_method, pickup_location, pickup_date, delivery_address,
         order_status, additional_notes, quick_access)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      order_id, customer_id, channel_type, color, hole_distance,
      channel_length, total_length, total_pieces, final_length,
      delivery_method,
      delivery_method === 'pickup'   ? (pickup_location ?? null)   : null,
      delivery_method === 'pickup'   ? (pickup_date     ?? null)   : null,
      delivery_method === 'delivery' ? (delivery_address ?? null)  : null,
      order_status                   ?? 'Pending',
      notes ?? additional_notes      ?? null,
      quick_access                   ?? 'yes',
    ];

    const [result] = await db.query(sql, values);

    const [rows] = await db.query(
      `SELECT o.*, c.company_name, c.contact_name, c.email
       FROM prixel_orders o
       LEFT JOIN prixel_customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [result.insertId],
    );

    res.status(201).json({ message: 'Order created successfully', data: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Order ID conflict. Please retry.' });
    }
    res.status(500).json({ message: 'Failed to create order', error: err.message });
  }
});

// ── PUT /api/orders/:id ─────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const {
    channel_type, color, hole_distance, channel_length,
    total_length, total_pieces, final_length,
    order_status, additional_notes, notes, quick_access,
    delivery_method, pickup_location, pickup_date, delivery_address,
  } = req.body;

  const fields = [];
  const values = [];

  if (channel_type       !== undefined) { fields.push('channel_type = ?');       values.push(channel_type); }
  if (color              !== undefined) { fields.push('color = ?');              values.push(color); }
  if (hole_distance      !== undefined) { fields.push('hole_distance = ?');      values.push(hole_distance); }
  if (channel_length     !== undefined) { fields.push('channel_length = ?');     values.push(channel_length); }
  if (total_length       !== undefined) { fields.push('total_length = ?');       values.push(total_length); }
  if (total_pieces       !== undefined) { fields.push('total_pieces = ?');       values.push(total_pieces); }
  if (final_length       !== undefined) { fields.push('final_length = ?');       values.push(final_length); }
  if (delivery_method    !== undefined) { fields.push('delivery_method = ?');    values.push(delivery_method); }
  if (pickup_location    !== undefined) { fields.push('pickup_location = ?');    values.push(pickup_location); }
  if (pickup_date        !== undefined) { fields.push('pickup_date = ?');        values.push(pickup_date); }
  if (delivery_address   !== undefined) { fields.push('delivery_address = ?');   values.push(delivery_address); }
  if (order_status       !== undefined) { fields.push('order_status = ?');       values.push(order_status); }
  if (notes              !== undefined) { fields.push('additional_notes = ?');   values.push(notes); }
  else if (additional_notes !== undefined) { fields.push('additional_notes = ?'); values.push(additional_notes); }
  if (quick_access       !== undefined) { fields.push('quick_access = ?');       values.push(quick_access); }

  if (fields.length === 0) {
    return res.status(400).json({ message: 'No fields provided to update.' });
  }

  values.push(req.params.id);

  try {
    const [result] = await db.query(
      `UPDATE prixel_orders SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Order not found' });

    const [rows] = await db.query(
      `SELECT o.*, c.company_name, c.contact_name, c.email
       FROM prixel_orders o
       LEFT JOIN prixel_customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [req.params.id],
    );
    res.json({ message: 'Order updated successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update order', error: err.message });
  }
});

// ── PATCH /api/orders/:id/status ────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  const { order_status } = req.body;
  const allowed = ['Pending', 'Confirmed', 'Ready', 'Cancelled'];

  if (!order_status) {
    return res.status(400).json({ message: 'order_status is required.' });
  }
  if (!allowed.includes(order_status)) {
    return res.status(400).json({ message: `order_status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const [result] = await db.query(
      'UPDATE prixel_orders SET order_status = ? WHERE id = ?',
      [order_status, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Order not found' });

    const [rows] = await db.query(
      `SELECT o.*, c.company_name, c.contact_name, c.email
       FROM prixel_orders o
       LEFT JOIN prixel_customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [req.params.id],
    );
    res.json({ message: `Order status updated to ${order_status}`, data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update status', error: err.message });
  }
});

// ── PATCH /api/orders/:id/notes ─────────────────────────────────
router.patch('/:id/notes', async (req, res) => {
  const { additional_notes } = req.body;

  if (additional_notes === undefined) {
    return res.status(400).json({ message: 'additional_notes is required.' });
  }

  try {
    const [result] = await db.query(
      'UPDATE prixel_orders SET additional_notes = ? WHERE id = ?',
      [additional_notes, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Order not found' });
    res.json({ message: 'Notes updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update notes', error: err.message });
  }
});

// ── GET /api/orders/:id/check-inventory ─────────────────────────
// Cascading inventory availability check:
//   1. Ready Channel (same supplier, color, length) → count pieces
//   2. Slitted       (same supplier, color)         → calculate pieces from material
//   3. Full Roll     (same supplier, color)         → calculate pieces from material
router.get('/:id/check-inventory', async (req, res) => {
  try {
    // ── 1. Fetch the order ──
    const [orders] = await db.query(
      'SELECT * FROM prixel_orders WHERE id = ?',
      [req.params.id],
    );
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orders[0];
    const { color, channel_length, total_pieces } = order;

    if (!color || channel_length == null || !total_pieces) {
      return res.status(400).json({
        message: 'Order is missing required fields (color, channel_length, or total_pieces).',
      });
    }

    // ── 2. Parse color string: "color_name (color_code) (supplier)" ──
    const parsed = parseOrderColor(color);

    if (!parsed.supplier || !parsed.colorName) {
      return res.json({
        data: {
          isFullySatisfied: false,
          error: 'Could not extract supplier or color from order color field.',
          parsedColor: parsed,
          orderQty: total_pieces,
          readyUsed: 0, readyAvailable: 0,
          slittedUsed: 0, slittedTotalFeet: 0, slittedPossiblePieces: 0,
          fullRollUsed: 0, fullRollTotalFeet: 0, fullRollPossiblePieces: 0,
          totalSatisfied: 0,
          shortage: total_pieces,
        },
      });
    }

    // ── 3. Query matching inventory (same supplier + color_name) ──
    const [inventory] = await db.query(
      `SELECT * FROM prixel_inventory
       WHERE LOWER(TRIM(supplier)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_name)) = LOWER(TRIM(?))`,
      [parsed.supplier, parsed.colorName],
    );

    const orderPieceLength = parseFloat(channel_length) || 0;

    if (orderPieceLength <= 0) {
      return res.status(400).json({ message: `Invalid channel length: ${channel_length}` });
    }

    let remainingQty = total_pieces;

    // ── Step 1: Ready Channel ──
    let readyAvailable = 0;
    inventory
      .filter((i) => i.inventory_type === 'Ready Channel')
      .forEach((item) => {
        const itemLength = parseFloat(item.length) || 0;
        if (itemLength === orderPieceLength) {
          readyAvailable += parseInt(item.pieces, 10) || 0;
        }
      });
    const readyUsed = Math.min(remainingQty, readyAvailable);
    remainingQty -= readyUsed;

    // ── Step 2: Slitted ──
    let slittedTotalFeet = 0;
    inventory
      .filter((i) => i.inventory_type === 'Slitted')
      .forEach((item) => {
        const size = parseFloat(item.size) || 0;
        const qty  = parseFloat(item.quantity) || 0;
        slittedTotalFeet += size * qty;
      });
    const slittedPossiblePieces = Math.floor(slittedTotalFeet / orderPieceLength);
    const slittedUsed = Math.min(remainingQty, slittedPossiblePieces);
    remainingQty -= slittedUsed;

    // ── Step 3: Full Roll ──
    let fullRollTotalFeet = 0;
    inventory
      .filter((i) => i.inventory_type === 'Full Roll')
      .forEach((item) => {
        const size = parseFloat(item.size) || 0;
        const qty  = parseFloat(item.quantity) || 0;
        fullRollTotalFeet += size * qty;
      });
    const fullRollPossiblePieces = Math.floor(fullRollTotalFeet / orderPieceLength);
    const fullRollUsed = Math.min(remainingQty, fullRollPossiblePieces);
    remainingQty -= fullRollUsed;

    // ── 4. Return result ──
    res.json({
      data: {
        isFullySatisfied: remainingQty === 0,
        error: null,
        orderQty: total_pieces,
        parsedColor: parsed,
        readyUsed,
        readyAvailable,
        slittedUsed,
        slittedTotalFeet: parseFloat(slittedTotalFeet.toFixed(2)),
        slittedPossiblePieces,
        fullRollUsed,
        fullRollTotalFeet: parseFloat(fullRollTotalFeet.toFixed(2)),
        fullRollPossiblePieces,
        totalSatisfied: readyUsed + slittedUsed + fullRollUsed,
        shortage: remainingQty,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to check inventory', error: err.message });
  }
});

// ── Helper: parse order color string ────────────────────────────
// Format: "color_name (color_code) (supplier)"
// e.g.    "red (RE-098) (xyz supplier)"
function parseOrderColor(colorStr) {
  if (!colorStr) return { colorName: '', colorCode: '', supplier: '' };

  const parts = [];
  let remaining = colorStr;

  // Extract parenthesized groups from right to left
  while (true) {
    const match = remaining.match(/^(.*)\(([^)]+)\)\s*$/);
    if (!match) break;
    parts.unshift(match[2].trim());
    remaining = match[1].trim();
  }

  const colorName = remaining.trim();

  if (parts.length >= 2) {
    return { colorName, colorCode: parts[0], supplier: parts[1] };
  } else if (parts.length === 1) {
    return { colorName, colorCode: '', supplier: parts[0] };
  }

  return { colorName, colorCode: '', supplier: '' };
}

// ── DELETE /api/orders/:id ──────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM prixel_orders WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Order not found' });
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete order', error: err.message });
  }
});

export default router;
