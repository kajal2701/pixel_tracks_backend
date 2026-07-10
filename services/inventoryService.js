import db from '../db.js';

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

// ── Helper: get supplier roll configuration from prixel_products ──
async function getSupplierConfig(supplierName) {
  if (!supplierName) {
    return { full_roll_length: 98, slits_per_roll: 6, slitted_roll_length: 98 };
  }
  const [rows] = await db.query(
    `SELECT full_roll_length, slits_per_roll, slitted_roll_length 
     FROM prixel_products 
     WHERE LOWER(TRIM(manufacturer)) = LOWER(TRIM(?)) 
     LIMIT 1`,
    [supplierName]
  );
  return rows[0] || { full_roll_length: 98, slits_per_roll: 6, slitted_roll_length: 98 };
}

// ── Helper: float-safe comparison for channel lengths ──
function floatEquals(a, b, tolerance = 0.02) {
  return Math.abs(a - b) < tolerance;
}

// ── Helper: build inventory query with holds ──
const INVENTORY_QUERY = `
  SELECT i.*, 
    COALESCE(SUM(CASE WHEN h.status = 'held' THEN h.held_pieces ELSE 0 END), 0) as total_held_pieces,
    COALESCE(SUM(CASE WHEN h.status = 'held' THEN h.held_quantity ELSE 0 END), 0) as total_held_quantity,
    COALESCE(SUM(CASE WHEN h.status = 'held' THEN 
      (CASE WHEN h.held_feet > 0 THEN h.held_feet ELSE h.held_pieces * COALESCE(p.channel_length, 0) END) 
    ELSE 0 END), 0) as total_held_feet
   FROM prixel_inventory i
   LEFT JOIN prixel_inventory_holds h ON i.id = h.inventory_id
   LEFT JOIN prixel_production p ON p.id = h.production_id
`;

