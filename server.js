const express = require("express");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ============================================================
// DATABASE
// ============================================================

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "defaultdb",

    ssl: {
        rejectUnauthorized: false
    },

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

// ============================================================
// PREMIUM PLANS
// ============================================================

const PREMIUM_PLANS = {
    monthly: {
        id: "monthly",
        title: "یک ماهه",
        days: 30,
        toman: 199000,
        rial: 1990000
    },

    three_months: {
        id: "three_months",
        title: "سه ماهه",
        days: 90,
        toman: 499000,
        rial: 4990000
    },

    six_months: {
        id: "six_months",
        title: "شش ماهه",
        days: 180,
        toman: 799000,
        rial: 7990000
    },

    yearly: {
        id: "yearly",
        title: "یک ساله",
        days: 365,
        toman: 1299000,
        rial: 12990000
    }
};

// ============================================================
// HELPERS
// ============================================================

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
}

function generateOrderId() {
    return (
        Date.now().toString() +
        Math.floor(1000 + Math.random() * 9000).toString()
    );
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

async function columnExists(tableName, columnName) {
    const [rows] = await pool.query(
        `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        `,
        [tableName, columnName]
    );

    return Number(rows[0].count) > 0;
}

async function indexExists(tableName, indexName) {
    const [rows] = await pool.query(
        `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
        `,
        [tableName, indexName]
    );

    return Number(rows[0].count) > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
    const exists = await columnExists(tableName, columnName);

    if (!exists) {
        console.log(`Adding missing column ${tableName}.${columnName}`);

        await pool.query(
            `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
        );
    }
}

// ============================================================
// DATABASE INITIALIZATION + MIGRATION
// ============================================================

async function initializeDatabase() {
    console.log("Initializing database...");

    // --------------------------------------------------------
    // USERS
    // --------------------------------------------------------

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            email VARCHAR(255) NULL,
            password_hash VARCHAR(255) NULL,
            premium_expires_at DATETIME NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    // Add missing columns from old versions of the table.

    await addColumnIfMissing(
        "users",
        "username",
        "VARCHAR(100) NULL"
    );

    await addColumnIfMissing(
        "users",
        "email",
        "VARCHAR(255) NULL"
    );

    await addColumnIfMissing(
        "users",
        "password_hash",
        "VARCHAR(255) NULL"
    );

    await addColumnIfMissing(
        "users",
        "premium_expires_at",
        "DATETIME NULL"
    );

    await addColumnIfMissing(
        "users",
        "created_at",
        "DATETIME NULL"
    );

    await addColumnIfMissing(
        "users",
        "updated_at",
        "DATETIME NULL"
    );

    // --------------------------------------------------------
    // ORDERS
    // --------------------------------------------------------

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(100) NOT NULL,
            user_id INT NOT NULL,
            plan_id VARCHAR(50) NOT NULL,
            amount INT NOT NULL,
            status VARCHAR(30) DEFAULT 'PENDING',

            ref_id VARCHAR(255) NULL,
            sale_order_id VARCHAR(255) NULL,
            sale_reference_id VARCHAR(255) NULL,
            response_code VARCHAR(50) NULL,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            paid_at DATETIME NULL,
            premium_expires_at DATETIME NULL,

            UNIQUE KEY unique_order_id (order_id)
        )
    `);

    await addColumnIfMissing(
        "orders",
        "ref_id",
        "VARCHAR(255) NULL"
    );

    await addColumnIfMissing(
        "orders",
        "sale_order_id",
        "VARCHAR(255) NULL"
    );

    await addColumnIfMissing(
        "orders",
        "sale_reference_id",
        "VARCHAR(255) NULL"
    );

    await addColumnIfMissing(
        "orders",
        "response_code",
        "VARCHAR(50) NULL"
    );

    await addColumnIfMissing(
        "orders",
        "paid_at",
        "DATETIME NULL"
    );

    await addColumnIfMissing(
        "orders",
        "premium_expires_at",
        "DATETIME NULL"
    );

    // --------------------------------------------------------
    // UNIQUE EMAIL INDEX
    // --------------------------------------------------------

    const emailIndexExists = await indexExists(
        "users",
        "unique_email"
    );

    if (!emailIndexExists) {
        try {
            await pool.query(`
                ALTER TABLE users
                ADD UNIQUE KEY unique_email (email)
            `);

            console.log("Unique email index created.");
        } catch (error) {
            console.log(
                "Could not create unique_email index:",
                error.message
            );

            console.log(
                "This usually means duplicate emails already exist."
            );
        }
    }

    console.log("Database initialization completed.");
}

// ============================================================
// HEALTH
// ============================================================

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            success: true,
            status: "OK",
            database: "CONNECTED"
        });

    } catch (error) {
        console.error("Health error:", error);

        res.status(500).json({
            success: false,
            status: "ERROR",
            database: "DISCONNECTED",
            error: error.message
        });
    }
});

