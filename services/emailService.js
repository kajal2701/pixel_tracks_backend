import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendMail } from "./mailer.js";
import db from "../db.js";

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
 * Send order placed email — works for both customer and sales team.
 * @param {Object} order - order row joined with customer info
 * @param {'customer'|'sales'} recipient - who the email is for
 */
const sendOrderPlacedNotification = async (order, recipient = 'customer') => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  // Dynamic content based on recipient
  const isSales = recipient === 'sales';
  const greeting = isSales
    ? `Hello <strong>Sales Team</strong>,`
    : `Hello <strong>${order.contact_name || order.company_name}</strong>,`;
  const introMessage = isSales
    ? `A new order has been received from <strong>${order.contact_name || order.company_name}</strong>. Here is a quick summary:`
    : `Thank you for your order. Here is a quick summary:`;
  const noteHeading = isSales
    ? `Waiting for confirmation.`
    : `This is not an order confirmation.`;
  const noteBody = isSales
    ? `Please review the inventory and confirm this order in the admin portal.`
    : `Our team will send you a separate email to confirm your order once we verify the availability of supplies.`;

  const html = renderTemplate("orderPlaced", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting,
    introMessage,
    noteHeading,
    noteBody,
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

  if (isSales) {
    // Fetch all active sales users
    const [salesUsers] = await db.query(
      'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
      ['sales', 'active']
    );
    const emails = salesUsers.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return;

    return sendMail({
      to: emails.join(","),
      subject: `Order Received - Notification of new order; Waiting for confirmation. (${order.order_id})`,
      html,
    });
  }

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Order Placed — ${order.order_id}`,
    html,
  });
};

/**
 * Send order placed email to customer
 */
export const sendOrderPlacedEmail = (order) =>
  sendOrderPlacedNotification(order, 'customer');

/**
 * Send order confirmed email — works for customer, sales, and operations.
 * @param {Object} order - order row joined with customer info
 * @param {'customer'|'sales'|'operations'} recipient - who the email is for
 */
const sendOrderConfirmedNotification = async (order, recipient = 'customer') => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';
  const deliveryLabel = isPickup ? '📦 Pickup Details' : '🚚 Delivery Details';
  const deliveryAddress = isPickup
    ? (order.pickup_location || 'To be determined')
    : (order.delivery_address || 'To be determined');
  const deliveryMethod = isPickup ? 'pickup' : 'delivery';

  let estimatedDate = 'To be determined';
  if (order.pickup_date) {
    estimatedDate = new Date(order.pickup_date).toLocaleDateString('en-CA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // Dynamic content based on recipient
  const isTeam = recipient === 'sales' || recipient === 'operations';
  const teamLabel = recipient === 'operations' ? 'Operations Team' : 'Sales Team';

  const greeting = isTeam
    ? `Hello <strong>${teamLabel}</strong>,`
    : `Hello <strong>${order.contact_name || order.company_name}</strong>,`;
  const introMessage = isTeam
    ? `Order <strong>${order.order_id}</strong> for <strong>${order.contact_name || order.company_name}</strong> has been confirmed. Here are the details:`
    : `Great news! Your order has been <strong style="color: #2a9d8f;">confirmed</strong>. Here are the details:`;
  const noteBody = recipient === 'operations'
    ? `Please plan production and logistics for this order accordingly.`
    : (recipient === 'sales'
      ? `This is a copy of the confirmation email sent to the customer.`
      : `We will notify you when your order is ready for ${deliveryMethod}. If you have any questions, feel free to reach out to us.`);

  const html = renderTemplate("orderConfirmed", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting,
    introMessage,
    noteBody,
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

  if (isTeam) {
    const [users] = await db.query(
      'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
      [recipient, 'active']
    );
    const emails = users.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return;

    console.log(emails, "emails")

    const subjectTag = recipient === 'operations' ? 'Operations Team' : 'Sales Team';
    return sendMail({
      to: emails.join(","),
      subject: `Order Confirmed (${subjectTag}) — ${order.order_id}`,
      html,
    });
  }

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Order Confirmed — ${order.order_id}`,
    html,
  });
};

/**
 * Send order confirmed email to customer
 */
