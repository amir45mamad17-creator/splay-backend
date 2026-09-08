const express = require("express");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

/* =========================
   DATABASE
========================= */

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "defaultdb",

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    ssl: {
        rejectUnauthorized: false
    }
});

/* =========================
   PREMIUM PLANS
========================= */

const PREMIUM_PLANS = {
    monthly: {
        name: "ماهانه",
        days: 30,
        toman: 199000,
        rial: 1990000
    },

    three_month: {
        name: "سه‌ماهه",
        days: 90,
        toman: 499000,
        rial: 4990000
    },

    six_month: {
        name: "شش‌ماهه",
        days: 180,
        toman: 799000,
        rial: 7990000
    },

    yearly: {
        name: "یک‌ساله",
        days: 365,
        toman: 1299000,
        rial: 12990000
    }
};

/* =========================
   HELPERS
========================= */

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
}

function generateOrderId() {
    return (
        "SPL" +
        Date.now().toString() +
        Math.floor(1000 + Math.random() * 9000)
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

async function ensureColumn(tableName, columnName, definition) {
    const exists = await columnExists(tableName, columnName);

    if (!exists) {
        await pool.query(
            `ALTER TABLE \`${tableName}\`
             ADD COLUMN \`${columnName}\` ${definition}`
        );
    }
}

/* =========================
   REMOVE FOREIGN KEY
========================= */

async function removeOrdersUserForeignKey() {
    try {
        const [rows] = await pool.query(
            `
            SELECT CONSTRAINT_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND COLUMN_NAME = 'user_id'
              AND REFERENCED_TABLE_NAME = 'users'
            `
        );

        for (const row of rows) {
            try {
                await pool.query(
                    `ALTER TABLE orders DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``
                );

                console.log(
                    `Removed foreign key: ${row.CONSTRAINT_NAME}`
                );
            } catch (error) {
                console.log(
                    `Could not remove foreign key ${row.CONSTRAINT_NAME}:`,
                    error.message
                );
            }
        }
    } catch (error) {
        console.log(
            "Foreign key inspection warning:",
            error.message
        );
    }
}

/* =========================
   USERS TABLE
========================= */

async function ensureUsersTable() {
    console.log("Checking users table...");

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT NOT NULL AUTO_INCREMENT,
            username VARCHAR(100) NULL,
            email VARCHAR(255) NULL,
            password_hash VARCHAR(255) NULL,
            premium_expires_at DATETIME NULL,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
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
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP"
    );

    await ensureColumn(
        "users",
        "updated_at",
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    /*
     * مهم:
     * id جدول users باید با orders.user_id
     * از نظر نوع کاملاً سازگار باشد.
     */
    await pool.query(`
        ALTER TABLE users
        MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT
    `);

    console.log("Users table is ready.");
}

/* =========================
   ORDERS TABLE
========================= */

async function ensureOrdersTable() {
    console.log("Checking orders table...");

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT NOT NULL AUTO_INCREMENT,

            order_id VARCHAR(100) NOT NULL,

            user_id INT NULL,

            plan_id VARCHAR(50) NULL,

            amount BIGINT NULL,

            status VARCHAR(30) NULL DEFAULT 'CREATED',

            ref_id VARCHAR(255) NULL,

            sale_order_id VARCHAR(255) NULL,

            sale_reference_id VARCHAR(255) NULL,

            response_code VARCHAR(50) NULL,

            paid_at DATETIME NULL,

            premium_expires_at DATETIME NULL,

            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,

            updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,

            PRIMARY KEY (id),

            UNIQUE KEY unique_order_id (order_id)
        )
    `);

    /*
     * خیلی مهم:
     * قبل از تغییر user_id،
     * تمام Foreign Keyهای متصل به users حذف می‌شوند.
     */
    await removeOrdersUserForeignKey();

    /*
     * حالا نوع user_id را دقیقاً INT می‌کنیم
     * تا با users.id سازگار باشد.
     */
    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN user_id INT NULL
    `);

    await ensureColumn(
        "orders",
        "order_id",
        "VARCHAR(100) NULL"
    );

    await ensureColumn(
        "orders",
        "plan_id",
        "VARCHAR(50) NULL"
    );

    await ensureColumn(
        "orders",
        "amount",
        "BIGINT NULL"
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
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP"
    );

    await ensureColumn(
        "orders",
        "updated_at",
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    /*
     * دوباره اطمینان حاصل می‌کنیم که user_id دقیقاً INT است.
     */
    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN user_id INT NULL
    `);

    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN order_id VARCHAR(100) NOT NULL
    `);

    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN status VARCHAR(30) NULL DEFAULT 'CREATED'
    `);

    /*
     * بررسی می‌کنیم Foreign Key از قبل وجود نداشته باشد.
     */
    const [existingForeignKeys] = await pool.query(
        `
        SELECT CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'orders'
          AND COLUMN_NAME = 'user_id'
          AND REFERENCED_TABLE_NAME = 'users'
        `
    );

    /*
     * اگر وجود نداشت، دوباره ایجادش می‌کنیم.
     */
    if (existingForeignKeys.length === 0) {
        try {
            await pool.query(`
                ALTER TABLE orders
                ADD CONSTRAINT fk_orders_user
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE SET NULL
                ON UPDATE CASCADE
            `);

            console.log("Foreign key fk_orders_user created.");
        } catch (error) {
            console.log(
                "Foreign key creation warning:",
                error.message
            );
        }
    } else {
        console.log(
            "Foreign key fk_orders_user already exists."
        );
    }

    console.log("Orders table is ready.");
}

/* =========================
   DATABASE INITIALIZATION
========================= */

async function initializeDatabase() {
    console.log("SPlay database initialization...");

    await ensureUsersTable();
    await ensureOrdersTable();

    console.log("Database initialization completed.");
}

/* =========================
   HEALTH
========================= */

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            success: true,
            status: "OK",
            database: "CONNECTED"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: "ERROR",
            database: "DISCONNECTED",
            error: error.message
        });
    }
});