// ── Helper: verify inventory logic internally ─────────────────────
async function calculateInventorySatisfaction(color, channel_length, total_pieces) {
  if (!color || channel_length == null || !total_pieces) {
    throw new Error('Missing required fields (color, channel_length, or total_pieces).');
  }

  // Parse color string: "color_name (color_code) (supplier)"
  const parsed = parseOrderColor(color);

  // channel_length from prixel_orders is stored as feet (e.g., 6.67, 6, 5.33)
  const orderPieceLength = parseFloat(channel_length) || 0;
  if (orderPieceLength <= 0) {
    throw new Error(`Invalid channel length: ${channel_length}`);
  }

  // Build query based on how much color info we have
  let inventory;
  if (parsed.supplier && parsed.colorCode) {
    const [rows] = await db.query(
      `${INVENTORY_QUERY}
       WHERE LOWER(TRIM(i.supplier)) = LOWER(TRIM(?))
         AND LOWER(TRIM(i.color_code)) = LOWER(TRIM(?))
       GROUP BY i.id`,
      [parsed.supplier, parsed.colorCode]
    );
    inventory = rows;
  } else {
    // Fallback: Try to query with whatever we have
    const [rows] = await db.query(
      `${INVENTORY_QUERY}
       WHERE (? = '' OR LOWER(TRIM(i.supplier)) = LOWER(TRIM(?)))
         AND (? = '' OR LOWER(TRIM(i.color_code)) = LOWER(TRIM(?)))
       GROUP BY i.id`,
      [parsed.supplier || '', parsed.supplier || '', parsed.colorCode || '', parsed.colorCode || '']
    );
    inventory = rows;
  }

  let remainingQty = total_pieces;

  // ── Step 1: Ready Channel — match by length (float-safe) ──
  let readyAvailable = 0;
  let readyHeld = 0;
  inventory
    .filter((i) => i.inventory_type === 'Ready Channel')
    .forEach((item) => {
      const itemLength = parseFloat(item.length) || 0;
      if (floatEquals(itemLength, orderPieceLength)) {
        const itemPieces = parseInt(item.pieces, 10) || 0;
        const heldPieces = parseInt(item.total_held_pieces, 10) || 0;
        readyAvailable += Math.max(0, itemPieces - heldPieces);
        readyHeld += heldPieces;
      }
    });
  const readyUsed = Math.min(remainingQty, readyAvailable);
  remainingQty -= readyUsed;

  // ── Step 2: Slitted — pieces = floor(size / orderPieceLength) * qty ──
  let slittedTotalFeet = 0;
  let slittedPossiblePieces = 0;
  let slittedHeldPieces = 0;
  inventory
    .filter((i) => i.inventory_type === 'Slitted')
    .forEach((item) => {
      const size = parseFloat(item.size) || 0;
      const rawQty = parseFloat(item.quantity) || 0;
      const heldFeet = parseFloat(item.total_held_feet) || 0;

      const totalFeet = size * rawQty;
      const availableFeet = Math.max(0, totalFeet - heldFeet);
      slittedTotalFeet += availableFeet;

      if (size > 0) {
        const piecesPerSlit = Math.floor(size / orderPieceLength);
        const availableRolls = Math.floor(availableFeet / size);
        const heldRolls = Math.floor(heldFeet / size);

        slittedPossiblePieces += availableRolls * piecesPerSlit;
        slittedHeldPieces += heldRolls * piecesPerSlit;
      }
    });
  const slittedUsed = Math.min(remainingQty, slittedPossiblePieces);
  remainingQty -= slittedUsed;

  // ── Step 3: Full Roll — account for two-step (slit then cut) ──
  // A full roll must be fully slit first, then each slit produces X tracks
  const config = await getSupplierConfig(parsed.supplier);
  const tracksPerSlit = Math.floor(config.slitted_roll_length / orderPieceLength);
  const tracksPerFullRoll = tracksPerSlit * config.slits_per_roll; // e.g., 14 × 6 = 84

  let fullRollTotalFeet = 0;
  let fullRollHeldFeet = 0;

  const fullRollItems = inventory.filter((i) => i.inventory_type === 'Full Roll');
  fullRollItems.forEach((item) => {
    const size = parseFloat(item.size) || 0;
    const rawQty = parseFloat(item.quantity) || 0;
    const heldFeet = parseFloat(item.total_held_feet) || 0;
    const totalFeet = size * rawQty;
    fullRollTotalFeet += Math.max(0, totalFeet - heldFeet);
    fullRollHeldFeet += heldFeet;
  });

  // ── Proportional availability: at least 1 physical roll must exist ──
  // An order reserves only the feet it actually needs, not an entire roll.
  const physicalRollsExist = fullRollItems.some((i) => (parseFloat(i.quantity) || 0) >= 1);
  const fullRollPossiblePieces = physicalRollsExist && fullRollTotalFeet > 0
    ? Math.round((fullRollTotalFeet * tracksPerFullRoll) / config.full_roll_length)
    : 0;
  const fullRollHeldPieces = Math.round((fullRollHeldFeet * tracksPerFullRoll) / config.full_roll_length);
  const fullRollUsed = Math.min(remainingQty, fullRollPossiblePieces);

  // ── Detect Active Step 1 Productions for Shared Full Roll Piggybacking ──

  // for check full roll capacity, first here we get the full roll invnetory for inventory table then check in production these inventory has production or not if yes how many left after satisfy the another order, and leftover is satisfying current order or not
  let activeStep1TotalFeet = 0;
  if (fullRollItems.length > 0) {
    const fullRollIds = fullRollItems.map(i => i.id);
    const [activeProds] = await db.query(
      `SELECT raw_material_id FROM prixel_production 
       WHERE target_state = 'Slitted' 
         AND status IN ('Pending', 'In Progress') 
         AND raw_material_id IN (?)`,
      [fullRollIds]
    );
    const activeRawIds = new Set(activeProds.map(p => p.raw_material_id));

    fullRollItems.forEach((item) => {
      if (activeRawIds.has(item.id)) {
        const size = parseFloat(item.size) || 0;
        const rawQty = parseFloat(item.quantity) || 0;
        const heldFeet = parseFloat(item.total_held_feet) || 0;
        const totalFeet = size * rawQty;
        activeStep1TotalFeet += Math.max(0, totalFeet - heldFeet);
      }
    });
  }
  // activeStep1PossiblePieces left over from active prodcution for other order
  const activeStep1PossiblePieces = Math.round((activeStep1TotalFeet * tracksPerFullRoll) / config.full_roll_length);
  // Only piggyback if the active production can fully satisfy the remaining pieces. Otherwise, request new production.
  const activeStep1Used = activeStep1PossiblePieces >= remainingQty ? remainingQty : 0;

  remainingQty -= fullRollUsed;

  const result = {
    isFullySatisfied: remainingQty === 0,
    isReadySatisfied: readyAvailable >= total_pieces,
    skipStep1Production: activeStep1Used > 0,
    error: null,
    orderQty: total_pieces,
    parsedColor: parsed,
    originalColor: color,
    channelLength: orderPieceLength,
    readyUsed,
    readyAvailable,
    readyHeld,
    slittedUsed,
    slittedTotalFeet: parseFloat(slittedTotalFeet.toFixed(2)),
    slittedPossiblePieces,
    slittedHeldPieces,
    fullRollUsed,
    fullRollTotalFeet: parseFloat(fullRollTotalFeet.toFixed(2)),
    fullRollPossiblePieces,
    fullRollHeldPieces,
    activeStep1Used,
    totalSatisfied: readyUsed + slittedUsed + fullRollUsed,
    shortage: remainingQty,
    supplierConfig: config,
    tracksPerSlit,
    tracksPerFullRoll,
  };

  return result;
}

