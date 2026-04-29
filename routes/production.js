import { Router } from 'express';
import db from '../db.js';
import inventoryService from '../services/inventoryService.js';

const router = Router();

// ── Helper: parse numeric from size string like "90 ft" ─────────
const parseSizeNum = (s) => {
  if (!s) return 0;
  const m = String(s).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
};

// ── GET /api/production ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*,
        i.inventory_type  AS raw_material_type,
        i.color_name      AS raw_material_color,
        i.color_code      AS raw_material_color_code,
        i.supplier        AS raw_material_supplier,
        i.size            AS raw_material_size_available,
        i.quantity         AS raw_material_qty_available
      FROM prixel_production p
      LEFT JOIN prixel_inventory i ON i.id = p.raw_material_id
      ORDER BY p.created_at DESC
    `);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch production records', error: err.message });
  }
});

// ── GET /api/production/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*,
        i.inventory_type  AS raw_material_type,
        i.color_name      AS raw_material_color,
        i.color_code      AS raw_material_color_code,
        i.supplier        AS raw_material_supplier
      FROM prixel_production p
      LEFT JOIN prixel_inventory i ON i.id = p.raw_material_id
      WHERE p.id = ?
    `, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Production record not found' });

    const production = rows[0];

    // Fetch linked order details
    let order = null;
    if (production.order_id) {
      const [orderRows] = await db.query(
        `SELECT o.*, c.company_name, c.contact_name
         FROM prixel_orders o
         LEFT JOIN prixel_customers c ON c.id = o.customer_id
         WHERE o.order_id = ?`,
        [production.order_id]
      );
      if (orderRows.length > 0) order = orderRows[0];
    }

    // Fetch held inventory items for this production
    const [holds] = await db.query(
      `SELECT h.*, i.inventory_type, i.color_name, i.color_code, i.supplier,
              i.size, i.quantity as inv_quantity, i.pieces as inv_pieces, i.length as inv_length
       FROM prixel_inventory_holds h
       JOIN prixel_inventory i ON i.id = h.inventory_id
       WHERE h.production_id = ?`,
      [req.params.id]
    );

    res.json({ data: production, order, holds });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch production record', error: err.message });
  }
});

