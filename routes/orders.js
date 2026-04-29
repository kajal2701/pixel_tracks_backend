import { Router } from 'express';
import db from '../db.js';
import inventoryService from '../services/inventoryService.js';

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
      total: results.length,
      pending: results.filter((o) => o.order_status === 'Pending').length,
      confirmed: results.filter((o) => o.order_status === 'Confirmed').length,
      awaitingProduction: results.filter((o) => o.order_status === 'Awaiting production').length,
      awaitingMaterial: results.filter((o) => o.order_status === 'Awaiting material').length,
      cancelled: results.filter((o) => o.order_status === 'Cancelled').length,
      ready: results.filter((o) => o.order_status === 'Ready').length,
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
      delivery_method === 'pickup' ? (pickup_location ?? null) : null,
      delivery_method === 'pickup' ? (pickup_date ?? null) : null,
      delivery_method === 'delivery' ? (delivery_address ?? null) : null,
      order_status ?? 'Pending',
      notes ?? additional_notes ?? null,
      quick_access ?? 'yes',
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

  if (channel_type !== undefined) { fields.push('channel_type = ?'); values.push(channel_type); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color); }
  if (hole_distance !== undefined) { fields.push('hole_distance = ?'); values.push(hole_distance); }
  if (channel_length !== undefined) { fields.push('channel_length = ?'); values.push(channel_length); }
  if (total_length !== undefined) { fields.push('total_length = ?'); values.push(total_length); }
  if (total_pieces !== undefined) { fields.push('total_pieces = ?'); values.push(total_pieces); }
  if (final_length !== undefined) { fields.push('final_length = ?'); values.push(final_length); }
  if (delivery_method !== undefined) { fields.push('delivery_method = ?'); values.push(delivery_method); }
  if (pickup_location !== undefined) { fields.push('pickup_location = ?'); values.push(pickup_location); }
  if (pickup_date !== undefined) { fields.push('pickup_date = ?'); values.push(pickup_date); }
  if (delivery_address !== undefined) { fields.push('delivery_address = ?'); values.push(delivery_address); }
  if (order_status !== undefined) { fields.push('order_status = ?'); values.push(order_status); }
  if (notes !== undefined) { fields.push('additional_notes = ?'); values.push(notes); }
  else if (additional_notes !== undefined) { fields.push('additional_notes = ?'); values.push(additional_notes); }
  if (quick_access !== undefined) { fields.push('quick_access = ?'); values.push(quick_access); }

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

// ── POST /api/orders/:id/confirm ────────────────────────────────
router.post('/:id/confirm', async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM prixel_orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });

    const order = orders[0];
    const { color, channel_length, total_pieces } = order;

    // Calculate how much inventory is immediately satisfied by Ready Channel
    const data = await inventoryService.calculateInventorySatisfaction(color, channel_length, total_pieces);

    if (data.readyUsed > 0) {
      // Hold exactly the readyUsed pieces for this order. No production_id.
      await inventoryService.holdOrderInventory(order.order_id, color, channel_length, { readyPieces: data.readyUsed }, null);
    }

    // Update order status to Confirmed
    await db.query('UPDATE prixel_orders SET order_status = "Confirmed" WHERE id = ?', [req.params.id]);

    res.json({ message: 'Order confirmed and inventory held', data: { ...order, order_status: 'Confirmed' } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to confirm order', error: err.message });
  }
});