export const sendOrderConfirmedEmail = (order) =>
  sendOrderConfirmedNotification(order, 'customer');

/**
 * Send order confirmed email to all sales users
 */
export const sendOrderConfirmedSalesEmail = async (order) => {
  try {
    await sendOrderConfirmedNotification(order, 'sales');
  } catch (error) {
    console.error("Failed to fetch sales users for order confirmed email:", error);
  }
};

/**
 * Send order confirmed email to all operations users
 */
export const sendOrderConfirmedOpsEmail = async (order) => {
  try {
    await sendOrderConfirmedNotification(order, 'operations');
  } catch (error) {
    console.error("Failed to send order confirmed ops email:", error);
  }
};

/**
 * Send order cancelled email — works for both customer and sales team.
 * @param {Object} order - order row joined with customer info
 * @param {'customer'|'sales'} recipient - who the email is for
 */
const sendOrderCancelledNotification = async (order, recipient = 'customer') => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isSales = recipient === 'sales';
  const greeting = isSales
    ? `Hello <strong>Sales Team</strong>,`
    : `Hello <strong>${order.contact_name || order.company_name}</strong>,`;
  const introMessage = isSales
    ? `Order <strong>${order.order_id}</strong> for <strong>${order.contact_name || order.company_name}</strong> has been <strong style="color: #dc3545;">cancelled</strong>. Here are the details:`
    : `We regret to inform you that your order has been <strong style="color: #dc3545;">cancelled</strong>. Here are the details:`;
  const infoMessage = isSales
    ? `This order has been cancelled. Inventory holds have been released and linked production records have been stopped.`
    : `This order has been cancelled by the admin. If you believe this was done in error or have any questions, please contact us immediately.`;

  const html = renderTemplate("orderCancelled", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting,
    introMessage,
    infoMessage,
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

  if (isSales) {
    const [salesUsers] = await db.query(
      'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
      ['sales', 'active']
    );
    const emails = salesUsers.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return;

    return sendMail({
      to: emails.join(","),
      subject: `Order Cancelled (Sales Team) — ${order.order_id}`,
      html,
    });
  }

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Order Cancelled — ${order.order_id}`,
    html,
  });
};

/**
 * Send order cancelled email to customer
 */
export const sendOrderCancelledEmail = (order) =>
  sendOrderCancelledNotification(order, 'customer');

/**
 * Send order cancelled email to all sales users
 */
export const sendOrderCancelledSalesEmail = async (order) => {
  try {
    await sendOrderCancelledNotification(order, 'sales');
  } catch (error) {
    console.error("Failed to send cancelled sales email:", error);
  }
};

/**
 * Send order dispatched email — works for customer, sales, and operations.
 * @param {Object} order - order row joined with customer info
 * @param {'customer'|'sales'|'operations'} recipient - who the email is for
 */
const sendOrderDispatchedNotification = async (order, recipient = 'customer') => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';
  const dispatchAddress = isPickup
    ? (order.pickup_location || 'To be determined')
    : (order.delivery_address || 'To be determined');

  // Dynamic content based on recipient
  const isTeam = recipient === 'sales' || recipient === 'operations';
  const teamLabel = recipient === 'operations' ? 'Operations Team' : 'Sales Team';

  const greeting = isTeam
    ? `Hello <strong>${teamLabel}</strong>,`
    : `Hello <strong>${order.contact_name || order.company_name}</strong>,`;
  const greetingMessage = isTeam
    ? (isPickup
      ? `Order <strong>${order.order_id}</strong> for <strong>${order.contact_name || order.company_name}</strong> is <strong style="color: #2e7d32;">ready for pickup</strong>. Here are the details:`
      : `Order <strong>${order.order_id}</strong> for <strong>${order.contact_name || order.company_name}</strong> is <strong style="color: #2e7d32;">out for delivery</strong>. Here are the details:`)
    : (isPickup
      ? 'Your order is <strong style="color: #2e7d32;">ready for pickup</strong>! Here are the details:'
      : 'Your order is <strong style="color: #2e7d32;">out for delivery</strong>! Here are the details:');
  const dispatchNote = isTeam
    ? (isPickup
      ? `Customer will visit the above location to collect the order.`
      : `Order is on its way to the customer's address.`)
    : (isPickup
      ? 'Please visit the above location to collect your order.'
      : 'Your order is on its way to the above address.');
  const noteBody = recipient === 'operations'
    ? `Please ensure logistics and handover are ready at the dispatch location.`
    : (recipient === 'sales'
      ? `This is a copy of the dispatch notification sent to the customer.`
      : `If you have any questions, feel free to reach out to us.`);

  const html = renderTemplate("orderDispatched", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting,
    greetingMessage,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    statusLabel: isPickup ? 'Ready for Pickup' : 'Out for Delivery',
    dispatchIcon: isPickup ? '📦' : '🚚',
    dispatchTitle: isPickup ? 'Pickup Details' : 'Delivery Details',
    dispatchAddress,
    dispatchNote,
    noteBody,
    year: new Date().getFullYear().toString(),
  });

  if (isTeam) {
    const [users] = await db.query(
      'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
      [recipient, 'active']
    );
    const emails = users.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return;

    const subjectTag = recipient === 'operations' ? 'Operations Team' : 'Sales Team';
    return sendMail({
      to: emails.join(","),
      subject: isPickup
        ? `Order Ready for Pickup (${subjectTag}) — ${order.order_id}`
        : `Order Out for Delivery (${subjectTag}) — ${order.order_id}`,
      html,
    });
  }

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: isPickup
      ? `Order Ready for Pickup — ${order.order_id}`
      : `Order Out for Delivery — ${order.order_id}`,
    html,
  });
};

