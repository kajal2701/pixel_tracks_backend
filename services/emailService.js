import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendMail } from "./mailer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "..", "emailTemplates");

/**
 * Read an HTML template and replace {{placeholders}} with values
 */
function renderTemplate(templateName, vars) {
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  let html = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, value ?? "");
  }
  return html;
}

/**
 * Send order placed email to customer
 */
export const sendOrderPlacedEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const html = renderTemplate("orderPlaced", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    customerName: order.contact_name || order.company_name,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    orderStatus: "Awaiting Confirmation",
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: order.email,
    subject: `Order Placed — ${order.order_id}`,
    html,
  });
};

/**
 * Send order confirmed email to customer
 */
export const sendOrderConfirmedEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';
  const deliveryLabel = isPickup ? '📦 Pickup Details' : '🚚 Delivery Details';
  const deliveryAddress = isPickup
    ? (order.pickup_location || 'To be determined')
    : (order.delivery_address || 'To be determined');
  const deliveryMethod = isPickup ? 'pickup' : 'delivery';

  // Estimated date: use pickup_date if available, otherwise 5 business days from now
  let estimatedDate = 'To be determined';
  if (order.pickup_date) {
    estimatedDate = new Date(order.pickup_date).toLocaleDateString('en-CA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  const html = renderTemplate("orderConfirmed", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    customerName: order.contact_name || order.company_name,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    deliveryLabel,
    deliveryAddress,
    deliveryMethod,
    estimatedDate,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: order.email,
    subject: `Order Confirmed — ${order.order_id}`,
    html,
  });
};

/**
 * Send order cancelled email to customer
 */
export const sendOrderCancelledEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const html = renderTemplate("orderCancelled", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    customerName: order.contact_name || order.company_name,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: order.email,
    subject: `Order Cancelled — ${order.order_id}`,
    html,
  });
};

/**
 * Send order dispatched email to customer (pickup or delivery)
 */
export const sendOrderDispatchedEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';
  const dispatchAddress = isPickup
    ? (order.pickup_location || 'To be determined')
    : (order.delivery_address || 'To be determined');

  const html = renderTemplate("orderDispatched", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    customerName: order.contact_name || order.company_name,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    greetingMessage: isPickup
      ? 'Your order is <strong style="color: #2e7d32;">ready for pickup</strong>! Here are the details:'
      : 'Your order is <strong style="color: #2e7d32;">out for delivery</strong>! Here are the details:',
    statusLabel: isPickup ? 'Ready for Pickup' : 'Out for Delivery',
    dispatchIcon: isPickup ? '📦' : '🚚',
    dispatchTitle: isPickup ? 'Pickup Details' : 'Delivery Details',
    dispatchAddress,
    dispatchNote: isPickup
      ? 'Please visit the above location to collect your order.'
      : 'Your order is on its way to the above address.',
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: order.email,
    subject: isPickup
      ? `Order Ready for Pickup — ${order.order_id}`
      : `Order Out for Delivery — ${order.order_id}`,
    html,
  });
};

/**
 * Send invoice email to customer with link to view invoice
 */
export const sendInvoiceSentEmail = async (invoice, customerInfo) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  // Build order numbers string from order_details
  let orderNumbers = '—';
  try {
    const details = typeof invoice.order_details === 'string'
      ? JSON.parse(invoice.order_details)
      : (invoice.order_details || []);
    orderNumbers = details.map(d => d.order_number).join(', ') || '—';
  } catch { orderNumbers = '—'; }

  const totalAmount = parseFloat(invoice.total_amount || 0).toFixed(2);
  const invoiceUrl = `${frontendUrl}/view-invoice/${invoice.id}`;

  const html = renderTemplate("invoiceSent", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    customerName: customerInfo.contact_name || customerInfo.company_name,
    invoiceNumber: invoice.invoice_number,
    orderNumbers,
    totalAmount,
    invoiceUrl,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: customerInfo.email,
    subject: `Invoice ${invoice.invoice_number} — Pixel Tracks`,
    html,
  });
};

/**
 * Send production assigned email to the assigned tech
 * @param {Object} production - production record
 * @param {Object|null} order - linked order (null for General Inventory)
 * @param {Object} techInfo - { id, username, email }
 * @param {Object|null} rawMaterialInfo - { supplier, color_name, color_code } for material details
 */