/* =========================
   DATABASE TEST
========================= */

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
        res.status(500).json({
            success: false,
            message: "MySQL connection failed",
            error: error.message
        });
    }
});

/* =========================
   REGISTER
========================= */

app.post("/api/auth/register", async (req, res) => {
    try {
        const {
            username,
            email,
            password
        } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "لطفاً تمام فیلدها را وارد کنید."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "رمز عبور باید حداقل ۶ کاراکتر باشد."
            });
        }

        const [existing] = await pool.query(
            `
            SELECT id
            FROM users
            WHERE email = ?
            LIMIT 1
            `,
            [email]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "این ایمیل قبلاً ثبت شده است."
            });
        }

        const passwordHash =
            hashPassword(password);

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
                username,
                email,
                passwordHash
            ]
        );

        res.json({
            success: true,
            message: "ثبت‌نام با موفقیت انجام شد.",
            userId: result.insertId,
            username,
            email
        });
    } catch (error) {
        console.error(
            "REGISTER ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "خطا در ثبت‌نام.",
            error: error.message
        });
    }
});

/* =========================
   LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "ایمیل و رمز عبور را وارد کنید."
            });
        }

        const passwordHash =
            hashPassword(password);

        const [rows] = await pool.query(
            `
            SELECT
                id,
                username,
                email,
                premium_expires_at
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

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "ایمیل یا رمز عبور اشتباه است."
            });
        }

        const user = rows[0];

        res.json({
            success: true,
            message: "Login successful",
            userId: user.id,
            username: user.username,
            email: user.email,
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
            message: "خطا در ورود.",
            error: error.message
        });
    }
});

/* =========================
   USER
========================= */

app.get("/api/auth/user/:id", async (req, res) => {
    try {
        const userId =
            Number(req.params.id);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "شناسه کاربر نامعتبر است."
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
                message: "کاربر پیدا نشد."
            });
        }

        res.json({
            success: true,
            user: rows[0]
        });
    } catch (error) {
        console.error(
            "USER ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "خطا در دریافت اطلاعات کاربر.",
            error: error.message
        });
    }
});

/* =========================
   PREMIUM PLANS
========================= */

app.get("/api/premium/plans", (req, res) => {
    res.json({
        success: true,
        plans: PREMIUM_PLANS
    });
});

/* =========================
   PREMIUM STATUS
========================= */

