const express = require("express");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

/* =========================================================
   DATABASE
========================================================= */

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "defaultdb",

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,

    ssl: {
        rejectUnauthorized: false
    }
});

/* =========================================================
   PREMIUM PLANS
========================================================= */

const PREMIUM_PLANS = {

    monthly: {
        id: "monthly",
        title: "ماهانه",
        days: 30,
        amountToman: 199000,
        amountRial: 1990000
    },

    three_month: {
        id: "three_month",
        title: "سه ماهه",
        days: 90,
        amountToman: 499000,
        amountRial: 4990000
    },

    six_month: {
        id: "six_month",
        title: "شش ماهه",
        days: 180,
        amountToman: 799000,
        amountRial: 7990000
    },

    yearly: {
        id: "yearly",
        title: "یک ساله",
        days: 365,
        amountToman: 1299000,
        amountRial: 12990000
    }

};

/* =========================================================
   HELPERS
========================================================= */

function hashPassword(password) {

    return crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");

}

function generateOrderId() {

    return (
        Date.now().toString() +
        Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, "0")
    );

}

function addDays(date, days) {

    const result = new Date(date);

    result.setDate(
        result.getDate() + days
    );

    return result;

}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function columnExists(
    tableName,
    columnName
) {

    const [rows] =
        await pool.query(
            `
            SELECT COUNT(*) AS count
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = ?
              AND column_name = ?
            `,
            [
                tableName,
                columnName
            ]
        );

    return Number(rows[0].count) > 0;

}

async function ensureColumn(
    tableName,
    columnName,
    definition
) {

    const exists =
        await columnExists(
            tableName,
            columnName
        );

    if (!exists) {

        console.log(
            `Creating missing column ${tableName}.${columnName}...`
        );

        await pool.query(
            `
            ALTER TABLE \`${tableName}\`
            ADD COLUMN \`${columnName}\` ${definition}
            `
        );

        console.log(
            `Column ${tableName}.${columnName} created.`
        );

    }

}

/* =========================================================
   USERS TABLE
========================================================= */