// ============================================================
// DATABASE TEST
// ============================================================

app.get("/api/database-test", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT NOW() AS serverTime"
        );

        res.json({
            success: true,
            message: "MySQL connection successful",
            serverTime: rows[0].serverTime
        });

    } catch (error) {
        console.error("Database test error:", error);

        res.status(500).json({
            success: false,
            message: "MySQL connection failed",
            error: error.message
        });
    }
});

// ============================================================
// REGISTER
// ============================================================

app.post("/api/auth/register", async (req, res) => {
    try {
        const {
            username,
            email,
            password
        } = req.body;

        console.log("Register request received:", {
            username,
            email
        });

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Username, email and password are required."
            });
        }

        const cleanUsername = String(username).trim();
        const cleanEmail = String(email).trim().toLowerCase();
        const cleanPassword = String(password);

        if (cleanUsername.length < 3) {
            return res.status(400).json({
                success: false,
                message: "Username must contain at least 3 characters."
            });
        }

        if (cleanPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must contain at least 6 characters."
            });
        }

        // ----------------------------------------------------
        // Check existing username
        // ----------------------------------------------------

        const [usernameRows] = await pool.query(
            `
            SELECT id
            FROM users
            WHERE username = ?
            LIMIT 1
            `,
            [cleanUsername]
        );

        if (usernameRows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Username already exists."
            });
        }

        // ----------------------------------------------------
        // Check existing email
        // ----------------------------------------------------

        const [emailRows] = await pool.query(
            `
            SELECT id
            FROM users
            WHERE email = ?
            LIMIT 1
            `,
            [cleanEmail]
        );

        if (emailRows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Email already exists."
            });
        }

        // ----------------------------------------------------
        // Hash password
        // ----------------------------------------------------

        const passwordHash = hashPassword(cleanPassword);

        // ----------------------------------------------------
        // Insert user
        // ----------------------------------------------------

        const [result] = await pool.query(
            `
            INSERT INTO users
            (
                username,
                email,
                password_hash,
                premium_expires_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, NULL, NOW(), NOW())
            `,
            [
                cleanUsername,
                cleanEmail,
                passwordHash
            ]
        );

        console.log(
            "User created successfully. ID:",
            result.insertId
        );

        return res.status(201).json({
            success: true,
            message: "Account created successfully.",
            userId: result.insertId
        });

    } catch (error) {
        console.error("================================");
        console.error("REGISTER ERROR");
        console.error(error);
        console.error("================================");

        // TEMPORARY DEBUG RESPONSE
        // This will help us identify the exact MySQL problem.

        return res.status(500).json({
            success: false,
            message: "Could not create account",
            error: error.message,
            code: error.code || null,
            errno: error.errno || null,
            sqlState: error.sqlState || null
        });
    }
});

// ============================================================
// LOGIN
// ============================================================

app.post("/api/auth/login", async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const cleanEmail = String(email).trim().toLowerCase();
        const passwordHash = hashPassword(String(password));

        const [rows] = await pool.query(
            `
            SELECT
                id,
                username,
                email,
                password_hash,
                premium_expires_at
            FROM users
            WHERE email = ?
            LIMIT 1
            `,
            [cleanEmail]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const user = rows[0];

        if (user.password_hash !== passwordHash) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        return res.json({
            success: true,
            message: "Login successful.",
            userId: user.id,
            username: user.username,
            email: user.email,
            premiumExpiresAt: user.premium_expires_at
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not login.",
            error: error.message
        });
    }
});

// ============================================================
// GET USER
// ============================================================

