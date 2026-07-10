import { Router } from 'express';
import db from '../db.js';
import inventoryService from '../services/inventoryService.js';

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

// ── GET /api/inventory/holds ────────────────────────────────────
// use this api for show hold inventory in confirm pop up eye icon 
router.get('/holds', async (req, res) => {
  try {
    const { color, channel_length } = req.query;
    if (!color || !channel_length) {
      return res.status(400).json({ message: 'color and channel_length are required' });
    }
    const holds = await inventoryService.getHoldsByColor(color, channel_length);
    res.json({ data: holds });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch holds', error: err.message });
  }
});

// ── GET /api/inventory/:id/stock-breakdown ──────────────────────
// Returns per-location stock with dispatched-hold info for a Ready Channel item
// inventory module to get locatin wise stock when click on eye for ready channel only
router.get('/:id/stock-breakdown', async (req, res) => {
  try {
    const [invRows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [req.params.id]);
    if (invRows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    const item = invRows[0];
    if (item.inventory_type !== 'Ready Channel') {
      return res.status(400).json({ message: 'Stock breakdown is only available for Ready Channel inventory' });
    }

    const stock = JSON.parse(item.location_stock || '{}');

    // Find dispatched holds: orders at 'Ready for Pickup/Delivery' that have pieces committed at specific locations
    // Pickup orders: pieces committed at pickup_location
    // Delivery orders: pieces committed at source_locations
    const [dispatchedHolds] = await db.query(
      `SELECT h.held_pieces, o.delivery_method, o.pickup_location, o.source_locations
       FROM prixel_inventory_holds h
       JOIN prixel_orders o ON o.order_id = h.order_id
       WHERE h.inventory_id = ?
         AND h.status = 'held'
         AND o.order_status = 'Ready for Pickup/Delivery'`,
      [req.params.id]
    );

    // Build map: location → dispatched held pieces
    const dispatchedHeldMap = {};
    for (const hold of dispatchedHolds) {
      const heldPieces = parseInt(hold.held_pieces) || 0;
      if (heldPieces <= 0) continue;

      if (hold.delivery_method === 'pickup' && hold.pickup_location) {
        dispatchedHeldMap[hold.pickup_location] = (dispatchedHeldMap[hold.pickup_location] || 0) + heldPieces;
      } else if (hold.source_locations) {
        let left = heldPieces;
        const sourceLocs = typeof hold.source_locations === 'string' ? JSON.parse(hold.source_locations) : hold.source_locations;
        for (const src of sourceLocs) {
          if (left <= 0) break;
          const piecesToTake = Math.min(left, parseInt(src.pieces) || 0);
          if (piecesToTake > 0 && src.location) {
            dispatchedHeldMap[src.location] = (dispatchedHeldMap[src.location] || 0) + piecesToTake;
            left -= piecesToTake;
          }
        }
      }
    }

    // Build response
    const breakdown = {};
    for (const [location, pieces] of Object.entries(stock)) {
      const total = parseInt(pieces) || 0;
      const dispatchedHeld = dispatchedHeldMap[location] || 0;
      breakdown[location] = {
        total,
        dispatched_held: Math.min(dispatchedHeld, total),
        available: Math.max(0, total - dispatchedHeld),
      };
    }

    res.json({ data: breakdown });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stock breakdown', error: err.message });
  }
});

// ── POST /api/inventory/convert-color ───────────────────────────
router.post('/convert-color', async (req, res) => {
  const { from_id, to_color_name, to_color_code, quantity } = req.body;

  if (!from_id || !to_color_name || !to_color_code || !quantity) {
    return res.status(400).json({ message: 'Missing required fields (from_id, to_color_name, to_color_code, quantity)' });
  }

  const qtyToTransfer = parseInt(quantity, 10);
  if (qtyToTransfer <= 0) {
    return res.status(400).json({ message: 'Quantity must be a positive integer' });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Fetch the source inventory item with its held quantity
    const [sourceRows] = await connection.query(`
      SELECT i.*, 
        COALESCE(SUM(CASE WHEN h.status = 'held' THEN h.held_quantity ELSE 0 END), 0) as held_quantity
      FROM prixel_inventory i
      LEFT JOIN prixel_inventory_holds h ON i.id = h.inventory_id
      WHERE i.id = ?
      GROUP BY i.id
      FOR UPDATE
    `, [from_id]);
    if (sourceRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Source inventory item not found' });
    }
    const sourceItem = sourceRows[0];

    // Ensure it's Full Roll or Slitted
    if (!isRollOrSlitted(sourceItem.inventory_type)) {
      await connection.rollback();
      return res.status(400).json({ message: 'Color conversion is only supported for Full Roll or Slitted inventory' });
    }

    // Ensure sufficient available quantity
    const totalQty = parseInt(sourceItem.quantity, 10) || 0;
    const heldQty = parseInt(sourceItem.held_quantity, 10) || 0;
    const availableQty = Math.max(0, totalQty - heldQty);
    if (qtyToTransfer > availableQty) {
      await connection.rollback();
      return res.status(400).json({ message: `Insufficient quantity. Only ${availableQty} available.` });
    }

    // 2. Deduct quantity from source
    await connection.query('UPDATE prixel_inventory SET quantity = quantity - ? WHERE id = ?', [qtyToTransfer, from_id]);

    // 3. Check if target inventory exists
    const [targetRows] = await connection.query(
      `SELECT * FROM prixel_inventory 
       WHERE LOWER(TRIM(supplier)) = LOWER(TRIM(?)) 
         AND LOWER(TRIM(color_name)) = LOWER(TRIM(?))
         AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))
         AND inventory_type = ?
         AND CAST(size AS DECIMAL(10,2)) = CAST(? AS DECIMAL(10,2))
       LIMIT 1 FOR UPDATE`,
      [sourceItem.supplier, to_color_name, to_color_code, sourceItem.inventory_type, sourceItem.size || 0]
    );

    let targetItem;

    if (targetRows.length > 0) {
      // 4a. Update existing target
      targetItem = targetRows[0];
      await connection.query('UPDATE prixel_inventory SET quantity = quantity + ? WHERE id = ?', [qtyToTransfer, targetItem.id]);
    } else {
      // 4b. Create new target inventory
      const insertSql = `
        INSERT INTO prixel_inventory 
        (supplier, color_name, color_code, price, state, channel_length, 
         inventory_type, size, quantity, possible_feet, 
         hole_distance, pieces, length, location, location_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        sourceItem.supplier,
        to_color_name,
        to_color_code,
        sourceItem.price,
        sourceItem.state || 'available',
        sourceItem.channel_length,
        sourceItem.inventory_type,
        sourceItem.size,
        qtyToTransfer,
        sourceItem.possible_feet,
        sourceItem.hole_distance,
        sourceItem.pieces,
        sourceItem.length,
        sourceItem.location,
        sourceItem.location_stock
      ];
      
      const [insertResult] = await connection.query(insertSql, values);
      const [newRows] = await connection.query('SELECT * FROM prixel_inventory WHERE id = ?', [insertResult.insertId]);
      targetItem = newRows[0];
    }

    await connection.commit();
    res.json({ message: 'Color conversion successful', data: targetItem });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error during color conversion:', err);
    res.status(500).json({ message: 'Failed to convert color', error: err.message });
  } finally {
    if (connection) connection.release();
  }
});


// ── POST /api/inventory/:id/transfer ────────────────────────────
// Transfer Ready Channel pieces from one location to another
router.post('/:id/transfer', async (req, res) => {
  const { from_location, to_location, quantity } = req.body;

  // Basic validations
  if (!from_location || !to_location) {
    return res.status(400).json({ message: 'from_location and to_location are required' });
  }
  if (from_location === to_location) {
    return res.status(400).json({ message: 'From and To locations must be different' });
  }
  const qty = parseInt(quantity);
  if (!qty || qty <= 0) {
    return res.status(400).json({ message: 'Quantity must be a positive number' });
  }

  try {
    const [invRows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [req.params.id]);
    if (invRows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    const item = invRows[0];
    if (item.inventory_type !== 'Ready Channel') {
      return res.status(400).json({ message: 'Transfers are only supported for Ready Channel inventory' });
    }

    const stock = JSON.parse(item.location_stock || '{}');
    const fromStock = parseInt(stock[from_location]) || 0;

    if (fromStock <= 0) {
      return res.status(400).json({ message: `No stock available at "${from_location}"` });
    }

    // Check dispatched holds at the from_location
    const [dispatchedHolds] = await db.query(
      `SELECT h.held_pieces, o.delivery_method, o.pickup_location, o.source_locations
       FROM prixel_inventory_holds h
       JOIN prixel_orders o ON o.order_id = h.order_id
       WHERE h.inventory_id = ?
         AND h.status = 'held'
         AND o.order_status = 'Ready for Pickup/Delivery'`,
      [req.params.id]
    );

    let dispatchedHeldAtFrom = 0;
    for (const hold of dispatchedHolds) {
      const heldPieces = parseInt(hold.held_pieces) || 0;
      if (heldPieces <= 0) continue;

      if (hold.delivery_method === 'pickup' && hold.pickup_location) {
        if (hold.pickup_location === from_location) {
          dispatchedHeldAtFrom += heldPieces;
        }
      } else if (hold.source_locations) {
        let left = heldPieces;
        const sourceLocs = typeof hold.source_locations === 'string' ? JSON.parse(hold.source_locations) : hold.source_locations;
        for (const src of sourceLocs) {
          if (left <= 0) break;
          const piecesToTake = Math.min(left, parseInt(src.pieces) || 0);
          if (piecesToTake > 0 && src.location) {
            if (src.location === from_location) dispatchedHeldAtFrom += piecesToTake;
            left -= piecesToTake;
          }
        }
      }
    }

    const available = Math.max(0, fromStock - dispatchedHeldAtFrom);
    if (qty > available) {
      return res.status(400).json({
        message: `Cannot transfer ${qty} pcs. Only ${available} available at "${from_location}" (${fromStock} total, ${dispatchedHeldAtFrom} held by dispatched orders)`,
      });
    }

    // Perform the transfer
    stock[from_location] = fromStock - qty;
    stock[to_location] = (parseInt(stock[to_location]) || 0) + qty;

    // Clean up: remove location key if stock becomes 0
    if (stock[from_location] <= 0) {
      delete stock[from_location];
    }

    await db.query(
      'UPDATE prixel_inventory SET location_stock = ? WHERE id = ?',
      [JSON.stringify(stock), req.params.id]
    );

    // Build stock breakdown for response
    const breakdown = {};
    for (const [location, pieces] of Object.entries(stock)) {
      const total = parseInt(pieces) || 0;
      // Recalculate dispatched held for each location
      let held = 0;
      for (const hold of dispatchedHolds) {
        const heldPieces = parseInt(hold.held_pieces) || 0;
        if (heldPieces <= 0) continue;
        if (hold.delivery_method === 'pickup' && hold.pickup_location) {
          if (hold.pickup_location === location) held += heldPieces;
        } else if (hold.source_locations) {
          let left = heldPieces;
          const sourceLocs = typeof hold.source_locations === 'string' ? JSON.parse(hold.source_locations) : hold.source_locations;
          for (const src of sourceLocs) {
            if (left <= 0) break;
            const piecesToTake = Math.min(left, parseInt(src.pieces) || 0);
            if (piecesToTake > 0 && src.location) {
              if (src.location === location) held += piecesToTake;
              left -= piecesToTake;
            }
          }
        }
      }
      breakdown[location] = {
        total,
        dispatched_held: Math.min(held, total),
        available: Math.max(0, total - held),
      };
    }

    // Fetch updated row
    const [updatedRows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [req.params.id]);

    res.json({
      message: `Transferred ${qty} pcs from "${from_location}" → "${to_location}"`,
      data: updatedRows[0],
      stock_breakdown: breakdown,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to transfer stock', error: err.message });
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
    hole_distance, pieces, length, location, location_stock,
  } = req.body;

  if (!inventory_type) {
    return res.status(400).json({ message: 'inventory_type is required.' });
  }

  const validTypes = ['Full Roll', 'Slitted', 'Ready Channel'];
  if (!validTypes.includes(inventory_type)) {
    return res.status(400).json({ message: `inventory_type must be one of: ${validTypes.join(', ')}` });
  }

  // Build location_stock JSON for Ready Channel
  let locationStockValue = null;
  if (inventory_type === 'Ready Channel' && pieces) {
    if (location_stock) {
      locationStockValue = typeof location_stock === 'string' ? location_stock : JSON.stringify(location_stock);
    } else {
      const loc = location || 'Warehouse';
      locationStockValue = JSON.stringify({ [loc]: parseInt(pieces) || 0 });
    }
  }

  const sql = `
    INSERT INTO prixel_inventory
      (supplier, color_name, color_code, price, state, channel_length,
       inventory_type, size, quantity, possible_feet,
       hole_distance, pieces, length, location, location_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    location ?? 'Warehouse',
    locationStockValue,
  ];

  try {
    const duplicate = await findDuplicateForCreate(req.body);
    if (duplicate) {
      // Ready Channel: merge new location into existing row's location_stock
      if (inventory_type === 'Ready Channel' && pieces) {
        const [existingRows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [duplicate.id]);
        const existing = existingRows[0];
        const stock = JSON.parse(existing.location_stock || '{}');
        const loc = location || 'Warehouse';
        const newPieces = parseInt(pieces) || 0;

        // Replace (not add) the stock for this location
        stock[loc] = newPieces;
        // Recalculate total from all locations
        const newTotal = Object.values(stock).reduce((sum, v) => sum + (parseInt(v) || 0), 0);

        // Update price to latest value if provided
        const updatePrice = price !== undefined && price !== null;
        const updateSql = updatePrice
          ? 'UPDATE prixel_inventory SET pieces = ?, location_stock = ?, price = ? WHERE id = ?'
          : 'UPDATE prixel_inventory SET pieces = ?, location_stock = ? WHERE id = ?';
        const updateVals = updatePrice
          ? [newTotal, JSON.stringify(stock), price, duplicate.id]
          : [newTotal, JSON.stringify(stock), duplicate.id];

        await db.query(updateSql, updateVals);

        const [rows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [duplicate.id]);
        return res.status(200).json({
          message: `Set ${newPieces} pcs at "${loc}" location (total: ${newTotal} pcs)`,
          data: rows[0],
        });
      }
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
    hole_distance, pieces, length, location,
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
    if (location !== undefined) { fields.push('location = ?'); values.push(location); }

    // Sync location_stock JSON when pieces change for Ready Channel
    const effectiveType = inventory_type !== undefined ? inventory_type : current.inventory_type;
    if (effectiveType === 'Ready Channel') {
      const { location_stock } = req.body;
      if (location_stock !== undefined) {
        const stockVal = typeof location_stock === 'string' ? location_stock : JSON.stringify(location_stock);
        fields.push('location_stock = ?'); values.push(stockVal);
      } else if (pieces !== undefined) {
        // Update only the selected location in existing JSON, keep other locations
        const existingStock = JSON.parse(current.location_stock || '{}');
        const loc = (location !== undefined ? location : current.location) || 'Warehouse';
        existingStock[loc] = parseInt(pieces) || 0;
        fields.push('location_stock = ?'); values.push(JSON.stringify(existingStock));

        // Recalculate total pieces from all locations
        const newTotal = Object.values(existingStock).reduce((sum, v) => sum + (parseInt(v) || 0), 0);
        // Override the pieces field with the recalculated total
        const piecesIdx = fields.indexOf('pieces = ?');
        if (piecesIdx !== -1) {
          values[piecesIdx] = newTotal;
        } else {
          fields.push('pieces = ?'); values.push(newTotal);
        }
      }
    }

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
