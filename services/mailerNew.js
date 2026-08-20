import nodemailer from "nodemailer";

// ─── SMTP Transporter (smtp.gmail.com:587 / STARTTLS) ─────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,          // false = STARTTLS on port 587
    requireTLS: true,       // enforce STARTTLS upgrade
    auth: {
        user: process.env.SMTP_USER || "quote@canstarlight.ca",
        pass: process.env.SMTP_PASS || "lpyyzoryawtewpph",
    },
    tls: {
        rejectUnauthorized: false, // allows self-signed certs if needed
    },
});

// ─── sendMail — same signature as before ──────────────────────────────────────
export const sendMail2 = async ({ to, cc, subject, html, from, replyTo }) => {
    const mailOptions = {
        from: from || `"Canstar Light" <quote@canstarlight.ca>`,
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