app.get("/api/auth/user/:id", async (req, res) => {
    try {
        const userId = Number(req.params.id);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID."
            });
        }

        const [rows] = await pool.query(
            `
            SELECT
                id,
                username,
                email,
                premium_expires_at,
                created_at
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        res.json({
            success: true,
            user: rows[0]
        });

    } catch (error) {
        console.error("Get user error:", error);

        res.status(500).json({
            success: false,
            message: "Could not get user.",
            error: error.message
        });
    }
});

// ============================================================
// PREMIUM PLANS
// ============================================================

app.get("/api/premium/plans", (req, res) => {
    res.json({
        success: true,
        plans: Object.values(PREMIUM_PLANS)
    });
});

// ============================================================
// PREMIUM STATUS
// ============================================================

app.get("/api/premium/status/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID."
            });
        }

        const [rows] = await pool.query(
            `
            SELECT
                id,
                premium_expires_at
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const expiry = rows[0].premium_expires_at;

        const active =
            expiry &&
            new Date(expiry).getTime() > Date.now();

        res.json({
            success: true,
            active: Boolean(active),
            expiresAt: expiry
        });

    } catch (error) {
        console.error("Premium status error:", error);

        res.status(500).json({
            success: false,
            message: "Could not get premium status.",
            error: error.message
        });
    }
});

// ============================================================
// CREATE ORDER
// ============================================================

app.post("/api/payment/create-order", async (req, res) => {
    try {
        const {
            userId,
            planId
        } = req.body;

        const numericUserId = Number(userId);

        if (!numericUserId || !planId) {
            return res.status(400).json({
                success: false,
                message: "userId and planId are required."
            });
        }

        const plan = PREMIUM_PLANS[planId];

        if (!plan) {
            return res.status(400).json({
                success: false,
                message: "Invalid premium plan."
            });
        }

        const [users] = await pool.query(
            `
            SELECT id
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [numericUserId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const orderId = generateOrderId();

        await pool.query(
            `
            INSERT INTO orders
            (
                order_id,
                user_id,
                plan_id,
                amount,
                status,
                created_at
            )
            VALUES (?, ?, ?, ?, 'PENDING', NOW())
            `,
            [
                orderId,
                numericUserId,
                planId,
                plan.rial
            ]
        );

        /*
         * Mellat payment request will be added here.
         *
         * IMPORTANT:
         * Never put Mellat terminal credentials
         * inside the Android application.
         */

        res.json({
            success: true,
            orderId,
            planId: plan.id,
            amount: plan.rial,
            amountToman: plan.toman,
            message: "Order created successfully."
        });

    } catch (error) {
        console.error("Create order error:", error);

        res.status(500).json({
            success: false,
            message: "Could not create order.",
            error: error.message
        });
    }
});

// ============================================================
// ORDER STATUS
// ============================================================

app.get("/api/payment/order-status/:orderId", async (req, res) => {
    try {
        const orderId = String(req.params.orderId);

        const [rows] = await pool.query(
            `
            SELECT
                order_id,
                user_id,
                plan_id,
                amount,
                status,
                ref_id,
                sale_order_id,
                sale_reference_id,
                response_code,
                created_at,
                paid_at,
                premium_expires_at
            FROM orders
            WHERE order_id = ?
            LIMIT 1
            `,
            [orderId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        res.json({
            success: true,
            order: rows[0]
        });

    } catch (error) {
        console.error("Order status error:", error);

        res.status(500).json({
            success: false,
            message: "Could not get order status.",
            error: error.message
        });
    }
});

// ============================================================
// CANCEL ORDER
// ============================================================

app.post("/api/payment/cancel", async (req, res) => {
    try {
        const {
            orderId
        } = req.body;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: "orderId is required."
            });
        }

        await pool.query(
            `
            UPDATE orders
            SET status = 'CANCELLED'
            WHERE order_id = ?
            AND status = 'PENDING'
            `,
            [String(orderId)]
        );

        res.json({
            success: true,
            message: "Order cancelled."
        });

    } catch (error) {
        console.error("Cancel order error:", error);

        res.status(500).json({
            success: false,
            message: "Could not cancel order.",
            error: error.message
        });
    }
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint not found"
    });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((error, req, res, next) => {
    console.error("Global server error:", error);

    res.status(500).json({
        success: false,
        message: "Internal server error.",
        error: error.message
    });
});

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
    try {
        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(`SPlay backend running on port ${PORT}`);
        });

    } catch (error) {
        console.error("================================");
        console.error("DATABASE INITIALIZATION FAILED");
        console.error(error);
        console.error("================================");

        process.exit(1);
    }
}

startServer();