app.get("/api/premium/status/:userId", async (req, res) => {
    try {
        const userId =
            Number(req.params.userId);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "شناسه کاربر نامعتبر است."
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
                message: "کاربر پیدا نشد."
            });
        }

        const expiry =
            rows[0].premium_expires_at;

        const active =
            expiry &&
            new Date(expiry).getTime() > Date.now();

        res.json({
            success: true,
            active: Boolean(active),
            premiumExpiresAt: expiry
        });
    } catch (error) {
        console.error(
            "PREMIUM STATUS ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "خطا در دریافت وضعیت Premium.",
            error: error.message
        });
    }
});

/* =========================
   CREATE PAYMENT ORDER
========================= */

app.post("/api/payment/create-order", async (req, res) => {
    try {
        const {
            userId,
            planId
        } = req.body;

        const numericUserId =
            Number(userId);

        console.log(
            "CREATE ORDER REQUEST:",
            {
                userId: numericUserId,
                planId
            }
        );

        if (!numericUserId || !planId) {
            return res.status(400).json({
                success: false,
                message: "شناسه کاربر یا پلن ارسال نشده است."
            });
        }

        const plan =
            PREMIUM_PLANS[planId];

        if (!plan) {
            return res.status(400).json({
                success: false,
                message: "پلن انتخاب‌شده معتبر نیست."
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
                message: "کاربر پیدا نشد."
            });
        }

        const orderId =
            generateOrderId();

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
            VALUES (?, ?, ?, ?, 'CREATED', NOW(), NOW())
            `,
            [
                orderId,
                numericUserId,
                planId,
                plan.rial
            ]
        );

        console.log(
            "ORDER CREATED:",
            orderId
        );

        /*
         * در این مرحله سفارش ساخته می‌شود.
         * اتصال واقعی Mellat بعد از پایدار شدن
         * ساخت سفارش اضافه خواهد شد.
         */

        res.json({
            success: true,
            message: "سفارش با موفقیت ایجاد شد.",
            orderId,
            planId,
            amount: plan.rial,
            amountToman: plan.toman,
            status: "CREATED"
        });
    } catch (error) {
        console.error(
            "CREATE ORDER ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not create order",
            error: error.message,
            code: error.code || null,
            errno: error.errno || null,
            sqlState: error.sqlState || null,
            sqlMessage: error.sqlMessage || null
        });
    }
});

/* =========================
   ORDER STATUS
========================= */

app.get(
    "/api/payment/order-status/:orderId",
    async (req, res) => {
        try {
            const orderId =
                req.params.orderId;

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
                    paid_at,
                    premium_expires_at,
                    created_at
                FROM orders
                WHERE order_id = ?
                LIMIT 1
                `,
                [orderId]
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "سفارش پیدا نشد."
                });
            }

            res.json({
                success: true,
                order: rows[0]
            });
        } catch (error) {
            console.error(
                "ORDER STATUS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: "خطا در دریافت وضعیت سفارش.",
                error: error.message
            });
        }
    }
);

/* =========================
   CANCEL ORDER
========================= */

app.post(
    "/api/payment/cancel",
    async (req, res) => {
        try {
            const {
                orderId
            } = req.body;

            if (!orderId) {
                return res.status(400).json({
                    success: false,
                    message: "شناسه سفارش ارسال نشده است."
                });
            }

            const [result] = await pool.query(
                `
                UPDATE orders
                SET
                    status = 'CANCELLED',
                    updated_at = NOW()
                WHERE order_id = ?
                  AND status = 'CREATED'
                `,
                [orderId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "سفارش قابل لغو پیدا نشد."
                });
            }

            res.json({
                success: true,
                message: "سفارش لغو شد."
            });
        } catch (error) {
            console.error(
                "CANCEL ORDER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: "خطا در لغو سفارش.",
                error: error.message
            });
        }
    }
);

/* =========================
   ROOT
========================= */

app.get("/", (req, res) => {
    res.send("SPlay Backend is running.");
});

/* =========================
   404
========================= */

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint not found"
    });
});

/* =========================
   GLOBAL ERROR
========================= */

app.use((error, req, res, next) => {
    console.error(
        "GLOBAL ERROR:",
        error
    );

    res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
    });
});

/* =========================
   START SERVER
========================= */

async function startServer() {
    try {
        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(
                `SPlay backend running on port ${PORT}`
            );
        });
    } catch (error) {
        console.error(
            "SERVER START ERROR:",
            error
        );

        process.exit(1);
    }
}

startServer();
