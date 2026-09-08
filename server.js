require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// MySQL
// ==========================================

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    ssl: {
        rejectUnauthorized: false
    },

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

// ==========================================
// Premium Plans
// مبلغ‌ها به تومان هستند
// ==========================================

const PREMIUM_PLANS = {
    monthly: {
        name: "1 Month",
        days: 30,
        priceToman: 199000
    },

    three_month: {
        name: "3 Months",
        days: 90,
        priceToman: 499000
    },

    six_month: {
        name: "6 Months",
        days: 180,
        priceToman: 799000
    },

    yearly: {
        name: "1 Year",
        days: 365,
        priceToman: 1299000
    }
};

// ==========================================
// Password Hash
// ==========================================

function hashPassword(password) {

    return crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
}

// ==========================================
// Database Initialization
// ==========================================

async function initializeDatabase() {

    const connection = await db.getConnection();

    try {

        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

                username VARCHAR(100) NULL,

                email VARCHAR(255) NOT NULL,

                password_hash VARCHAR(255) NOT NULL,

                premium_expires_at DATETIME NULL,

                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,

                PRIMARY KEY (id),

                UNIQUE KEY unique_email (email)
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

// ==========================================
// Home
// ==========================================

app.get("/", (req, res) => {

    res.json({

        success: true,

        app: "SPlay Backend",

        version: "1.1.0",

        message: "SPlay backend is running"
    });
});

// ==========================================
// Health Check
// ==========================================

app.get("/health", async (req, res) => {

    try {

        await db.query("SELECT 1");

        res.json({

            success: true,

            status: "OK",

            database: "CONNECTED"
        });

    } catch (error) {

        console.error(
            "Health check error:",
            error
        );

        res.status(500).json({

            success: false,

            status: "ERROR",

            database: "DISCONNECTED"
        });
    }
});

// ==========================================
// Database Test
// ==========================================

app.get("/api/database-test", async (req, res) => {

    try {

        const [rows] = await db.query(
            "SELECT NOW() AS server_time"
        );

        res.json({

            success: true,

            message: "MySQL connection successful",

            serverTime: rows[0].server_time
        });

    } catch (error) {

        console.error(
            "Database test error:",
            error
        );

        res.status(500).json({

            success: false,

            message: "MySQL connection failed"
        });
    }
});

// ==========================================
// REGISTER
// ==========================================
//
// POST:
//
// {
//     "email": "test@example.com",
//     "password": "123456"
// }
//
// Optional:
//
// {
//     "email": "test@example.com",
//     "password": "123456",
//     "username": "SaYMoN"
// }
//
// ==========================================

app.post("/api/auth/register", async (req, res) => {

    const connection = await db.getConnection();

    try {

        let email =
            String(req.body.email || "")
                .trim()
                .toLowerCase();

        const password =
            String(req.body.password || "");

        let username =
            String(req.body.username || "")
                .trim();

        // ------------------------------
        // Validation
        // ------------------------------

        if (!email) {

            return res.status(400).json({

                success: false,

                message: "Email is required"
            });
        }

        if (password.length < 6) {

            return res.status(400).json({

                success: false,

                message:
                    "Password must be at least 6 characters"
            });
        }

        if (username.length === 0) {

            username = email.split("@")[0];
        }

        if (username.length > 100) {

            return res.status(400).json({

                success: false,

                message: "Username is too long"
            });
        }

        // ------------------------------
        // Check existing user
        // ------------------------------

        const [existingUsers] =
            await connection.query(
                `
                SELECT id
                FROM users
                WHERE email = ?
                LIMIT 1
                `,
                [email]
            );

        if (existingUsers.length > 0) {

            return res.status(409).json({

                success: false,

                message:
                    "An account with this email already exists"
            });
        }

        // ------------------------------
        // Hash password
        // ------------------------------

        const passwordHash =
            hashPassword(password);

        // ------------------------------
        // Create user
        // ------------------------------

        const [result] =
            await connection.query(
                `
                INSERT INTO users
                (
                    username,
                    email,
                    password_hash
                )
                VALUES (?, ?, ?)
                `,
                [
                    username,
                    email,
                    passwordHash
                ]
            );

        const userId =
            Number(result.insertId);

        // ------------------------------
        // Response
        // ------------------------------

        res.status(201).json({

            success: true,

            message:
                "Account created successfully",

            user: {

                id: userId,

                username: username,

                email: email,

                premiumExpiresAt: null
            }
        });

    } catch (error) {

        console.error(
            "Register error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Could not create account"
        });

    } finally {

        connection.release();
    }
});

// ==========================================
// LOGIN
// ==========================================
//
// POST:
//
// {
//     "email": "test@example.com",
//     "password": "123456"
// }
//
// ==========================================

app.post("/api/auth/login", async (req, res) => {

    try {

        const email =
            String(req.body.email || "")
                .trim()
                .toLowerCase();

        const password =
            String(req.body.password || "");

        // ------------------------------
        // Validation
        // ------------------------------

        if (!email || !password) {

            return res.status(400).json({

                success: false,

                message:
                    "Email and password are required"
            });
        }

        // ------------------------------
        // Find user
        // ------------------------------

        const [users] =
            await db.query(
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
                [email]
            );

        if (users.length === 0) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid email or password"
            });
        }

        const user =
            users[0];

        // ------------------------------
        // Check password
        // ------------------------------

        const passwordHash =
            hashPassword(password);

        if (
            passwordHash !==
            user.password_hash
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid email or password"
            });
        }

        // ------------------------------
        // Check Premium
        // ------------------------------

        let premiumActive = false;

        if (user.premium_expires_at) {

            const expiry =
                new Date(
                    user.premium_expires_at
                ).getTime();

            premiumActive =
                expiry >
                Date.now();
        }

        // ------------------------------
        // Response
        // ------------------------------

        res.json({

            success: true,

            message:
                "Login successful",

            user: {

                id:
                    Number(user.id),

                username:
                    user.username,

                email:
                    user.email,

                premiumActive:
                    premiumActive,

                premiumExpiresAt:
                    user.premium_expires_at
            }
        });

    } catch (error) {

        console.error(
            "Login error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Could not login"
        });
    }
});