async function holdOrderInventory(order_id, color, channel_length, needs, production_id = null) {
  // needs = { readyPieces: 0, slittedPieces: 0, fullRollPieces: 0 }
  const parsed = parseOrderColor(color);

  const [inventory] = await db.query(
    `${INVENTORY_QUERY}
     WHERE (? = '' OR LOWER(TRIM(i.supplier)) = LOWER(TRIM(?)))
       AND (? = '' OR LOWER(TRIM(i.color_code)) = LOWER(TRIM(?)))
     GROUP BY i.id`,
    [parsed.supplier || '', parsed.supplier || '', parsed.colorCode || '', parsed.colorCode || '']
  );

  // channel_length from prixel_orders is stored as feet (e.g., 6.67, 6, 5.33)
  const orderPieceLength = parseFloat(channel_length) || 0;
  if (orderPieceLength <= 0) throw new Error('Invalid channel length');

  const holdsToInsert = [];

  // 1. Hold Ready Channel pieces (held_pieces = pieces count)
  let remainReady = needs.readyPieces || 0;
  if (remainReady > 0) {
    const readyItems = inventory.filter(i =>
      i.inventory_type === 'Ready Channel' && floatEquals(parseFloat(i.length) || 0, orderPieceLength)
    );
    for (const item of readyItems) {
      if (remainReady <= 0) break;
      const available = Math.max(0, (parseInt(item.pieces, 10) || 0) - (parseInt(item.total_held_pieces, 10) || 0));
      if (available > 0) {
        const take = Math.min(remainReady, available);
        holdsToInsert.push([item.id, order_id, production_id, take, 0, 0, 'held']);
        remainReady -= take;
      }
    }
    if (remainReady > 0) throw new Error('Not enough Ready Channel inventory to hold.');
  }

  // 2. Hold Slitted rolls (slittedPieces = number of whole slitted rolls to hold)
  let remainSlits = needs.slittedPieces || 0;
  if (remainSlits > 0) {
    const slittedItems = inventory.filter(i => i.inventory_type === 'Slitted');
    for (const item of slittedItems) {
      if (remainSlits <= 0) break;
      const size = parseFloat(item.size) || 0;
      const rawQty = parseFloat(item.quantity) || 0;
      if (size <= 0 || rawQty <= 0) continue;

      const heldQty = parseFloat(item.total_held_quantity) || 0;
      const availableQty = Math.max(0, rawQty - heldQty);

      if (availableQty > 0) {
        const takeQty = Math.min(availableQty, remainSlits);
        const takeFeet = takeQty * size;  // whole roll × actual roll size (e.g., 1 × 100 = 100)
        holdsToInsert.push([item.id, order_id, production_id, 0, takeQty, takeFeet, 'held']);
        remainSlits -= takeQty;
      }
    }
    if (remainSlits > 0) throw new Error('Not enough Slitted inventory to hold.');
  }

  // 3. Hold Full Roll — PROPORTIONAL feet only
  // Each order reserves only the feet proportional to its piece count.
  // Physical roll is NOT locked; multiple orders share the same roll.
  let remainFullRollPieces = needs.fullRollPieces || 0;
  if (remainFullRollPieces > 0) {
    const config = await getSupplierConfig(parsed.supplier);
    const tracksPerSlit = Math.floor(config.slitted_roll_length / orderPieceLength);
    const tracksPerFullRoll = tracksPerSlit * config.slits_per_roll;

    // Proportional feet = pieces × (full_roll_length / tracksPerFullRoll)
    // e.g., 35 pieces × (98 ft / 84 tracks) = 40.8333 ft
    const proportionalFeetPerPiece = config.full_roll_length / (tracksPerFullRoll || 1);
    let remainFeet = parseFloat((remainFullRollPieces * proportionalFeetPerPiece).toFixed(4));

    const fullRollItems = inventory.filter(i => i.inventory_type === 'Full Roll');
    for (const item of fullRollItems) {
      if (remainFeet <= 0) break;
      const size = parseFloat(item.size) || 0;
      const rawQty = parseFloat(item.quantity) || 0;
      if (size <= 0) continue;
      const totalFeet = size * rawQty;
      const heldFeet = parseFloat(item.total_held_feet) || 0;
      const availableFeet = Math.max(0, totalFeet - heldFeet);

      if (availableFeet > 0) {
        const takeFeet = parseFloat(Math.min(availableFeet, remainFeet).toFixed(4));
        // held_quantity = 0 (no whole-roll lock), held_feet = proportional
        holdsToInsert.push([item.id, order_id, production_id, 0, 0, takeFeet, 'held']);
        remainFeet = parseFloat((remainFeet - takeFeet).toFixed(4));
      }
    }
    if (remainFeet > 0.01) throw new Error('Not enough Full Roll inventory to hold.');
  }

  if (holdsToInsert.length > 0) {
    await db.query(
      `INSERT INTO prixel_inventory_holds (inventory_id, order_id, production_id, held_pieces, held_quantity, held_feet, status) VALUES ?`,
      [holdsToInsert]
    );
  }

  // Return which inventory items were held so callers can set raw_material_id
  // Each entry: [inventory_id, order_id, production_id, held_pieces, status]
  const heldItems = holdsToInsert.map(h => {
    const inv = inventory.find(i => i.id === h[0]);
    return {
      inventory_id: h[0],
      held_pieces: h[3],
      held_quantity: h[4],
      held_feet: h[5],
      inventory_type: inv?.inventory_type || '',
      size: inv?.size || null,
    };
  });
  return heldItems;
}