/**
 * Send order dispatched email to customer
 */
export const sendOrderDispatchedEmail = (order) =>
  sendOrderDispatchedNotification(order, 'customer');

/**
 * Send order dispatched email to all sales users
 */
export const sendOrderDispatchedSalesEmail = async (order) => {
  try {
    await sendOrderDispatchedNotification(order, 'sales');
  } catch (error) {
    console.error("Failed to send dispatched sales email:", error);
  }
};

/**
 * Send order dispatched email to all operations users
 */
export const sendOrderDispatchedOpsEmail = async (order) => {
  try {
    await sendOrderDispatchedNotification(order, 'operations');
  } catch (error) {
    console.error("Failed to send dispatched ops email:", error);
  }
};

/**
 * Send order picked up / completed notification — works for sales and operations.
 * @param {Object} order - order row joined with customer info
 * @param {'sales'|'operations'} recipient - which team to notify
 */
const sendOrderPickedUpNotification = async (order, recipient = 'sales') => {
  const [users] = await db.query(
    'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
    [recipient, 'active']
  );
  const emails = users.map((u) => u.email).filter((e) => e);
  if (emails.length === 0) return;

  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;
  const teamLabel = recipient === 'operations' ? 'Operations Team' : 'Sales Team';

  const isPickup = order.delivery_method === 'pickup';
  const pickupAddress = isPickup
    ? (order.pickup_location || 'To be determined')
    : (order.delivery_address || 'To be determined');

  const noteBody = recipient === 'operations'
    ? `This order is now completed. Please update logistics records accordingly.`
    : `This order is now marked as completed. Inventory has been deducted accordingly.`;

  const html = renderTemplate("orderPickedUp", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting: `Hello <strong>${teamLabel}</strong>,`,
    introMessage: isPickup
      ? `Order <strong>${order.order_id}</strong> has been <strong style="color: #2e7d32;">picked up</strong> by <strong>${order.contact_name || order.company_name}</strong>.`
      : `Order <strong>${order.order_id}</strong> has been <strong style="color: #2e7d32;">delivered</strong> to <strong>${order.contact_name || order.company_name}</strong>.`,
    customerName: order.contact_name || order.company_name,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    pickupLabel: isPickup ? 'Pickup Location' : 'Delivery Address',
    pickupAddress,
    pickupNote: isPickup
      ? `Customer has collected the order from the above location.`
      : `Order has been delivered to the above address.`,
    noteBody,
    year: new Date().getFullYear().toString(),
  });

  const subjectTag = recipient === 'operations' ? 'Operations Team' : 'Sales Team';
  const mailOptions = {
    to: recipient === 'sales' ? `${emails.join(",")},pixeltracksandtechnology@gmail.com` : emails.join(","),
    subject: isPickup
      ? `Order Picked Up (${subjectTag}) — ${order.order_id}`
      : `Order Delivered (${subjectTag}) — ${order.order_id}`,
    html,
  };

  if (recipient === 'sales') {
    mailOptions.bcc = 'hamam516@gmail.com';
  }

  return sendMail(mailOptions);
};

