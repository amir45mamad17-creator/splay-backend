require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================
// MySQL Connection
// ==============================

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

// ==============================
// Database Initialization
// ==============================

async function initializeDatabase() {
    const connection = await db.getConnection();

    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                username VARCHAR(100) NULL,
                premium_expires_at DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id BIGINT UNSIGNED NOT NULL,
                plan VARCHAR(30) NOT NULL,
                amount BIGINT UNSIGNED NOT NULL,
                status ENUM(
                    'PENDING',
                    'PAYMENT_STARTED',
                    'PAID',
                    'FAILED',
                    'CANCELLED'
                ) NOT NULL DEFAULT 'PENDING',
                ref_id VARCHAR(255) NULL,
                sale_order_id VARCHAR(100) NULL,
                sale_reference_id VARCHAR(100) NULL,
                response_code VARCHAR(20) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                paid_at DATETIME NULL,
                premium_expires_at DATETIME NULL,
                PRIMARY KEY (id),
                INDEX idx_orders_user_id (user_id),
                INDEX idx_orders_status (status),
                INDEX idx_orders_ref_id (ref_id),
                CONSTRAINT fk_orders_user
                    FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE
            )
        `);

        console.log("Database tables are ready.");

    } finally {
        connection.release();
    }
}

// ==============================
// Home
// ==============================

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "SPlay Backend",
        message: "SPlay backend is running"
    });
});

// ==============================
// Health Check
// ==============================

app.get("/health", async (req, res) => {
    try {
        await db.query("SELECT 1");

        res.json({
            success: true,
            status: "OK",
            database: "CONNECTED"
        });

    } catch (error) {
        console.error("Database health check failed:", error);

        res.status(500).json({
            success: false,
            status: "ERROR",
            database: "DISCONNECTED"
        });
    }
});

// ==============================
// Test Database
// ==============================

app.get("/api/database-test", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT NOW() AS server_time");

        res.json({
            success: true,
            message: "MySQL connection successful",
            serverTime: rows[0].server_time
        });

    } catch (error) {
        console.error("Database test failed:", error);

        res.status(500).json({
            success: false,
            message: "MySQL connection failed",
            error: error.message
        });
    }
});

// ==============================
// Server Start
// ==============================

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initializeDatabase();

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`SPlay Backend running on port ${PORT}`);
        });

    } catch (error) {
        console.error("Failed to start SPlay Backend.");
        console.error(error);

        process.exit(1);
    }
}

startServer();