async function ensureUsersTable() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT NOT NULL AUTO_INCREMENT,
            username VARCHAR(100) NULL,
            email VARCHAR(255) NULL,
            password_hash VARCHAR(255) NULL,
            premium_expires_at DATETIME NULL,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            PRIMARY KEY (id)
        )
    `);

    await ensureColumn(
        "users",
        "username",
        "VARCHAR(100) NULL"
    );

    await ensureColumn(
        "users",
        "email",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "users",
        "password_hash",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "users",
        "premium_expires_at",
        "DATETIME NULL"
    );

    await ensureColumn(
        "users",
        "created_at",
        "DATETIME NULL"
    );

    await ensureColumn(
        "users",
        "updated_at",
        "DATETIME NULL"
    );

}

/* =========================================================
   ORDERS TABLE
========================================================= */

async function ensureOrdersTable() {

    console.log(
        "Checking orders table..."
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT NOT NULL AUTO_INCREMENT,
            order_id VARCHAR(100) NULL,
            user_id INT NULL,
            plan_id VARCHAR(50) NULL,
            amount INT NULL,
            status VARCHAR(30) NULL DEFAULT 'CREATED',
            ref_id VARCHAR(255) NULL,
            sale_order_id VARCHAR(255) NULL,
            sale_reference_id VARCHAR(255) NULL,
            response_code VARCHAR(50) NULL,
            paid_at DATETIME NULL,
            premium_expires_at DATETIME NULL,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            PRIMARY KEY (id)
        )
    `);

    /* -----------------------------------------------------
       Make sure all required columns exist
    ----------------------------------------------------- */

    await ensureColumn(
        "orders",
        "order_id",
        "VARCHAR(100) NULL"
    );

    await ensureColumn(
        "orders",
        "user_id",
        "INT NULL"
    );

    await ensureColumn(
        "orders",
        "plan_id",
        "VARCHAR(50) NULL"
    );

    await ensureColumn(
        "orders",
        "amount",
        "INT NULL"
    );

    await ensureColumn(
        "orders",
        "status",
        "VARCHAR(30) NULL DEFAULT 'CREATED'"
    );

    await ensureColumn(
        "orders",
        "ref_id",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "orders",
        "sale_order_id",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "orders",
        "sale_reference_id",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "orders",
        "response_code",
        "VARCHAR(50) NULL"
    );

    await ensureColumn(
        "orders",
        "paid_at",
        "DATETIME NULL"
    );

    await ensureColumn(
        "orders",
        "premium_expires_at",
        "DATETIME NULL"
    );

    await ensureColumn(
        "orders",
        "created_at",
        "DATETIME NULL"
    );

    await ensureColumn(
        "orders",
        "updated_at",
        "DATETIME NULL"
    );

    /* =====================================================
       IMPORTANT FIX

       The old status column may already exist as ENUM
       or another incompatible type.

       Therefore ensureColumn() is not enough.

       We explicitly convert status to VARCHAR(30).
    ===================================================== */

    console.log(
        "Fixing orders.status column type..."
    );

    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN status VARCHAR(30)
        NULL
        DEFAULT 'CREATED'
    `);

    console.log(
        "orders.status is ready as VARCHAR(30)."
    );

}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initializeDatabase() {

    console.log(
        "================================="
    );

    console.log(
        "SPlay database initialization..."
    );

    console.log(
        "================================="
    );

    await ensureUsersTable();

    await ensureOrdersTable();

    console.log(
        "Database initialization completed."
    );

}

/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/health",
    async (req, res) => {

        try {

            await pool.query(
                "SELECT 1"
            );

            res.json({

                success: true,

                status: "OK",

                database: "CONNECTED"

            });

        } catch (error) {

            console.error(
                "HEALTH ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                status: "ERROR",

                database: "DISCONNECTED"

            });

        }

    }
);

/* =========================================================
   DATABASE TEST
========================================================= */

app.get(
    "/api/database-test",
    async (req, res) => {

        try {

            const [rows] =
                await pool.query(
                    "SELECT NOW() AS serverTime"
                );

            res.json({

                success: true,

                message:
                    "MySQL connection successful",

                serverTime:
                    rows[0].serverTime

            });

        } catch (error) {

            console.error(
                "DATABASE TEST ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "MySQL connection failed",

                error:
                    error.message

            });

        }

    }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
    "/api/auth/register",
    async (req, res) => {

        let connection = null;

        try {

            console.log(
                "================================="
            );

            console.log(
                "REGISTER REQUEST RECEIVED"
            );

            console.log(
                "================================="
            );

            await ensureUsersTable();

            const username =
                String(
                    req.body.username || ""
                ).trim();

            const email =
                String(
                    req.body.email || ""
                )
                .trim()
                .toLowerCase();

            const password =
                String(
                    req.body.password || ""
                );

            console.log(
                "Register username:",
                username
            );

            console.log(
                "Register email:",
                email
            );

            if (!username) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username is required"

                });

            }

            if (!email) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Email is required"

                });

            }

            if (!password) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Password is required"

                });

            }

            if (username.length < 3) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username must be at least 3 characters"

                });

            }

            if (password.length < 6) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Password must be at least 6 characters"

                });

            }

            connection =
                await pool.getConnection();

            await connection.beginTransaction();

            const [usernameRows] =
                await connection.query(
                    `
                    SELECT id
                    FROM users
                    WHERE username = ?
                    LIMIT 1
                    `,
                    [
                        username
                    ]
                );

            if (
                usernameRows.length > 0
            ) {

                await connection.rollback();

                return res.status(409).json({

                    success: false,

                    message:
                        "Username already exists"

                });

            }

            const [emailRows] =
                await connection.query(
                    `
                    SELECT id
                    FROM users
                    WHERE email = ?
                    LIMIT 1
                    `,
                    [
                        email
                    ]
                );

            if (
                emailRows.length > 0
            ) {

                await connection.rollback();

                return res.status(409).json({

                    success: false,

                    message:
                        "Email already exists"

                });

            }

            const passwordHash =
                hashPassword(
                    password
                );

            const now =
                new Date();

            const [result] =
                await connection.query(
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
                    VALUES
                    (?, ?, ?, NULL, ?, ?)
                    `,
                    [
                        username,
                        email,
                        passwordHash,
                        now,
                        now
                    ]
                );

            await connection.commit();

            console.log(
                "================================="
            );

            console.log(
                "REGISTER SUCCESS"
            );

            console.log(
                "User ID:",
                result.insertId
            );

            console.log(
                "================================="
            );

            return res.status(201).json({

                success: true,

                message:
                    "Account created successfully",

                userId:
                    result.insertId

            });

        } catch (error) {

            if (connection) {

                try {
                    await connection.rollback();
                } catch (_) {}

            }

            console.error(
                "================================="
            );

            console.error(
                "REGISTER ERROR"
            );

            console.error(
                "Message:",
                error.message
            );

            console.error(
                "Code:",
                error.code
            );

            console.error(
                "Errno:",
                error.errno
            );

            console.error(
                "SQL State:",
                error.sqlState
            );

            console.error(
                "================================="
            );

            return res.status(500).json({

                success: false,

                message:
                    "Could not create account",

                error:
                    error.message || "",

                code:
                    error.code || "",

                errno:
                    error.errno || "",

                sqlState:
                    error.sqlState || ""

            });

        } finally {

            if (connection) {
                connection.release();
            }

        }

    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            await ensureUsersTable();

            const email =
                String(
                    req.body.email || ""
                )
                .trim()
                .toLowerCase();

            const password =
                String(
                    req.body.password || ""
                );

            if (
                !email ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Email and password are required"

                });

            }

            const passwordHash =
                hashPassword(
                    password
                );

            const [rows] =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        email,
                        premium_expires_at,
                        created_at
                    FROM users
                    WHERE email = ?
                      AND password_hash = ?
                    LIMIT 1
                    `,
                    [
                        email,
                        passwordHash
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid email or password"

                });

            }

            const user =
                rows[0];

            res.json({

                success: true,

                message:
                    "Login successful",

                userId:
                    user.id,

                username:
                    user.username,

                email:
                    user.email,

                premiumExpiresAt:
                    user.premium_expires_at

            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not login",

                error:
                    error.message

            });

        }

    }
);

/* =========================================================
   GET USER
========================================================= */

app.get(
    "/api/auth/user/:id",
    async (req, res) => {

        try {

            await ensureUsersTable();

            const userId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid user ID"

                });

            }

            const [rows] =
                await pool.query(
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
                    [
                        userId
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"

                });

            }

            res.json({

                success: true,

                user:
                    rows[0]

            });

        } catch (error) {

            console.error(
                "GET USER ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not get user",

                error:
                    error.message

            });

        }

    }
);

/* =========================================================
   PREMIUM PLANS
========================================================= */

app.get(
    "/api/premium/plans",
    (req, res) => {

        res.json({

            success: true,

            plans:
                Object.values(
                    PREMIUM_PLANS
                )

        });

    }
);

/* =========================================================
   PREMIUM STATUS
========================================================= */

app.get(
    "/api/premium/status/:userId",
    async (req, res) => {

        try {

            await ensureUsersTable();

            const userId =
                Number(
                    req.params.userId
                );

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid user ID"

                });

            }

            const [rows] =
                await pool.query(
                    `
                    SELECT
                        id,
                        premium_expires_at
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"

                });

            }

            const expiry =
                rows[0].premium_expires_at;

            let active = false;

            if (expiry) {

                active =
                    new Date(
                        expiry
                    ).getTime()
                    >
                    Date.now();

            }

            res.json({

                success: true,

                active:
                    active,

                expiresAt:
                    expiry

            });

        } catch (error) {

            console.error(
                "PREMIUM STATUS ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not get premium status",

                error:
                    error.message

            });

        }

    }
);

