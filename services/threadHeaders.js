// services/threadHeaders.js

const DOMAIN = "pixeltracks.ca";

/**
 * Generate RFC 2822 threading headers for a customer-facing order email.
 * @param {string} orderId  — e.g. "PT-1001"
 * @param {string} event    — e.g. "confirmed", "dispatched", "completed"
 * @returns {{ 'Message-ID': string, 'In-Reply-To': string, 'References': string }}
 */
export function orderThreadHeaders(orderId, event) {
  const rootId = `<order-${orderId}@${DOMAIN}>`;
  const messageId = `<order-${orderId}-${event}@${DOMAIN}>`;
  return {
    "Message-ID": messageId,
    "In-Reply-To": rootId,
    "References": rootId,
  };
}
