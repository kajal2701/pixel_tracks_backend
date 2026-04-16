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

// ── Helper: verify inventory logic internally ─────────────────────
async function calculateInventorySatisfaction(color, channel_length, total_pieces) {
  if (!color || channel_length == null || !total_pieces) {
    throw new Error('Missing required fields (color, channel_length, or total_pieces).');
  }

  // Parse color string: "color_name (color_code) (supplier)"
  const parsed = parseOrderColor(color);

  if (!parsed.supplier || !parsed.colorName) {
    // Fallback: Try to query with whatever we have
    const [fallbackInventory] = await db.query(
      `SELECT * FROM prixel_inventory
       WHERE (? = '' OR LOWER(TRIM(supplier)) = LOWER(TRIM(?)))
         AND (? = '' OR LOWER(TRIM(color_code)) = LOWER(TRIM(?)))`,
      [parsed.supplier || '', parsed.supplier || '', parsed.colorCode || '', parsed.colorCode || '']
    );

    const orderPieceLength = parseFloat(channel_length) || 0;
    if (orderPieceLength <= 0) {
      throw new Error(`Invalid channel length: ${channel_length}`);
    }

    let remainingQty = total_pieces;
    let readyAvailable = 0;
    fallbackInventory
      .filter((i) => i.inventory_type === 'Ready Channel')
      .forEach((item) => {
        const itemLength = parseFloat(item.length) || 0;
        if (itemLength === orderPieceLength) {
          readyAvailable += parseInt(item.pieces, 10) || 0;
        }
      });

    const result = {
      isFullySatisfied: remainingQty === 0,
      isReadySatisfied: readyAvailable >= total_pieces,
      error: null,
      orderQty: total_pieces,
      parsedColor: parsed,
      readyUsed: Math.min(remainingQty, readyAvailable),
      readyAvailable,
      slittedUsed: 0, slittedTotalFeet: 0, slittedPossiblePieces: 0,
      fullRollUsed: 0, fullRollTotalFeet: 0, fullRollPossiblePieces: 0,
      totalSatisfied: Math.min(remainingQty, readyAvailable),
      shortage: remainingQty - Math.min(remainingQty, readyAvailable),
    };

    return result;
  }

  const [inventory] = await db.query(
    `SELECT * FROM prixel_inventory
     WHERE LOWER(TRIM(supplier)) = LOWER(TRIM(?))
       AND LOWER(TRIM(color_code)) = LOWER(TRIM(?))`,
    [parsed.supplier, parsed.colorCode],
  );

  const orderPieceLength = parseFloat(channel_length) || 0;

  if (orderPieceLength <= 0) {
    throw new Error(`Invalid channel length: ${channel_length}`);
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
  };

  return result;
}

export default {
  calculateInventorySatisfaction,
};