// ── POST /api/production ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const { production_type, order_id, raw_material_id, target_state, qty, size, channel_length, waste_qty, assignee, notes } = req.body;

  // Validate production_type
  const validTypes = ['General Inventory', 'Specific Order'];
  if (!production_type || !validTypes.includes(production_type)) {
    return res.status(400).json({ message: `production_type must be one of: ${validTypes.join(', ')}` });
  }

  // Validate target_state
  const validStates = ['Ready Channel', 'Slitted'];
  if (!target_state || !validStates.includes(target_state)) {
    return res.status(400).json({ message: `target_state must be one of: ${validStates.join(', ')}` });
  }

  if (production_type === 'Specific Order' && !order_id) {
    return res.status(400).json({ message: 'order_id is required for Specific Order production.' });
  }

  if (!raw_material_id) {
    return res.status(400).json({ message: 'raw_material_id is required.' });
  }

  try {
    // Verify raw material exists
    const [invRows] = await db.query('SELECT * FROM prixel_inventory WHERE id = ?', [raw_material_id]);
    if (invRows.length === 0) {
      return res.status(404).json({ message: 'Raw material inventory item not found.' });
    }

    // Verify order exists if Specific Order
    if (production_type === 'Specific Order') {
      const [orderRows] = await db.query('SELECT id FROM prixel_orders WHERE order_id = ?', [order_id]);
      if (orderRows.length === 0) {
        return res.status(404).json({ message: `Order "${order_id}" not found.` });
      }
    }

    const [result] = await db.query(
      `INSERT INTO prixel_production
        (production_type, order_id, raw_material_id, target_state, qty, size, channel_length, waste_qty, assignee, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
      [
        production_type,
        production_type === 'Specific Order' ? order_id : null,
        raw_material_id,
        target_state,
        qty || 0,
        size || null,
        channel_length || null,
        waste_qty || 0,
        assignee || null,
        notes || null,
      ]
    );

    const production_id = result.insertId;

    // Create inventory hold for the raw material
    if (raw_material_id && (qty || 0) > 0) {
      const invType = invRows[0].inventory_type;
      let held_pieces = 0;
      let held_quantity = 0;
      let held_feet = 0;

      if (invType === 'Ready Channel') {
        held_pieces = qty;
      } else {
        held_quantity = qty;
        held_feet = qty * parseSizeNum(size || invRows[0].size);
      }

      await db.query(
        `INSERT INTO prixel_inventory_holds (inventory_id, order_id, production_id, held_pieces, held_quantity, held_feet, status)
         VALUES (?, ?, ?, ?, ?, ?, 'held')`,
        [raw_material_id, production_type === 'Specific Order' ? order_id : null, production_id, held_pieces, held_quantity, held_feet]
      );
    }

    const [rows] = await db.query('SELECT * FROM prixel_production WHERE id = ?', [production_id]);
    res.status(201).json({ message: 'Production record created successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create production record', error: err.message });
  }
});

// ── PUT /api/production/:id ──────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { production_type, order_id, raw_material_id, target_state, qty, size, channel_length, waste_qty, assignee, notes, status } = req.body;
  const fields = [];
  const values = [];

  if (production_type !== undefined) { fields.push('production_type = ?'); values.push(production_type); }
  if (order_id !== undefined) { fields.push('order_id = ?'); values.push(order_id); }
  if (raw_material_id !== undefined) { fields.push('raw_material_id = ?'); values.push(raw_material_id); }
  if (target_state !== undefined) { fields.push('target_state = ?'); values.push(target_state); }
  if (qty !== undefined) { fields.push('qty = ?'); values.push(qty); }
  if (size !== undefined) { fields.push('size = ?'); values.push(size); }
  if (channel_length !== undefined) { fields.push('channel_length = ?'); values.push(channel_length); }
  if (waste_qty !== undefined) { fields.push('waste_qty = ?'); values.push(waste_qty); }
  if (assignee !== undefined) { fields.push('assignee = ?'); values.push(assignee); }
  if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }

  if (fields.length === 0) return res.status(400).json({ message: 'No fields provided to update.' });
  values.push(req.params.id);

  try {
    const [result] = await db.query(
      `UPDATE prixel_production SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Production record not found' });

    const [rows] = await db.query('SELECT * FROM prixel_production WHERE id = ?', [req.params.id]);
    const updatedProd = rows[0];

    // Update corresponding inventory hold
    if (updatedProd.raw_material_id && updatedProd.status !== 'Completed' && updatedProd.status !== 'Cancelled') {
      const [invRows] = await db.query('SELECT inventory_type, size FROM prixel_inventory WHERE id = ?', [updatedProd.raw_material_id]);
      if (invRows.length > 0) {
        const invType = invRows[0].inventory_type;
        let held_pieces = 0;
        let held_quantity = 0;
        let held_feet = 0;

        if (invType === 'Ready Channel') {
          held_pieces = updatedProd.qty;
        } else {
          held_quantity = updatedProd.qty;

          if (updatedProd.production_type === 'Specific Order') {
            const [existingHold] = await db.query('SELECT held_feet FROM prixel_inventory_holds WHERE production_id = ? AND status = "held"', [req.params.id]);
            held_feet = existingHold.length > 0 ? existingHold[0].held_feet : updatedProd.qty * parseSizeNum(updatedProd.size || invRows[0].size);
          } else {
            held_feet = updatedProd.qty * parseSizeNum(updatedProd.size || invRows[0].size);
          }
        }

        const [holdRows] = await db.query('SELECT id FROM prixel_inventory_holds WHERE production_id = ? AND status = "held"', [req.params.id]);
        if (holdRows.length > 0) {
          await db.query(
            `UPDATE prixel_inventory_holds 
             SET inventory_id = ?, order_id = ?, held_pieces = ?, held_quantity = ?, held_feet = ?
             WHERE production_id = ? AND status = 'held'`,
            [updatedProd.raw_material_id, updatedProd.production_type === 'Specific Order' ? updatedProd.order_id : null, held_pieces, held_quantity, held_feet, req.params.id]
          );
        } else {
          await db.query(
            `INSERT INTO prixel_inventory_holds (inventory_id, order_id, production_id, held_pieces, held_quantity, held_feet, status)
             VALUES (?, ?, ?, ?, ?, ?, 'held')`,
            [updatedProd.raw_material_id, updatedProd.production_type === 'Specific Order' ? updatedProd.order_id : null, req.params.id, held_pieces, held_quantity, held_feet]
          );
        }
      }
    }

    res.json({ message: 'Production record updated successfully', data: updatedProd });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update production record', error: err.message });
  }
});