/**
 * Send order picked up email to all sales users
 */
export const sendOrderPickedUpSalesEmail = async (order) => {
  try {
    await sendOrderPickedUpNotification(order, 'sales');
  } catch (error) {
    console.error("Failed to send order picked up sales email:", error);
  }
};

/**
 * Send order picked up email to all operations users
 */
export const sendOrderPickedUpOpsEmail = async (order) => {
  try {
    await sendOrderPickedUpNotification(order, 'operations');
  } catch (error) {
    console.error("Failed to send order picked up ops email:", error);
  }
};

/**
 * Send order completed email to customer
 * Fired when an order status is changed to "Completed"
 */
export const sendOrderCompletedEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';
  const deliveryAddress = isPickup
    ? (order.pickup_location || 'To be determined')
    : (order.delivery_address || 'To be determined');

  const html = renderTemplate("orderCompleted", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting: `Hello <strong>${order.contact_name || order.company_name}</strong>,`,
    introMessage: isPickup
      ? `Your order has been <strong style="color: #2e7d32;">completed</strong>. Thank you for picking it up!`
      : `Your order has been <strong style="color: #2e7d32;">completed</strong> and delivered successfully!`,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    deliveryIcon: isPickup ? '📦' : '🚚',
    deliveryLabel: isPickup ? 'Pickup Details' : 'Delivery Details',
    deliveryAddress,
    deliveryNote: isPickup
      ? `Order was picked up from the above location.`
      : `Order was delivered to the above address.`,
    noteBody: `Thank you for choosing Pixel Tracks & Lights! If you have any questions or concerns about your order, feel free to reach out to us.`,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Order Completed — ${order.order_id}`,
    html,
  });
};

/**
 * Send invoice email — works for both customer and sales team.
 * @param {Object} invoice - invoice row
 * @param {Object} customerInfo - { contact_name, company_name, email }
 * @param {'customer'|'sales'} recipient - who the email is for
 */
const sendInvoiceNotification = async (invoice, customerInfo, recipient = 'customer') => {
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

  // Dynamic content based on recipient
  const isSales = recipient === 'sales';
  const customerName = customerInfo.contact_name || customerInfo.company_name;
  const greeting = isSales
    ? `Hello <strong>Sales Team</strong>,`
    : `Hello <strong>${customerName}</strong>,`;
  const introMessage = isSales
    ? `Invoice <strong>${invoice.invoice_number}</strong> has been sent to <strong>${customerName}</strong>. Here are the details:`
    : `A new invoice has been generated for your order(s). Please find the details below:`;
  const noteBody = isSales
    ? `This is a copy of the invoice email sent to the customer.`
    : `If you have any questions about this invoice, feel free to reach out to us.`;

  const html = renderTemplate("invoiceSent", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting,
    introMessage,
    noteBody,
    invoiceNumber: invoice.invoice_number,
    orderNumbers,
    totalAmount,
    invoiceUrl,
    year: new Date().getFullYear().toString(),
  });

  if (isSales) {
    const [salesUsers] = await db.query(
      'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
      ['sales', 'active']
    );
    const emails = salesUsers.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return;

    return sendMail({
      to: emails.join(","),
      subject: `Invoice Sent (Sales Team) — ${invoice.invoice_number}`,
      html,
    });
  }

  return sendMail({
    to: `${customerInfo.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Invoice ${invoice.invoice_number} — Pixel Tracks`,
    html,
  });
};

/**
 * Send invoice email to customer
 */
export const sendInvoiceSentEmail = (invoice, customerInfo) =>
  sendInvoiceNotification(invoice, customerInfo, 'customer');

/**
 * Send invoice email to all sales users
 */
export const sendInvoiceSentSalesEmail = async (invoice, customerInfo) => {
  try {
    await sendInvoiceNotification(invoice, customerInfo, 'sales');
  } catch (error) {
    console.error("Failed to send invoice sales email:", error);
  }
};

/**
 * Send payment submitted notification to all sales users
 * Fired when a customer uploads a payment screenshot
 */
export const sendPaymentSubmittedSalesEmail = async (invoice) => {
  try {
    const [salesUsers] = await db.query(
      'SELECT email FROM prixel_admin_users WHERE role = ? AND status = ?',
      ['sales', 'active']
    );
    const emails = salesUsers.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return;

    // Fetch customer info
    const [customerRows] = await db.query(
      'SELECT company_name, contact_name, email FROM prixel_customers WHERE id = ?',
      [invoice.customer_id]
    );
    const customerName = customerRows[0]?.contact_name || customerRows[0]?.company_name || '—';

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

    // Build order numbers
    let orderNumbers = '—';
    try {
      const details = typeof invoice.order_details === 'string'
        ? JSON.parse(invoice.order_details)
        : (invoice.order_details || []);
      orderNumbers = details.map(d => d.order_number).join(', ') || '—';
    } catch { orderNumbers = '—'; }

    const totalAmount = parseFloat(invoice.total_amount || 0).toFixed(2);

    const html = renderTemplate("paymentSubmitted", {
      logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
      greeting: `Hello <strong>Sales Team</strong>,`,
      introMessage: `Payment has been submitted by <strong>${customerName}</strong> for invoice <strong>${invoice.invoice_number}</strong>. Please review and confirm.`,
      customerName,
      invoiceNumber: invoice.invoice_number,
      orderNumbers,
      totalAmount,
      infoMessage: `The customer has uploaded a payment screenshot. Please review it in the admin portal and confirm the payment.`,
      noteBody: `This invoice is now in "Payment Submitted" status and awaiting admin confirmation.`,
      year: new Date().getFullYear().toString(),
    });

    return sendMail({
      to: `${emails.join(",")},pixeltracksandtechnology@gmail.com`,
      bcc: 'hamam516@gmail.com',
      subject: `Payment Submitted — ${invoice.invoice_number}`,
      html,
    });
  } catch (error) {
    console.error("Failed to send payment submitted sales email:", error);
  }
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
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
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
    to: `${techInfo.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Production Assigned — ${production.order_id || 'General Inventory'}`,
    html,
  });
};

/**
 * Send order modified email to customer
 */
export const sendOrderModifiedEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const isPickup = order.delivery_method === 'pickup';

  let modNote = order.modification_notes;
  let pickupDate = order.pickup_date;
  let pickupLocation = order.pickup_location;

  try {
    if (order.modification_notes) {
      const parsed = JSON.parse(order.modification_notes);
      if (parsed && parsed.status === 'pending') {
        modNote = parsed.note;
        pickupDate = parsed.pickup_date;
        pickupLocation = parsed.pickup_location;
      }
    }
  } catch (e) {
    // Not JSON, fall back to default values
  }

  // Build "What Changed" lines based on pending values
  let changesLines = [];

  if (pickupDate) {
    const dateLabel = isPickup ? 'Pickup Date' : 'Delivery Date';
    const dateValue = String(pickupDate).substring(0, 10);
    changesLines.push(`📅 <strong>${dateLabel}:</strong> ${dateValue}`);
  }

  if (isPickup && pickupLocation) {
    changesLines.push(`📍 <strong>Pickup Location:</strong> ${pickupLocation}`);
  }

  const changesSection = changesLines.length > 0
    ? changesLines.map(line => `<p style="margin: 0 0 8px; font-size: 14px; color: #333333;">${line}</p>`).join('')
    : '<p style="margin: 0; font-size: 14px; color: #333333;">Order details were updated by admin.</p>';

  // Build notes section (only if modification_notes exist)
  let notesSection = '';
  if (modNote && modNote.trim()) {
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
                  ${modNote}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  const approveUrl = `${frontendUrl}/modification-resolve?orderId=${order.id}&action=approve`;
  const cancelUrl = `${frontendUrl}/modification-resolve?orderId=${order.id}&action=cancel`;

  const html = renderTemplate("orderModified", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
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
    approveUrl,
    cancelUrl,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Order Modification Request — ${order.order_id}`,
    html,
  });
};

