import axios from "axios";

const PROMAILER_API_KEY = process.env.PROMAILER_API_KEY;

export const sendMail = async ({ to, cc, subject, html, headers = {} }) => {
  const payload = {
    to,
    subject,
    html,
  };
  if (cc) payload.cc = cc;
  if (Object.keys(headers).length) payload.headers = headers;

  const response = await axios.post(
    "https://mailserver.automationlounge.com/api/v1/messages/send",
    payload,
    {
      headers: {
        "Authorization": `Bearer ${PROMAILER_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`[MAIL] Sent to=${to} subject="${subject}" messageId=${response.data?.data?.messageId}`);
  return response.data;
};

export const verifyMailer = async () => {
  if (!PROMAILER_API_KEY) {
    throw new Error("PROMAILER_API_KEY is not set");
  }
  console.log("[MAIL] Promailer API ready ✅");
  return true;
};