// ==========================================
// Get User
// ==========================================

app.get("/api/auth/user/:userId", async (req, res) => {

    try {

        const userId =
            Number(req.params.userId);

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

        const [users] =
            await db.query(
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

        if (users.length === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "User not found"
            });
        }

        const user =
            users[0];

        let premiumActive = false;

        if (user.premium_expires_at) {

            premiumActive =
                new Date(
                    user.premium_expires_at
                ).getTime() >
                Date.now();
        }

        res.json({

            success: true,

            user: {

                id:
                    Number(user.id),

                username:
                    user.username,

                email:
                    user.email,

                premiumActive:
                    premiumActive,

                premiumExpiresAt:
                    user.premium_expires_at,

                createdAt:
                    user.created_at
            }
        });

    } catch (error) {

        console.error(
            "Get user error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Could not get user"
        });
    }
});

// ==========================================
// Get Premium Plans
// ==========================================

app.get("/api/premium/plans", (req, res) => {

    const plans =
        Object.entries(
            PREMIUM_PLANS
        ).map(
            ([id, plan]) => ({

                id: id,

                name:
                    plan.name,

                days:
                    plan.days,

                priceToman:
                    plan.priceToman
            })
        );

    res.json({

        success: true,

        plans: plans
    });
});

// ==========================================
// Create Premium Order
// ==========================================
//
// Android sends:
//
// {
//     "userId": 1,
//     "plan": "monthly"
// }
//
// مبلغ از Android دریافت نمی‌شود.
// سرور خودش مبلغ صحیح پلن را تعیین می‌کند.
// ==========================================