// ── PATCH /api/production/:id/status ────────────────────────────
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const allowed = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const [result] = await db.query('UPDATE prixel_production SET status = ? WHERE id = ?', [status, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Not found' });

    // ── Completed: deduct raw material, add output (General Inventory) ──
    if (status === 'Completed') {
      const [prodRows] = await db.query('SELECT * FROM prixel_production WHERE id = ?', [req.params.id]);
      const prod = prodRows[0] || {};
      const sizeNum = parseSizeNum(prod.size);

      const [holds] = await db.query(
        `SELECT h.*, i.inventory_type FROM prixel_inventory_holds h
         JOIN prixel_inventory i ON i.id = h.inventory_id
         WHERE h.production_id = ? AND h.status = 'held'`,
        [req.params.id]
      );

      let totalFeetUsedAcrossHolds = 0;

      // Deduct raw material from inventory
      for (const hold of holds) {
        if (hold.inventory_type === 'Ready Channel') {
          if ((hold.held_pieces || 0) <= 0) continue;
          await db.query(
            'UPDATE prixel_inventory SET pieces = GREATEST(0, pieces - ?) WHERE id = ?',
            [hold.held_pieces, hold.inventory_id]
          );
        } else {
          const feetUsed = hold.held_feet > 0 ? hold.held_feet : (hold.held_pieces || 0) * sizeNum;
          if (feetUsed <= 0) continue;
          totalFeetUsedAcrossHolds += feetUsed;
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

      // Mark holds as used
      await db.query('UPDATE prixel_inventory_holds SET status = "used" WHERE production_id = ?', [req.params.id]);

      // Add output to inventory
      if (prod.raw_material_id) {
        const [rawRows] = await db.query('SELECT color_name, color_code, supplier FROM prixel_inventory WHERE id = ?', [prod.raw_material_id]);
        if (rawRows.length > 0) {
          const raw = rawRows[0];
          const targetType = prod.target_state;
          const chLen = parseFloat(prod.channel_length) || 0;
          const prodQty = parseInt(prod.qty) || 0;
          const config = await inventoryService.getSupplierConfig(raw.supplier);

          let outputPieces = prodQty;
          let outputLength = sizeNum;

          if (targetType === 'Ready Channel' && chLen > 0) {
            // Use supplier config: each slitted roll produces X tracks
            const tracksPerSlit = Math.floor(config.slitted_roll_length / chLen);
            const wastePerSlit = config.slitted_roll_length - (tracksPerSlit * chLen);
            outputPieces = prodQty * tracksPerSlit;
            outputLength = chLen;
            // Auto-set waste on the production record
            const totalWaste = prodQty * wastePerSlit;
            await db.query('UPDATE prixel_production SET waste_qty = ? WHERE id = ?',
              [parseFloat(totalWaste.toFixed(2)), req.params.id]);
          } else if (targetType === 'Slitted') {
            // Full Roll → Slitted: output = qty × slits_per_roll
            outputPieces = prodQty * config.slits_per_roll;
            outputLength = config.slitted_roll_length;
          }

          if (outputPieces > 0) {
            let invIdToHold = null;
            const [existingRows] = await db.query(
              `SELECT id FROM prixel_inventory
               WHERE inventory_type = ? AND color_name = ? AND color_code = ? AND supplier = ?
               AND (length = ? OR size = ? OR size IS NULL OR size = 0) LIMIT 1`,
              [targetType, raw.color_name, raw.color_code, raw.supplier, outputLength, outputLength]
            );

            if (existingRows.length > 0) {
              invIdToHold = existingRows[0].id;
              if (targetType === 'Ready Channel') {
                await db.query('UPDATE prixel_inventory SET pieces = pieces + ? WHERE id = ?', [outputPieces, invIdToHold]);
              } else {
                // Also restore size if it was depleted to 0
                await db.query(
                  'UPDATE prixel_inventory SET quantity = quantity + ?, size = CASE WHEN size IS NULL OR size = 0 THEN ? ELSE size END WHERE id = ?',
                  [outputPieces, outputLength, invIdToHold]
                );
              }
            } else {
              if (targetType === 'Ready Channel') {
                const [ins] = await db.query(
                  `INSERT INTO prixel_inventory (supplier, color_name, color_code, inventory_type, pieces, length, hole_distance, state)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`,
                  [raw.supplier, raw.color_name, raw.color_code, targetType, outputPieces, outputLength,
                  chLen > 0 ? String(Math.round(chLen * 1.5)) : null]
                );
                invIdToHold = ins.insertId;
              } else {
                const [ins] = await db.query(
                  `INSERT INTO prixel_inventory (supplier, color_name, color_code, inventory_type, quantity, size, state)
                   VALUES (?, ?, ?, ?, ?, ?, 'available')`,
                  [raw.supplier, raw.color_name, raw.color_code, targetType, outputPieces, outputLength]
                );
                invIdToHold = ins.insertId;
              }
            }

            // Hold output for Specific Order — only hold what order needs
            if (prod.production_type === 'Specific Order' && prod.order_id && invIdToHold) {
              if (targetType === 'Ready Channel') {
                // Look up how many pieces the order still needs
                const [orderRows] = await db.query('SELECT total_pieces FROM prixel_orders WHERE order_id = ?', [prod.order_id]);
                const [heldRows] = await db.query(
                  `SELECT COALESCE(SUM(h.held_pieces), 0) as held
                   FROM prixel_inventory_holds h
                   JOIN prixel_inventory i ON i.id = h.inventory_id
                   WHERE h.order_id = ? AND h.status = 'held' AND i.inventory_type = 'Ready Channel'`,
                  [prod.order_id]
                );
                const remainingNeeded = (orderRows[0]?.total_pieces || 0) - (heldRows[0]?.held || 0);
                const piecesToHold = Math.min(outputPieces, Math.max(0, remainingNeeded));

                if (piecesToHold > 0) {
                  await db.query(
                    `INSERT INTO prixel_inventory_holds (inventory_id, order_id, production_id, held_pieces, held_quantity, held_feet, status)
                     VALUES (?, ?, NULL, ?, 0, 0, 'held')`,
                    [invIdToHold, prod.order_id, piecesToHold]
                  );
                }
                // Remaining (outputPieces - piecesToHold) stays as available inventory
              }
              // For Slitted: don't hold all — Step 2 will handle holding what it needs
            }

            // ── AUTO-CREATE STEP 2: Slitted → Ready Channel ──
            if (targetType === 'Slitted' && prod.production_type === 'Specific Order' && prod.order_id && chLen > 0) {
              const tracksPerSlit = Math.floor(config.slitted_roll_length / chLen);

              // Calculate how many pieces the order still needs
              const [orderRows] = await db.query('SELECT total_pieces FROM prixel_orders WHERE order_id = ?', [prod.order_id]);
              const [heldRows] = await db.query(
                `SELECT COALESCE(SUM(held_pieces), 0) as held
                 FROM prixel_inventory_holds h
                 JOIN prixel_inventory i ON i.id = h.inventory_id
                 WHERE h.order_id = ? AND h.status = 'held' AND i.inventory_type = 'Ready Channel'`,
                [prod.order_id]
              );
              const remainingPieces = (orderRows[0]?.total_pieces || 0) - (heldRows[0]?.held || 0);

              if (remainingPieces > 0 && tracksPerSlit > 0) {
                const slitsNeeded = Math.ceil(remainingPieces / tracksPerSlit);

                // Calculate waste
                const singleSlitWaste = config.slitted_roll_length - (tracksPerSlit * chLen);
                const step2Waste = (singleSlitWaste * slitsNeeded).toFixed(2);

                // Create Step 2 production record
                const [step2Result] = await db.query(
                  `INSERT INTO prixel_production
                    (production_type, order_id, raw_material_id, target_state, qty, size,
                     channel_length, waste_qty, assignee, status, notes)
                   VALUES ('Specific Order', ?, ?, 'Ready Channel', ?, ?, ?, ?, ?, 'Pending',
                     'Auto-created: Cut ready channels from slitted rolls')`,
                  [prod.order_id, invIdToHold, slitsNeeded,
                  `${config.slitted_roll_length} ft`, chLen, step2Waste, prod.assignee || null]
                );

                // Hold the slitted rolls needed for Step 2
                const step2Id = step2Result.insertId;
                const holdFeet = slitsNeeded * config.slitted_roll_length;
                await db.query(
                  `INSERT INTO prixel_inventory_holds (inventory_id, order_id, production_id, held_pieces, held_quantity, held_feet, status)
                   VALUES (?, ?, ?, 0, ?, ?, 'held')`,
                  [invIdToHold, prod.order_id, step2Id, slitsNeeded, holdFeet]
                );
              }
            }
          }
        }
      }
    }

    // ── Cancelled: release holds ──
    if (status === 'Cancelled') {
      await db.query('UPDATE prixel_inventory_holds SET status = "released" WHERE production_id = ?', [req.params.id]);
    }

    res.json({ message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update status', error: err.message });
  }
});

// ── POST /api/production/request ─────────────────────────────────
// Order-linked: creates production records for unfulfilled order pieces
router.post('/request', async (req, res) => {
  const { order_id, assignee, notes } = req.body;

  if (!order_id) return res.status(400).json({ message: 'order_id is required.' });

  try {
    const [orderRows] = await db.query('SELECT * FROM prixel_orders WHERE order_id = ?', [order_id]);
    if (orderRows.length === 0) return res.status(404).json({ message: `Order "${order_id}" not found.` });

    const order = orderRows[0];
    const { color, channel_length, total_pieces } = order;
    const chLen = parseFloat(channel_length) || 1;


    // Check existing Ready Channel holds
    const [existingHolds] = await db.query(
      `SELECT COALESCE(SUM(h.held_pieces), 0) as already_held_pieces
       FROM prixel_inventory_holds h
       JOIN prixel_inventory i ON i.id = h.inventory_id
       WHERE h.order_id = ? AND h.status = 'held' AND i.inventory_type = 'Ready Channel'`,
      [order_id]
    );
    const alreadyHeldReady = parseInt(existingHolds[0]?.already_held_pieces, 10) || 0;
    const piecesNeedingProduction = Math.max(0, total_pieces - alreadyHeldReady);

    if (piecesNeedingProduction === 0) {
      return res.status(200).json({
        message: 'All pieces are already covered by Ready Channel inventory. No production needed.',
        data: [],
        count: 0,
      });
    }

    const satisfaction = await inventoryService.calculateInventorySatisfaction(color, channel_length, piecesNeedingProduction);


    const jobs = [];

    if (satisfaction.slittedUsed > 0) {
      // Whole-slit production: always process entire slitted rolls
      const config = satisfaction.supplierConfig || { full_roll_length: 98, slits_per_roll: 6, slitted_roll_length: 98 };
      const tracksPerSlit = satisfaction.tracksPerSlit || Math.floor(config.slitted_roll_length / chLen);
      const slitsNeeded = Math.ceil(satisfaction.slittedUsed / tracksPerSlit);

      const singleSlitWaste = config.slitted_roll_length - (tracksPerSlit * chLen);
      const totalWaste = (singleSlitWaste * slitsNeeded).toFixed(2);

      jobs.push({
        target_state: 'Ready Channel',
        raw_type: 'Slitted',
        qty: slitsNeeded,  // whole slitted rolls, not pieces
        waste_qty: totalWaste,
        piecesForOrder: satisfaction.slittedUsed,  // actual pieces order needs
        needs: { readyPieces: 0, slittedPieces: slitsNeeded, fullRollPieces: 0 },
      });
    }

    if (satisfaction.fullRollUsed > 0) {
      // Phase 3 (Option B): Create Step 1 only (Full Roll → Slitted)
      // Step 2 (Slitted → Ready Channel) auto-creates when Step 1 completes
      const config = satisfaction.supplierConfig || { full_roll_length: 98, slits_per_roll: 6, slitted_roll_length: 98 };
      const tracksPerSlit = satisfaction.tracksPerSlit || Math.floor(config.slitted_roll_length / chLen);
      const tracksPerFullRoll = satisfaction.tracksPerFullRoll || (tracksPerSlit * config.slits_per_roll);
      const fullRollsNeeded = Math.ceil(satisfaction.fullRollUsed / tracksPerFullRoll) || 1;

      jobs.push({
        target_state: 'Slitted',
        raw_type: 'Full Roll',
        qty: fullRollsNeeded,
        needs: { readyPieces: 0, slittedPieces: 0, fullRollPieces: satisfaction.fullRollUsed },
        isStep1: true,
      });
    }

    if (jobs.length === 0) {
      jobs.push({
        target_state: 'Ready Channel',
        raw_type: 'General',
        qty: piecesNeedingProduction,
        needs: { readyPieces: 0, slittedPieces: 0, fullRollPieces: 0 },
      });
    }

    const created = [];
    for (const job of jobs) {
      const jobNotes = job.isStep1
        ? (notes ? `${notes} | Step 1: Slitting (Step 2 auto-creates on completion)` : 'Step 1: Slitting (Step 2 auto-creates on completion)')
        : (notes || null);

      const [result] = await db.query(
        `INSERT INTO prixel_production
          (production_type, order_id, raw_material_id, target_state, qty, size, channel_length, waste_qty, assignee, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
        ['Specific Order', order_id, null, job.target_state, job.qty, null, chLen, job.waste_qty || 0, assignee || null, jobNotes]
      );

      const production_id = result.insertId;
      const heldItems = await inventoryService.holdOrderInventory(order_id, color, channel_length, job.needs, production_id);

      // Update production record with the actual raw material used
      if (heldItems && heldItems.length > 0) {
        const primaryHold = heldItems[0];
        let rawSize = primaryHold.size ? `${primaryHold.size} ft` : null;

        let newQty = job.qty;
        if (primaryHold.inventory_type !== 'Ready Channel') {
          const totalFeetHeld = heldItems.reduce((sum, h) => sum + (h.held_feet || 0), 0);
          rawSize = `${totalFeetHeld} ft`;
          newQty = job.qty; // Keep whole roll count (Step 1 or whole-slit jobs)
        }

        await db.query(
          'UPDATE prixel_production SET raw_material_id = ?, size = ?, qty = ? WHERE id = ?',
          [primaryHold.inventory_id, rawSize, newQty, production_id]
        );
      }

      const [rows] = await db.query('SELECT * FROM prixel_production WHERE id = ?', [production_id]);
      created.push(rows[0]);
    }

    res.status(201).json({
      message: `${created.length} production record(s) created successfully`,
      data: created,
      count: created.length,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create production request', error: err.message });
  }
});

// ── DELETE /api/production/:id ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // Release any associated holds
    await db.query('UPDATE prixel_inventory_holds SET status = "released" WHERE production_id = ?', [req.params.id]);
    const [result] = await db.query('DELETE FROM prixel_production WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete', error: err.message });
  }
});

export default router;
