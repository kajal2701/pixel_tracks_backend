import nodemailer from "nodemailer";

// ─── SMTP Transporter (Brevo) ─────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    requireTLS: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production" ? true : false,
    },
});

// ─── sendMail — same signature as before ──────────────────────────────────────
export const sendMail2 = async ({ to, cc, subject, html, from, replyTo }) => {
    const mailOptions = {
        from: from || `"Pixel Tracks" <kajalgohil2112@gmail.com>`, // must match verified sender
        to,
        subject,
        html,
    };
    if (cc) mailOptions.cc = cc;
    if (replyTo) mailOptions.replyTo = replyTo;

    const info = await transporter.sendMail(mailOptions);
    console.log(`[MAIL] Sent to=${to} subject="${subject}" messageId=${info.messageId}`);
    return info;
};

// ─── verifyMailer — tests SMTP connection on startup ─────────────────────────
export const verifyMailer2 = async () => {
    try {
        await transporter.verify();
        console.log("[MAIL] SMTP connection verified ✅");
        return true;
    } catch (error) {
        console.error("[MAIL] SMTP connection FAILED:", error.message);
        throw error;
    }
};