app.post(
    "/api/premium/create-order",
    async (req, res) => {

        const connection =
            await db.getConnection();

        try {

            const userId =
                Number(req.body.userId);

            const planId =
                String(
                    req.body.plan || ""
                ).trim();

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid userId"
                });
            }

            const selectedPlan =
                PREMIUM_PLANS[planId];

            if (!selectedPlan) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid premium plan"
                });
            }

            // ------------------------------
            // Check user
            // ------------------------------

            const [users] =
                await connection.query(
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

            if (users.length === 0) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"
                });
            }

            // ------------------------------
            // Toman -> Rial
            // ------------------------------

            const amountRial =
                selectedPlan.priceToman *
                10;

            // ------------------------------
            // Create order
            // ------------------------------

            const [result] =
                await connection.query(
                    `
                    INSERT INTO orders
                    (
                        user_id,
                        plan,
                        amount,
                        status
                    )
                    VALUES (?, ?, ?, 'PENDING')
                    `,
                    [
                        userId,
                        planId,
                        amountRial
                    ]
                );

            const orderId =
                Number(result.insertId);

            res.status(201).json({

                success: true,

                order: {

                    id:
                        orderId,

                    userId:
                        userId,

                    plan:
                        planId,

                    planName:
                        selectedPlan.name,

                    days:
                        selectedPlan.days,

                    priceToman:
                        selectedPlan.priceToman,

                    amountRial:
                        amountRial,

                    status:
                        "PENDING"
                },

                message:
                    "Premium order created successfully"
            });

        } catch (error) {

            console.error(
                "Create order error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not create premium order"
            });

        } finally {

            connection.release();
        }
    }
);

// ==========================================
// Get Order Status
// ==========================================

app.get(
    "/api/premium/order/:orderId",
    async (req, res) => {

        try {

            const orderId =
                Number(req.params.orderId);

            if (
                !Number.isInteger(orderId) ||
                orderId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid order ID"
                });
            }

            const [orders] =
                await db.query(
                    `
                    SELECT
                        id,
                        user_id,
                        plan,
                        amount,
                        status,
                        created_at,
                        paid_at,
                        premium_expires_at
                    FROM orders
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [orderId]
                );

            if (orders.length === 0) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found"
                });
            }

            const order =
                orders[0];

            res.json({

                success: true,

                order: {

                    id:
                        Number(order.id),

                    userId:
                        Number(order.user_id),

                    plan:
                        order.plan,

                    amountToman:
                        Number(order.amount) / 10,

                    status:
                        order.status,

                    createdAt:
                        order.created_at,

                    paidAt:
                        order.paid_at,

                    premiumExpiresAt:
                        order.premium_expires_at
                }
            });

        } catch (error) {

            console.error(
                "Get order error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not get order status"
            });
        }
    }
);

// ==========================================
// Cancel Pending Order
// ==========================================

app.post(
    "/api/premium/order/:orderId/cancel",
    async (req, res) => {

        try {

            const orderId =
                Number(req.params.orderId);

            if (
                !Number.isInteger(orderId) ||
                orderId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid order ID"
                });
            }

            const [result] =
                await db.query(
                    `
                    UPDATE orders
                    SET status = 'CANCELLED'
                    WHERE id = ?
                      AND status = 'PENDING'
                    `,
                    [orderId]
                );

            if (
                result.affectedRows === 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order cannot be cancelled"
                });
            }

            res.json({

                success: true,

                message:
                    "Order cancelled successfully"
            });

        } catch (error) {

            console.error(
                "Cancel order error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not cancel order"
            });
        }
    }
);

// ==========================================
// 404
// ==========================================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message:
            "Endpoint not found"
    });
});

// ==========================================
// Server Start
// ==========================================

const PORT =
    process.env.PORT || 3000;

async function startServer() {

    try {

        await initializeDatabase();

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `SPlay Backend running on port ${PORT}`
                );
            }
        );

    } catch (error) {

        console.error(
            "Failed to start SPlay Backend."
        );

        console.error(error);

        process.exit(1);
    }
}

startServer();