/**
 * Send order received email to all sales users
 */
export const sendOrderReceivedSalesEmail = async (order) => {
  try {
    await sendOrderPlacedNotification(order, 'sales');
  } catch (error) {
    console.error("Failed to fetch sales users for order received email:", error);
  }
};

/**
 * Send inventory transfer task email to the assigned production tech.
 * Fired when an order is dispatched and a tech is assigned to handle the physical transfer.
 * @param {Object} order - order row joined with customer info
 * @param {Object} techInfo - { id, username, email }
 * @param {Array} sourceLocs - [{ location, pieces }, ...]
 * @param {string} destination - pickup location or delivery address
 */
export const sendInventoryTransferEmail = async (order, techInfo, sourceLocs, destination) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const isPickup = order.delivery_method === 'pickup';

  // Build source locations table rows HTML
  const sourceRows = (sourceLocs || [])
    .filter(src => src.pieces > 0)
    .map(src => `
      <tr>
        <td style="padding: 8px 12px; font-size: 14px; color: #333333; border-bottom: 1px solid #ffe082;">${src.location}</td>
        <td style="padding: 8px 12px; font-size: 14px; color: #e65100; font-weight: bold; text-align: center; border-bottom: 1px solid #ffe082;">${src.pieces} pcs</td>
      </tr>`)
    .join('');

  const sourceLocationsTable = sourceLocs && sourceLocs.filter(s => s.pieces > 0).length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-top: 8px;">
        <tr style="background-color: #ffecb3;">
          <th style="padding: 8px 12px; text-align: left; font-size: 13px; color: #795548; border-bottom: 2px solid #ffe082;">Source Location</th>
          <th style="padding: 8px 12px; text-align: center; font-size: 13px; color: #795548; border-bottom: 2px solid #ffe082;">Pieces to Move</th>
        </tr>
        ${sourceRows}
      </table>`
    : '<p style="margin: 0; font-size: 14px; color: #888888;">No specific source locations specified.</p>';

  // Build delivery date string
  let estimatedDate = 'To be determined';
  if (order.pickup_date) {
    estimatedDate = new Date(order.pickup_date).toLocaleDateString('en-CA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  const taskType = isPickup ? 'Transfer inventory to pickup location' : 'Collect inventory for delivery';
  const deliveryMethod = isPickup ? '📦 Pickup' : '🚚 Delivery';
  const destinationIcon = isPickup ? '📦' : '🚚';

  const html = renderTemplate('inventoryTransfer', {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    techName: techInfo.username,
    orderId: order.order_id,
    color: order.color || '—',
    totalPieces: order.total_pieces || '—',
    taskType,
    deliveryMethod,
    estimatedDate,
    sourceLocationsTable,
    destination: destination || '—',
    destinationIcon,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: `${techInfo.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Inventory Transfer Task Assigned — ${order.order_id}`,
    html,
  });
};

/**
 * Send order modification email to customer and admin
 * Fired when a customer edits their own pending order
 */
export const sendCustomerOrderModificationEmail = async (order) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 8000}`;

  const greeting = `Hello <strong>${order.contact_name || order.company_name}</strong>,`;
  const introMessage = `Your order <strong>${order.order_id}</strong> has been successfully updated. Here are the current details:`;
  const noteHeading = `Order Updated`;
  const noteBody = `You have modified your pending order. Our team has been notified of the changes.`;

  const html = renderTemplate("customerOrderModification", {
    logoUrl: `${backendUrl}/uploads/email/light_logo.png`,
    greeting,
    introMessage,
    noteHeading,
    noteBody,
    orderId: order.order_id,
    channelType: order.channel_type,
    color: order.color,
    holeDistance: order.hole_distance,
    channelLength: order.channel_length,
    totalLength: order.total_length,
    totalPieces: order.total_pieces,
    finalLength: order.final_length,
    orderStatus: order.order_status,
    year: new Date().getFullYear().toString(),
  });

  return sendMail({
    to: `${order.email},pixeltracksandtechnology@gmail.com`,
    bcc: 'hamam516@gmail.com',
    subject: `Order Modification — ${order.order_id}`,
    html,
  });
};
