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
  inventory
    .filter((i) => i.inventory_type === 'Ready Channel')
    .forEach((item) => {
      const itemLength = parseFloat(item.length) || 0;
      if (floatEquals(itemLength, orderPieceLength)) {
        const itemPieces = parseInt(item.pieces, 10) || 0;
        const heldPieces = parseInt(item.total_held_pieces, 10) || 0;
        readyAvailable += Math.max(0, itemPieces - heldPieces);
      }
    });
  const readyUsed = Math.min(remainingQty, readyAvailable);
  remainingQty -= readyUsed;

  // ── Step 2: Slitted — available feet = (qty × size) - held_feet ──
  let slittedTotalFeet = 0;
  inventory
    .filter((i) => i.inventory_type === 'Slitted')
    .forEach((item) => {
      const size = parseFloat(item.size) || 0;
      const rawQty = parseFloat(item.quantity) || 0;
      const heldFeet = parseFloat(item.total_held_feet) || 0;
      const totalFeet = size * rawQty;
      slittedTotalFeet += Math.max(0, totalFeet - heldFeet);
    });
  const slittedPossiblePieces = Math.floor(slittedTotalFeet / orderPieceLength);
  const slittedUsed = Math.min(remainingQty, slittedPossiblePieces);
  remainingQty -= slittedUsed;

  // ── Step 3: Full Roll — account for two-step (slit then cut) ──
  // A full roll must be fully slit first, then each slit produces X tracks
  const config = await getSupplierConfig(parsed.supplier);
  const tracksPerSlit = Math.floor(config.slitted_roll_length / orderPieceLength);
  const tracksPerFullRoll = tracksPerSlit * config.slits_per_roll; // e.g., 14 × 6 = 84

  let fullRollTotalFeet = 0;
  inventory
    .filter((i) => i.inventory_type === 'Full Roll')
    .forEach((item) => {
      const size = parseFloat(item.size) || 0;
      const rawQty = parseFloat(item.quantity) || 0;
      const heldFeet = parseFloat(item.total_held_feet) || 0;
      const totalFeet = size * rawQty;
      fullRollTotalFeet += Math.max(0, totalFeet - heldFeet);
    });

  // Calculate how many full rolls are actually available (as whole rolls)
  const fullRollsAvailable = Math.floor(fullRollTotalFeet / config.full_roll_length);
  const fullRollPossiblePieces = fullRollsAvailable * tracksPerFullRoll;
  const fullRollUsed = Math.min(remainingQty, fullRollPossiblePieces);
  remainingQty -= fullRollUsed;

  const result = {
    isFullySatisfied: remainingQty === 0,
    isReadySatisfied: readyAvailable >= total_pieces,
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
    // Include supplier config so callers can use it for production planning
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

  // 3. Hold Full Roll (by whole rolls, accounting for two-step process)
  let remainFullRollPieces = needs.fullRollPieces || 0;
  if (remainFullRollPieces > 0) {
    const config = await getSupplierConfig(parsed.supplier);
    const tracksPerSlit = Math.floor(config.slitted_roll_length / orderPieceLength);
    const tracksPerFullRoll = tracksPerSlit * config.slits_per_roll;

    // Calculate how many full rolls we need to produce this many pieces
    const fullRollsNeeded = Math.ceil(remainFullRollPieces / tracksPerFullRoll);
    const feetNeeded = fullRollsNeeded * config.full_roll_length;
    let remainFeet = feetNeeded;

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
        const takeFeet = Math.min(availableFeet, remainFeet);
        const qtyToHold = Math.ceil(takeFeet / size);
        const actualFeetTaken = qtyToHold * size; // Hold whole rolls
        holdsToInsert.push([item.id, order_id, production_id, 0, qtyToHold, actualFeetTaken, 'held']);
        remainFeet -= actualFeetTaken;
      }
    }
    if (remainFeet > 0) throw new Error('Not enough Full Roll inventory to hold.');
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

export default {
  calculateInventorySatisfaction,
  holdOrderInventory,
  getSupplierConfig,
};