export const sendProductionAssignedEmail = async (production, order, techInfo, rawMaterialInfo) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isSpecificOrder = production.production_type === 'Specific Order' && order;

  // ── Build Order # row (only for Specific Order) ──
  const orderNumberRow = isSpecificOrder
    ? `<tr>
        <td style="padding: 12px 16px; font-size: 14px; color: #457b9d; font-weight: bold; border-bottom: 1px solid #e8e8e8;">
          Order #</td>
        <td style="padding: 12px 16px; font-size: 14px; color: #333333; border-bottom: 1px solid #e8e8e8;">
          ${production.order_id}</td>
       </tr>`
    : '';

  // ── Build type badge ──
  const typeBadge = isSpecificOrder
    ? `<span style="background-color: #cce5ff; color: #004085; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: bold;">${production.production_type}</span>`
    : `<span style="background-color: #e2e3f1; color: #3f3d56; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: bold;">${production.production_type}</span>`;

  // ── Build info section ──
  let infoSection = '';

  if (isSpecificOrder) {
    // Specific Order → show delivery/pickup info
    const isPickup = order.delivery_method === 'pickup';
    const deliveryAddress = isPickup
      ? (order.pickup_location || 'To be determined')
      : (order.delivery_address || 'To be determined');

    let deliveryDate = 'To be determined';
    if (order.pickup_date) {
      deliveryDate = new Date(order.pickup_date).toLocaleDateString('en-CA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    infoSection = `
      <tr>
        <td style="padding: 0 40px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background-color: #f0f7ff; border-radius: 8px; border: 1px solid #d6e8f7;">
            <tr>
              <td style="padding: 20px;">
                <p style="margin: 0 0 10px; font-size: 15px; font-weight: bold; color: #457b9d;">
                  ${isPickup ? '📦' : '🚚'} ${isPickup ? 'Pickup Details' : 'Delivery Details'}
                </p>
                <p style="margin: 0 0 8px; font-size: 14px; color: #333333;">
                  📍 <strong>${deliveryAddress}</strong>
                </p>
                <p style="margin: 0; font-size: 14px; color: #333333;">
                  📅 <strong>${isPickup ? 'Pickup' : 'Delivery'} Date:</strong> ${deliveryDate}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  } else {
    // General Inventory → show raw material details
    const supplier = rawMaterialInfo?.supplier || '—';
    const colorName = rawMaterialInfo?.color_name || '—';
    const colorCode = rawMaterialInfo?.color_code || '—';

    infoSection = `
      <tr>
        <td style="padding: 0 40px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background-color: #f5f0ff; border-radius: 8px; border: 1px solid #d9d0f0;">
            <tr>
              <td style="padding: 20px;">
                <p style="margin: 0 0 10px; font-size: 15px; font-weight: bold; color: #6c5ce7;">
                  🏭 Raw Material Details
                </p>
                <p style="margin: 0 0 8px; font-size: 14px; color: #333333;">
                  <strong>Manufacturer:</strong> ${supplier}
                </p>
                <p style="margin: 0 0 8px; font-size: 14px; color: #333333;">
                  <strong>Color Name:</strong> ${colorName}
                </p>
                <p style="margin: 0; font-size: 14px; color: #333333;">
                  <strong>Color Code:</strong> ${colorCode}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  // ── Build process flow label (e.g. "Full Roll → Slitted") ──
  const sourceType = rawMaterialInfo?.inventory_type || rawMaterialInfo?.supplier || 'Raw Material';
  const processFlow = `${sourceType} → ${production.target_state}`;

  const html = renderTemplate("productionAssigned", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    techName: techInfo.username,
    productionType: production.production_type,
    typeBadge,
    orderNumberRow,
    processFlow,
    qty: production.qty || 0,
    channelLength: production.channel_length || '—',
    infoSection,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: techInfo.email,
    subject: `Production Assigned — ${production.order_id || 'General Inventory'}`,
    html,
  });
};

/**
 * Send order modified email to customer
 */
export const sendOrderModifiedEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';

  // Build "What Changed" lines
  let changesLines = [];

  if (order.pickup_date) {
    const dateLabel = isPickup ? 'Pickup Date' : 'Delivery Date';
    const dateValue = String(order.pickup_date).substring(0, 10);
    changesLines.push(`📅 <strong>${dateLabel}:</strong> ${dateValue}`);
  }

  if (isPickup && order.pickup_location) {
    changesLines.push(`📍 <strong>Pickup Location:</strong> ${order.pickup_location}`);
  }

  const changesSection = changesLines.length > 0
    ? changesLines.map(line => `<p style="margin: 0 0 8px; font-size: 14px; color: #333333;">${line}</p>`).join('')
    : '<p style="margin: 0; font-size: 14px; color: #333333;">Order details were updated by admin.</p>';

  // Build notes section (only if modification_notes exist)
  let notesSection = '';
  if (order.modification_notes && order.modification_notes.trim()) {
    notesSection = `
      <tr>
        <td style="padding: 0 40px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background-color: #f0f7ff; border-radius: 8px; border: 1px solid #d6e8f7;">
            <tr>
              <td style="padding: 20px;">
                <p style="margin: 0 0 10px; font-size: 15px; font-weight: bold; color: #457b9d;">
                  📝 Admin Notes
                </p>
                <p style="margin: 0; font-size: 14px; color: #333333;">
                  ${order.modification_notes}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  const html = renderTemplate("orderModified", {
    logoUrl: `${backendUrl}/uploads/email/logo.png`,
    customerName: order.contact_name || order.company_name,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    changesSection,
    notesSection,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: order.email,
    subject: `Order Modified — ${order.order_id}`,
    html,
  });
};