// ── PATCH /api/orders/:id/status ────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  const { order_status } = req.body;
  const allowed = [
    'Pending',
    'Confirmed',
    'Awaiting production',
    'Awaiting material',
    'Ready',
    'Cancelled',
  ];

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

    // ── When marked Ready: permanently deduct inventory ──────────
    if (order_status === 'Ready') {
      // Get the order's string order_id (e.g. ORD-xxx-x)
      const [orderRows] = await db.query('SELECT order_id FROM prixel_orders WHERE id = ?', [req.params.id]);
      if (orderRows.length > 0) {
        const { order_id } = orderRows[0];

        // Fetch all active holds for this order, with inventory type
        const [holds] = await db.query(
          `SELECT h.*, i.inventory_type FROM prixel_inventory_holds h
           JOIN prixel_inventory i ON i.id = h.inventory_id
           WHERE h.order_id = ? AND h.status = 'held'`,
          [order_id]
        );

        for (const hold of holds) {
          if (hold.inventory_type === 'Ready Channel') {
            if ((hold.held_pieces || 0) <= 0) continue;
            // Ready Channel: deduct pieces directly
            await db.query(
              'UPDATE prixel_inventory SET pieces = GREATEST(0, pieces - ?) WHERE id = ?',
              [hold.held_pieces, hold.inventory_id]
            );
          } else {
            // Slitted / Full Roll: deduct feet directly from held_feet
            let feetUsed = hold.held_feet || 0;
            if (feetUsed <= 0 && hold.held_pieces > 0) {
              let chLen = 0;
              if (hold.production_id) {
                const [prodRows] = await db.query('SELECT channel_length FROM prixel_production WHERE id = ?', [hold.production_id]);
                chLen = parseFloat(prodRows[0]?.channel_length) || 0;
              }
              feetUsed = hold.held_pieces * chLen;
            }
            if (feetUsed > 0) {
              const [inv] = await db.query('SELECT size, quantity FROM prixel_inventory WHERE id = ?', [hold.inventory_id]);
              if (inv.length > 0) {
                const currentSize = parseFloat(inv[0].size) || 0;
                const currentQty = parseFloat(inv[0].quantity) || 1;
                
                if (currentQty === 1) {
                  const newSize = Math.max(0, currentSize - feetUsed);
                  const newQty = newSize <= 0 ? 0 : 1;
                  await db.query('UPDATE prixel_inventory SET size = ?, quantity = ? WHERE id = ?', [newSize, newQty, hold.inventory_id]);
                } else {
                  let rollsTaken = hold.held_quantity || 0;
                  if (rollsTaken <= 0 && feetUsed > 0) {
                    rollsTaken = Math.ceil(feetUsed / currentSize);
                  }
                  if (rollsTaken <= 0) rollsTaken = 1;
                  
                  const totalFeetTaken = rollsTaken * currentSize;
                  const leftoverSize = totalFeetTaken - feetUsed;

                  const newQty = Math.max(0, currentQty - rollsTaken);
                  await db.query('UPDATE prixel_inventory SET quantity = ? WHERE id = ?', [newQty, hold.inventory_id]);

                  if (leftoverSize > 0 && leftoverSize < currentSize) {
                    await db.query(
                      `INSERT INTO prixel_inventory (supplier, color_name, color_code, inventory_type, quantity, size, state, hole_distance)
                       SELECT supplier, color_name, color_code, inventory_type, 1, ?, state, hole_distance
                       FROM prixel_inventory WHERE id = ?`,
                      [parseFloat(leftoverSize.toFixed(2)), hold.inventory_id]
                    );
                  }
                }
              }
            }
          }
        }

        // Mark all holds as 'used'
        await db.query(
          `UPDATE prixel_inventory_holds SET status = 'used' WHERE order_id = ? AND status = 'held'`,
          [order_id]
        );
      }
    }

    if (order_status === 'Cancelled') {
      const [orderRows] = await db.query('SELECT order_id FROM prixel_orders WHERE id = ?', [req.params.id]);
      const orderId = orderRows[0]?.order_id;
      await db.query(
        `UPDATE prixel_inventory_holds
         SET status = 'released'
         WHERE order_id = ? AND status = 'held'`,
        [orderId],
      );
    }

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
router.get('/:id/check-inventory', async (req, res) => {
  try {
    const [orders] = await db.query('SELECT * FROM prixel_orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });

    const { color, channel_length, total_pieces } = orders[0];
    const data = await inventoryService.calculateInventorySatisfaction(color, channel_length, total_pieces);
    res.json({ data });
  } catch (err) {
    res.status(err.message.includes('Missing') || err.message.includes('Invalid') ? 400 : 500)
      .json({ message: 'Failed to check inventory', error: err.message });
  }
});

// ── POST /api/orders/check-inventory-preview ──────────────────────
// For new orders (frontend check before saving)
router.post('/check-inventory-preview', async (req, res) => {
  try {
    const { color, channel_length, total_pieces } = req.body;
    const data = await inventoryService.calculateInventorySatisfaction(color, channel_length, total_pieces);
    res.json({ data });
  } catch (err) {
    res.status(err.message.includes('Missing') || err.message.includes('Invalid') ? 400 : 500)
      .json({ message: 'Failed to check inventory preview', error: err.message });
  }
});

// ── DELETE /api/orders/:id ──────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // 1. Get the string order_id before deleting
    const [orderRows] = await db.query('SELECT order_id FROM prixel_orders WHERE id = ?', [req.params.id]);
    if (orderRows.length === 0) return res.status(404).json({ message: 'Order not found' });

    const { order_id } = orderRows[0];

    // 2. Release all held inventory holds for this order
    await db.query(
      `UPDATE prixel_inventory_holds SET status = 'released' WHERE order_id = ? AND status = 'held'`,
      [order_id]
    );

    // 3. Cancel any linked production records & release their holds
    await db.query(
      `UPDATE prixel_production SET status = 'Cancelled' WHERE order_id = ? AND status IN ('Pending', 'In Progress')`,
      [order_id]
    );

    // 4. Delete the order
    await db.query('DELETE FROM prixel_orders WHERE id = ?', [req.params.id]);

    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete order', error: err.message });
  }
});

export default router;