/* =========================================================
   CREATE PAYMENT ORDER
========================================================= */

app.post(
    "/api/payment/create-order",
    async (req, res) => {

        try {

            console.log(
                "================================="
            );

            console.log(
                "CREATE ORDER REQUEST"
            );

            console.log(
                "================================="
            );

            await ensureUsersTable();

            await ensureOrdersTable();

            const userId =
                Number(
                    req.body.userId
                );

            const planId =
                String(
                    req.body.planId || ""
                ).trim();

            console.log(
                "User ID:",
                userId
            );

            console.log(
                "Plan ID:",
                planId
            );

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid user ID"

                });

            }

            const plan =
                PREMIUM_PLANS[
                    planId
                ];

            if (!plan) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid premium plan"

                });

            }

            const [users] =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                );

            if (
                users.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"

                });

            }

            const orderId =
                generateOrderId();

            const now =
                new Date();

            console.log(
                "Generated Order ID:",
                orderId
            );

            console.log(
                "Amount Rial:",
                plan.amountRial
            );

            /*
             * Explicitly use CREATED.
             * status column has already been
             * converted to VARCHAR(30).
             */

            await pool.query(
                `
                INSERT INTO orders
                (
                    order_id,
                    user_id,
                    plan_id,
                    amount,
                    status,
                    created_at,
                    updated_at
                )
                VALUES
                (?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    orderId,
                    userId,
                    planId,
                    plan.amountRial,
                    "CREATED",
                    now,
                    now
                ]
            );

            console.log(
                "ORDER CREATED SUCCESSFULLY"
            );

            console.log(
                "Order ID:",
                orderId
            );

            console.log(
                "================================="
            );

            return res.json({

                success: true,

                message:
                    "Order created",

                orderId:
                    orderId,

                planId:
                    plan.id,

                amountToman:
                    plan.amountToman,

                amountRial:
                    plan.amountRial,

                status:
                    "CREATED"

            });

        } catch (error) {

            console.error(
                "================================="
            );

            console.error(
                "CREATE ORDER ERROR"
            );

            console.error(
                "Message:",
                error.message
            );

            console.error(
                "Code:",
                error.code
            );

            console.error(
                "Errno:",
                error.errno
            );

            console.error(
                "SQL State:",
                error.sqlState
            );

            console.error(
                "================================="
            );

            return res.status(500).json({

                success: false,

                message:
                    "Could not create order",

                error:
                    error.message || "",

                code:
                    error.code || "",

                errno:
                    error.errno || "",

                sqlState:
                    error.sqlState || ""

            });

        }

    }
);

/* =========================================================
   ORDER STATUS
========================================================= */

app.get(
    "/api/payment/order-status/:orderId",
    async (req, res) => {

        try {

            await ensureOrdersTable();

            const orderId =
                String(
                    req.params.orderId || ""
                ).trim();

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required"

                });

            }

            const [rows] =
                await pool.query(
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
                        paid_at,
                        premium_expires_at,
                        created_at
                    FROM orders
                    WHERE order_id = ?
                    LIMIT 1
                    `,
                    [
                        orderId
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found"

                });

            }

            res.json({

                success: true,

                order:
                    rows[0]

            });

        } catch (error) {

            console.error(
                "ORDER STATUS ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not get order status",

                error:
                    error.message

            });

        }

    }
);

/* =========================================================
   CANCEL PAYMENT
========================================================= */

app.post(
    "/api/payment/cancel",
    async (req, res) => {

        try {

            await ensureOrdersTable();

            const orderId =
                String(
                    req.body.orderId || ""
                ).trim();

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required"

                });

            }

            await pool.query(
                `
                UPDATE orders
                SET
                    status = 'CANCELLED',
                    updated_at = ?
                WHERE order_id = ?
                  AND status = 'CREATED'
                `,
                [
                    new Date(),
                    orderId
                ]
            );

            res.json({

                success: true,

                message:
                    "Payment cancelled"

            });

        } catch (error) {

            console.error(
                "CANCEL PAYMENT ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not cancel payment",

                error:
                    error.message

            });

        }

    }
);

/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "Endpoint not found"

        });

    }
);

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Internal server error"

        });

    }
);

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {

    try {

        await initializeDatabase();

        app.listen(
            PORT,
            () => {

                console.log(
                    `SPlay backend running on port ${PORT}`
                );

            }
        );

    } catch (error) {

        console.error(
            "SERVER START ERROR:",
            error
        );

        process.exit(1);

    }

}

startServer();
