import axios from "axios";

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.SMTP_FROM || "kajalgohil2112@gmail.com";
const FROM_NAME = process.env.SMTP_FROM_NAME || "Pixel Tracks";

/**
 * Send an email via Brevo HTTP API (bypasses SMTP port blocking on Render).
 * Signature matches what emailService.js already uses.
 */
export const sendMail = async ({ to, cc, bcc, subject, html, headers = {} }) => {
  // Parse "to" — can be comma-separated string
  const toList = String(to)
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e)
    .map((email) => ({ email }));

  const payload = {
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: toList,
    subject,
    htmlContent: html,
  };

  if (cc) {
    payload.cc = String(cc)
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e)
      .map((email) => ({ email }));
  }

  if (bcc) {
    payload.bcc = String(bcc)
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e)
      .map((email) => ({ email }));
  }

  if (Object.keys(headers).length) {
    payload.headers = headers;
  }

  const response = await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    payload,
    {
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`[MAIL] Sent to=${to} subject="${subject}" messageId=${response.data?.messageId}`);
  return response.data;
};

/**
 * Verify Brevo API key is configured.
 */
export const verifyMailer = async () => {
  if (!BREVO_API_KEY) {
    throw new Error("SMTP_PASS (Brevo API key) is not set");
  }

  // Quick check — get account info to verify key works
  try {
    await axios.get("https://api.brevo.com/v3/account", {
      headers: { "api-key": BREVO_API_KEY },
    });
    console.log("[MAIL] Brevo API ready ✅");
  } catch (err) {
    console.error("[MAIL] Brevo API key verification failed:", err.message);
    throw err;
  }

  return true;
};