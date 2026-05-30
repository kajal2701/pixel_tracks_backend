-- Create password reset OTP table for customer forgot-password flow
CREATE TABLE IF NOT EXISTS prixel_password_resets (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,           -- FK to prixel_customers.id
    otp         VARCHAR(6) NOT NULL,    -- 6-digit code like "482917"
    expires_at  DATETIME NOT NULL,      -- OTP valid for 10 minutes
    attempts    INT DEFAULT 0,          -- wrong tries counter (max 5)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