async function getHoldsByColor(color, channel_length) {
  const parsed = parseOrderColor(color);
  const orderPieceLength = parseFloat(channel_length) || 0;

  const query = `
    SELECT 
      h.id as hold_id,
      h.held_pieces,
      h.held_quantity,
      h.held_feet,
      i.inventory_type,
      o.order_id,
      o.order_status,
      o.total_pieces as order_qty,
      c.company_name,
      c.contact_name,
      p.production_type,
      p.qty as production_qty,
      p.status as production_status
    FROM prixel_inventory_holds h
    JOIN prixel_inventory i ON h.inventory_id = i.id
    LEFT JOIN prixel_orders o ON h.order_id = o.order_id
    LEFT JOIN prixel_customers c ON o.customer_id = c.id
    LEFT JOIN prixel_production p ON h.production_id = p.id
    WHERE h.status = 'held'
      AND (? = '' OR LOWER(TRIM(i.supplier)) = LOWER(TRIM(?)))
      AND (? = '' OR LOWER(TRIM(i.color_code)) = LOWER(TRIM(?)))
      AND (
        i.inventory_type IN ('Full Roll', 'Slitted') 
        OR 
        (i.inventory_type = 'Ready Channel' AND ABS(CAST(i.length AS DECIMAL(10,2)) - CAST(? AS DECIMAL(10,2))) < 0.02)
      )
  `;

  const [rows] = await db.query(query, [
    parsed.supplier || '', parsed.supplier || '',
    parsed.colorCode || '', parsed.colorCode || '',
    orderPieceLength
  ]);
  return rows;
}

// ── Helper: get linked products for a given color string ──────────
async function getLinkedProducts(colorStr) {
  const parsed = parseOrderColor(colorStr);
  if (!parsed.supplier || !parsed.colorCode) return [];

  // Find the original product to get its link_group_id
  const [orig] = await db.query(
    'SELECT link_group_id FROM prixel_products WHERE LOWER(TRIM(manufacturer)) = LOWER(TRIM(?)) AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))',
    [parsed.supplier, parsed.colorCode]
  );

  if (orig.length === 0 || !orig[0].link_group_id) return [];

  // Return all other products in that group
  const [linked] = await db.query(
    'SELECT * FROM prixel_products WHERE link_group_id = ? AND NOT (LOWER(TRIM(manufacturer)) = LOWER(TRIM(?)) AND LOWER(TRIM(color_code)) = LOWER(TRIM(?)))',
    [orig[0].link_group_id, parsed.supplier, parsed.colorCode]
  );

  return linked;
}

export default {
  calculateInventorySatisfaction,
  holdOrderInventory,
  getSupplierConfig,
  getHoldsByColor,
  parseOrderColor,
  getLinkedProducts,
};
