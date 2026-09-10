const express = require("express");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

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

/* =========================================================
   BASIC HELPERS
========================================================= */

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(String(password))
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

function isValidId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0;
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
    return String(username || "").trim();
}

function parseBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return value !== 0;
    }

    const normalized =
        String(value || "")
            .trim()
            .toLowerCase();

    return (
        normalized === "true" ||
        normalized === "1" ||
        normalized === "yes" ||
        normalized === "on"
    );
}

function isPremiumDateActive(expiry) {
    if (!expiry) {
        return false;
    }

    const expiryTime =
        new Date(expiry).getTime();

    return (
        !Number.isNaN(expiryTime) &&
        expiryTime > Date.now()
    );
}

/* =========================================================
   ADMIN TOKEN
========================================================= */

function getAdminTokenSecret() {
    return process.env.ADMIN_TOKEN_SECRET || "";
}

function createAdminToken() {
    const secret = getAdminTokenSecret();

    if (!secret) {
        throw new Error(
            "ADMIN_TOKEN_SECRET is not configured."
        );
    }

    const payload = {
        role: "admin",
        exp: Date.now() + 24 * 60 * 60 * 1000
    };

    const encodedPayload =
        Buffer
            .from(JSON.stringify(payload))
            .toString("base64url");

    const signature =
        crypto
            .createHmac("sha256", secret)
            .update(encodedPayload)
            .digest("base64url");

    return `${encodedPayload}.${signature}`;
}

function verifyAdminToken(token) {
    try {
        const secret =
            getAdminTokenSecret();

        if (!secret || !token) {
            return false;
        }

        const parts =
            String(token).split(".");

        if (parts.length !== 2) {
            return false;
        }

        const encodedPayload =
            parts[0];

        const receivedSignature =
            parts[1];

        const expectedSignature =
            crypto
                .createHmac(
                    "sha256",
                    secret
                )
                .update(encodedPayload)
                .digest("base64url");

        if (
            receivedSignature.length !==
            expectedSignature.length
        ) {
            return false;
        }

        if (
            !crypto.timingSafeEqual(
                Buffer.from(
                    receivedSignature
                ),
                Buffer.from(
                    expectedSignature
                )
            )
        ) {
            return false;
        }

        const payload =
            JSON.parse(
                Buffer
                    .from(
                        encodedPayload,
                        "base64url"
                    )
                    .toString("utf8")
            );

        if (
            payload.role !== "admin"
        ) {
            return false;
        }

        if (
            !payload.exp ||
            Date.now() >
                Number(payload.exp)
        ) {
            return false;
        }

        return true;
    } catch (error) {
        return false;
    }
}

function requireAdmin(req, res, next) {
    const authHeader =
        req.headers.authorization || "";

    if (
        !authHeader.startsWith(
            "Bearer "
        )
    ) {
        return res.status(401).json({
            success: false,
            message:
                "دسترسی مدیر مورد نیاز است."
        });
    }

    const token =
        authHeader
            .substring(7)
            .trim();

    if (!verifyAdminToken(token)) {
        return res.status(401).json({
            success: false,
            message:
                "توکن مدیر نامعتبر یا منقضی شده است."
        });
    }

    next();
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
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            `,
            [
                tableName,
                columnName
            ]
        );

    return (
        Number(rows[0].count) > 0
    );
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
        await pool.query(
            `
            ALTER TABLE \`${tableName}\`
            ADD COLUMN \`${columnName}\`
            ${definition}
            `
        );
    }
}

async function getOrdersUserForeignKeys() {
    const [rows] =
        await pool.query(
            `
            SELECT DISTINCT
                CONSTRAINT_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND COLUMN_NAME = 'user_id'
              AND REFERENCED_TABLE_NAME = 'users'
            `
        );

    return rows;
}

async function removeOrdersUserForeignKey() {
    try {
        const rows =
            await getOrdersUserForeignKeys();

        for (const row of rows) {
            try {
                await pool.query(
                    `
                    ALTER TABLE orders
                    DROP FOREIGN KEY
                    \`${row.CONSTRAINT_NAME}\`
                    `
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

/* =========================================================
   USERS TABLE
========================================================= */

async function ensureUsersTable() {
    console.log(
        "Checking users table..."
    );

    await removeOrdersUserForeignKey();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT NOT NULL AUTO_INCREMENT,
            username VARCHAR(100) NULL,
            email VARCHAR(255) NULL,
            password_hash VARCHAR(255) NULL,
            premium_expires_at DATETIME NULL,
            created_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP
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

    await pool.query(`
        ALTER TABLE users
        MODIFY COLUMN id
        INT NOT NULL AUTO_INCREMENT
    `);

    console.log(
        "Users table is ready."
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
            order_id VARCHAR(100) NOT NULL,
            user_id INT NULL,
            plan_id VARCHAR(50) NULL,
            amount BIGINT NULL,
            status VARCHAR(30) NULL
                DEFAULT 'CREATED',
            ref_id VARCHAR(255) NULL,
            sale_order_id VARCHAR(255) NULL,
            sale_reference_id VARCHAR(255) NULL,
            response_code VARCHAR(50) NULL,
            paid_at DATETIME NULL,
            premium_expires_at DATETIME NULL,
            created_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY unique_order_id (order_id)
        )
    `);

    await removeOrdersUserForeignKey();

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

    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN user_id INT NULL
    `);

    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN order_id
        VARCHAR(100) NOT NULL
    `);

    await pool.query(`
        ALTER TABLE orders
        MODIFY COLUMN status
        VARCHAR(30) NULL DEFAULT 'CREATED'
    `);

    const [existingForeignKeys] =
        await pool.query(`
            SELECT CONSTRAINT_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND COLUMN_NAME = 'user_id'
              AND REFERENCED_TABLE_NAME = 'users'
        `);

    if (
        existingForeignKeys.length === 0
    ) {
        try {
            await pool.query(`
                ALTER TABLE orders
                ADD CONSTRAINT fk_orders_user
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE SET NULL
                ON UPDATE CASCADE
            `);

            console.log(
                "Foreign key fk_orders_user created."
            );
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

    console.log(
        "Orders table is ready."
    );
}

/* =========================================================
   MOVIES TABLE
========================================================= */

async function ensureMoviesTable() {
    console.log(
        "Checking movies table..."
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS movies (
            id INT NOT NULL AUTO_INCREMENT,
            title VARCHAR(255) NOT NULL,
            genre VARCHAR(255) NULL,
            year INT NULL,
            description TEXT NULL,
            premium BOOLEAN NOT NULL DEFAULT FALSE,
            poster_url TEXT NULL,
            video_url TEXT NULL,
            created_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        )
    `);

    await ensureColumn(
        "movies",
        "title",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "movies",
        "genre",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "movies",
        "year",
        "INT NULL"
    );

    await ensureColumn(
        "movies",
        "description",
        "TEXT NULL"
    );

    await ensureColumn(
        "movies",
        "premium",
        "BOOLEAN NOT NULL DEFAULT FALSE"
    );

    await ensureColumn(
        "movies",
        "poster_url",
        "TEXT NULL"
    );

    await ensureColumn(
        "movies",
        "video_url",
        "TEXT NULL"
    );

    await ensureColumn(
        "movies",
        "created_at",
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP"
    );

    await ensureColumn(
        "movies",
        "updated_at",
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    console.log(
        "Movies table is ready."
    );
}

/* =========================================================
   EXPLORE VIDEOS TABLE
========================================================= */

async function ensureExploreVideosTable() {
    console.log(
        "Checking explore_videos table..."
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS explore_videos (
            id INT NOT NULL AUTO_INCREMENT,
            title VARCHAR(255) NULL,
            description TEXT NULL,
            video_url TEXT NULL,
            thumbnail_url TEXT NULL,
            premium BOOLEAN NOT NULL DEFAULT FALSE,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INT NOT NULL DEFAULT 0,
            created_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL
                DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        )
    `);

    await ensureColumn(
        "explore_videos",
        "title",
        "VARCHAR(255) NULL"
    );

    await ensureColumn(
        "explore_videos",
        "description",
        "TEXT NULL"
    );

    await ensureColumn(
        "explore_videos",
        "video_url",
        "TEXT NULL"
    );

    await ensureColumn(
        "explore_videos",
        "thumbnail_url",
        "TEXT NULL"
    );

    await ensureColumn(
        "explore_videos",
        "premium",
        "BOOLEAN NOT NULL DEFAULT FALSE"
    );

    await ensureColumn(
        "explore_videos",
        "active",
        "BOOLEAN NOT NULL DEFAULT TRUE"
    );

    await ensureColumn(
        "explore_videos",
        "sort_order",
        "INT NOT NULL DEFAULT 0"
    );

    await ensureColumn(
        "explore_videos",
        "created_at",
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP"
    );

    await ensureColumn(
        "explore_videos",
        "updated_at",
        "DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );

    console.log(
        "Explore videos table is ready."
    );
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initializeDatabase() {
    console.log(
        "SPlay database initialization..."
    );

    await ensureUsersTable();
    await ensureOrdersTable();
    await ensureMoviesTable();
    await ensureExploreVideosTable();

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
            res.status(500).json({
                success: false,
                status: "ERROR",
                database: "DISCONNECTED",
                error: error.message
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
            res.status(500).json({
                success: false,
                message:
                    "MySQL connection failed",
                error: error.message
            });
        }
    }
);

/* =========================================================
   USER REGISTER
========================================================= */

app.post(
    "/api/auth/register",
    async (req, res) => {
        try {
            const {
                username,
                email,
                password
            } = req.body;

            const cleanUsername =
                normalizeUsername(
                    username
                );

            const cleanEmail =
                normalizeEmail(
                    email
                );

            if (
                !cleanUsername ||
                !cleanEmail ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "لطفاً تمام فیلدها را وارد کنید."
                });
            }

            if (
                String(password).length < 6
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "رمز عبور باید حداقل ۶ کاراکتر باشد."
                });
            }

            const [existing] =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE email = ?
                    LIMIT 1
                    `,
                    [cleanEmail]
                );

            if (
                existing.length > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "این ایمیل قبلاً ثبت شده است."
                });
            }

            const passwordHash =
                hashPassword(
                    password
                );

            const [result] =
                await pool.query(
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

            res.json({
                success: true,
                message:
                    "ثبت‌نام با موفقیت انجام شد.",
                userId:
                    result.insertId,
                username:
                    cleanUsername,
                email:
                    cleanEmail
            });
        } catch (error) {
            console.error(
                "REGISTER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در ثبت‌نام.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   USER LOGIN
========================================================= */

app.post(
    "/api/auth/login",
    async (req, res) => {
        try {
            const {
                email,
                password
            } = req.body;

            const cleanEmail =
                normalizeEmail(
                    email
                );

            if (
                !cleanEmail ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "ایمیل و رمز عبور را وارد کنید."
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
                        premium_expires_at
                    FROM users
                    WHERE email = ?
                      AND password_hash = ?
                    LIMIT 1
                    `,
                    [
                        cleanEmail,
                        passwordHash
                    ]
                );

            if (
                rows.length === 0
            ) {
                return res.status(401).json({
                    success: false,
                    message:
                        "ایمیل یا رمز عبور اشتباه است."
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
                    "خطا در ورود.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   USER PROFILE
========================================================= */

app.get(
    "/api/auth/user/:id",
    async (req, res) => {
        try {
            const userId =
                Number(req.params.id);

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
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
                    [userId]
                );

            if (
                rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            res.json({
                success: true,
                user:
                    rows[0]
            });
        } catch (error) {
            console.error(
                "USER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت اطلاعات کاربر.",
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
                PREMIUM_PLANS
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
            const userId =
                Number(
                    req.params.userId
                );

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
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
                    [userId]
                );

            if (
                rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            const expiry =
                rows[0]
                    .premium_expires_at;

            const active =
                isPremiumDateActive(
                    expiry
                );

            res.json({
                success: true,
                active:
                    Boolean(active),
                premiumExpiresAt:
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
                    "خطا در دریافت وضعیت Premium.",
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
            const {
                userId,
                planId
            } = req.body;

            const numericUserId =
                Number(userId);

            console.log(
                "CREATE ORDER REQUEST:",
                {
                    userId:
                        numericUserId,
                    planId
                }
            );

            if (
                !isValidId(
                    numericUserId
                ) ||
                !planId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر یا پلن ارسال نشده است."
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
                        "پلن انتخاب‌شده معتبر نیست."
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
                        numericUserId
                    ]
                );

            if (
                users.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
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

            res.json({
                success: true,
                message:
                    "سفارش با موفقیت ایجاد شد.",
                orderId,
                planId,
                amount:
                    plan.rial,
                amountToman:
                    plan.toman,
                status:
                    "CREATED"
            });
        } catch (error) {
            console.error(
                "CREATE ORDER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not create order",
                error:
                    error.message,
                code:
                    error.code ||
                    null,
                errno:
                    error.errno ||
                    null,
                sqlState:
                    error.sqlState ||
                    null,
                sqlMessage:
                    error.sqlMessage ||
                    null
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
            const orderId =
                req.params.orderId;

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

            if (
                rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "سفارش پیدا نشد."
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
                    "خطا در دریافت وضعیت سفارش.",
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
            const {
                orderId
            } = req.body;

            if (!orderId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه سفارش ارسال نشده است."
                });
            }

            const [result] =
                await pool.query(
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

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "سفارش قابل لغو پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "سفارش لغو شد."
            });
        } catch (error) {
            console.error(
                "CANCEL ORDER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در لغو سفارش.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
    "/api/admin/login",
    async (req, res) => {
        try {
            const {
                username,
                password
            } = req.body;

            const adminUsername =
                String(
                    process.env.ADMIN_USERNAME ||
                    ""
                ).trim();

            const adminPassword =
                String(
                    process.env.ADMIN_PASSWORD ||
                    ""
                );

            if (
                !adminUsername ||
                !adminPassword
            ) {
                return res.status(500).json({
                    success: false,
                    message:
                        "تنظیمات مدیر روی سرور کامل نیست."
                });
            }

            if (
                String(
                    username || ""
                ).trim() !==
                    adminUsername ||
                String(
                    password || ""
                ) !==
                    adminPassword
            ) {
                return res.status(401).json({
                    success: false,
                    message:
                        "نام کاربری یا رمز عبور مدیر اشتباه است."
                });
            }

            const token =
                createAdminToken();

            res.json({
                success: true,
                message:
                    "ورود مدیر موفق بود.",
                token,
                username:
                    adminUsername,
                expiresIn:
                    86400
            });
        } catch (error) {
            console.error(
                "ADMIN LOGIN ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در ورود مدیر.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
    "/api/admin/stats",
    requireAdmin,
    async (req, res) => {
        try {
            const [[userCount]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM users
                    `
                );

            const [[premiumCount]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM users
                    WHERE premium_expires_at IS NOT NULL
                      AND premium_expires_at > NOW()
                    `
                );

            const [[movieCount]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM movies
                    `
                );

            const [[exploreCount]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM explore_videos
                    WHERE active = TRUE
                    `
                );

            const [[orderCount]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM orders
                    `
                );

            const [[pendingOrders]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'CREATED'
                    `
                );

            const [[paidOrders]] =
                await pool.query(
                    `
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status IN ('PAID', 'APPROVED')
                    `
                );

            res.json({
                success: true,
                stats: {
                    users:
                        Number(
                            userCount.count
                        ),
                    premium:
                        Number(
                            premiumCount.count
                        ),
                    movies:
                        Number(
                            movieCount.count
                        ),
                    exploreVideos:
                        Number(
                            exploreCount.count
                        ),
                    orders:
                        Number(
                            orderCount.count
                        ),
                    pendingOrders:
                        Number(
                            pendingOrders.count
                        ),
                    approvedOrders:
                        Number(
                            paidOrders.count
                        )
                }
            });
        } catch (error) {
            console.error(
                "ADMIN STATS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت آمار.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN USERS LIST
========================================================= */

app.get(
    "/api/admin/users",
    requireAdmin,
    async (req, res) => {
        try {
            const search =
                String(
                    req.query.search ||
                        ""
                ).trim();

            let query = `
                SELECT
                    id,
                    username,
                    email,
                    premium_expires_at,
                    created_at,
                    updated_at
                FROM users
            `;

            const params = [];

            if (search) {
                query += `
                    WHERE username LIKE ?
                       OR email LIKE ?
                `;

                params.push(
                    `%${search}%`,
                    `%${search}%`
                );
            }

            query += `
                ORDER BY id DESC
            `;

            const [rows] =
                await pool.query(
                    query,
                    params
                );

            const users =
                rows.map(
                    user => ({
                        ...user,
                        premiumActive:
                            isPremiumDateActive(
                                user.premium_expires_at
                            )
                    })
                );

            res.json({
                success: true,
                count:
                    users.length,
                users
            });
        } catch (error) {
            console.error(
                "ADMIN USERS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت کاربران.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN USER DETAILS
========================================================= */

app.get(
    "/api/admin/users/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
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
                        created_at,
                        updated_at
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [userId]
                );

            if (
                rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            const user =
                rows[0];

            res.json({
                success: true,
                user: {
                    ...user,
                    premiumActive:
                        isPremiumDateActive(
                            user.premium_expires_at
                        )
                }
            });
        } catch (error) {
            console.error(
                "ADMIN USER DETAILS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت کاربر.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN CREATE USER
========================================================= */

app.post(
    "/api/admin/users",
    requireAdmin,
    async (req, res) => {
        try {
            const {
                username,
                email,
                password
            } = req.body;

            const cleanUsername =
                normalizeUsername(
                    username
                );

            const cleanEmail =
                normalizeEmail(
                    email
                );

            if (
                !cleanUsername ||
                !cleanEmail
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "نام کاربری و ایمیل الزامی است."
                });
            }

            const finalPassword =
                password
                    ? String(password)
                    : "SPlay123456";

            if (
                finalPassword.length < 6
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "رمز عبور باید حداقل ۶ کاراکتر باشد."
                });
            }

            const [existing] =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE email = ?
                       OR username = ?
                    LIMIT 1
                    `,
                    [
                        cleanEmail,
                        cleanUsername
                    ]
                );

            if (
                existing.length > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "نام کاربری یا ایمیل قبلاً استفاده شده است."
                });
            }

            const [result] =
                await pool.query(
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
                        hashPassword(
                            finalPassword
                        )
                    ]
                );

            res.json({
                success: true,
                message:
                    "کاربر با موفقیت ایجاد شد.",
                userId:
                    result.insertId
            });
        } catch (error) {
            console.error(
                "ADMIN CREATE USER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در ایجاد کاربر.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN UPDATE USER
========================================================= */

app.put(
    "/api/admin/users/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
                });
            }

            const {
                username,
                email
            } = req.body;

            const cleanUsername =
                normalizeUsername(
                    username
                );

            const cleanEmail =
                normalizeEmail(
                    email
                );

            if (
                !cleanUsername ||
                !cleanEmail
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "نام کاربری و ایمیل الزامی است."
                });
            }

            const [duplicate] =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE (username = ? OR email = ?)
                      AND id <> ?
                    LIMIT 1
                    `,
                    [
                        cleanUsername,
                        cleanEmail,
                        userId
                    ]
                );

            if (
                duplicate.length > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "نام کاربری یا ایمیل قبلاً استفاده شده است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        username = ?,
                        email = ?,
                        updated_at = NOW()
                    WHERE id = ?
                    `,
                    [
                        cleanUsername,
                        cleanEmail,
                        userId
                    ]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "اطلاعات کاربر بروزرسانی شد."
            });
        } catch (error) {
            console.error(
                "ADMIN UPDATE USER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در بروزرسانی کاربر.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN DELETE USER
========================================================= */

app.delete(
    "/api/admin/users/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    DELETE FROM users
                    WHERE id = ?
                    `,
                    [userId]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "کاربر حذف شد."
            });
        } catch (error) {
            console.error(
                "ADMIN DELETE USER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در حذف کاربر.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN ACTIVATE PREMIUM
========================================================= */

app.post(
    "/api/admin/users/:id/premium",
    requireAdmin,
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                );

            const planId =
                req.body.planId ||
                "monthly";

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
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
                        "پلن Premium نامعتبر است."
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
                    [userId]
                );

            if (
                rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            const currentExpiry =
                rows[0]
                    .premium_expires_at;

            const now =
                new Date();

            let startDate =
                now;

            if (
                currentExpiry &&
                new Date(
                    currentExpiry
                ).getTime() >
                    now.getTime()
            ) {
                startDate =
                    new Date(
                        currentExpiry
                    );
            }

            const newExpiry =
                addDays(
                    startDate,
                    plan.days
                );

            await pool.query(
                `
                UPDATE users
                SET
                    premium_expires_at = ?,
                    updated_at = NOW()
                WHERE id = ?
                `,
                [
                    newExpiry,
                    userId
                ]
            );

            res.json({
                success: true,
                message:
                    "Premium فعال شد.",
                premiumExpiresAt:
                    newExpiry,
                planId
            });
        } catch (error) {
            console.error(
                "ADMIN PREMIUM ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در فعال‌سازی Premium.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN EXTEND PREMIUM
========================================================= */

app.post(
    "/api/admin/users/:id/premium/extend",
    requireAdmin,
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                );

            const planId =
                req.body.planId ||
                "monthly";

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
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
                        "پلن Premium نامعتبر است."
                });
            }

            const [rows] =
                await pool.query(
                    `
                    SELECT
                        premium_expires_at
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                    `,
                    [userId]
                );

            if (
                rows.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            const currentExpiry =
                rows[0]
                    .premium_expires_at;

            const now =
                new Date();

            let startDate =
                now;

            if (
                currentExpiry &&
                new Date(
                    currentExpiry
                ).getTime() >
                    now.getTime()
            ) {
                startDate =
                    new Date(
                        currentExpiry
                    );
            }

            const newExpiry =
                addDays(
                    startDate,
                    plan.days
                );

            await pool.query(
                `
                UPDATE users
                SET
                    premium_expires_at = ?,
                    updated_at = NOW()
                WHERE id = ?
                `,
                [
                    newExpiry,
                    userId
                ]
            );

            res.json({
                success: true,
                message:
                    "Premium تمدید شد.",
                premiumExpiresAt:
                    newExpiry,
                planId
            });
        } catch (error) {
            console.error(
                "ADMIN EXTEND PREMIUM ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در تمدید Premium.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN CANCEL PREMIUM
========================================================= */

app.post(
    "/api/admin/users/:id/premium/cancel",
    requireAdmin,
    async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(userId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه کاربر نامعتبر است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        premium_expires_at = NULL,
                        updated_at = NOW()
                    WHERE id = ?
                    `,
                    [userId]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "Premium لغو شد."
            });
        } catch (error) {
            console.error(
                "ADMIN CANCEL PREMIUM ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در لغو Premium.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN ORDERS / PREMIUM REQUESTS
========================================================= */

app.get(
    "/api/admin/orders",
    requireAdmin,
    async (req, res) => {
        try {
            const status =
                String(
                    req.query.status ||
                        ""
                ).trim();

            let query = `
                SELECT
                    o.id,
                    o.order_id,
                    o.user_id,
                    o.plan_id,
                    o.amount,
                    o.status,
                    o.ref_id,
                    o.sale_order_id,
                    o.sale_reference_id,
                    o.response_code,
                    o.paid_at,
                    o.premium_expires_at,
                    o.created_at,
                    u.username,
                    u.email
                FROM orders o
                LEFT JOIN users u
                    ON u.id = o.user_id
            `;

            const params = [];

            if (status) {
                query += `
                    WHERE o.status = ?
                `;

                params.push(
                    status
                );
            }

            query += `
                ORDER BY o.id DESC
            `;

            const [rows] =
                await pool.query(
                    query,
                    params
                );

            res.json({
                success: true,
                count:
                    rows.length,
                orders:
                    rows
            });
        } catch (error) {
            console.error(
                "ADMIN ORDERS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت درخواست‌ها.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN APPROVE ORDER
========================================================= */

app.post(
    "/api/admin/orders/:orderId/approve",
    requireAdmin,
    async (req, res) => {
        const connection =
            await pool.getConnection();

        try {
            await connection.beginTransaction();

            const orderId =
                String(
                    req.params.orderId
                );

            const [orders] =
                await connection.query(
                    `
                    SELECT
                        id,
                        order_id,
                        user_id,
                        plan_id,
                        status
                    FROM orders
                    WHERE order_id = ?
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [orderId]
                );

            if (
                orders.length === 0
            ) {
                await connection.rollback();

                return res.status(404).json({
                    success: false,
                    message:
                        "سفارش پیدا نشد."
                });
            }

            const order =
                orders[0];

            if (
                !isValidId(
                    order.user_id
                )
            ) {
                await connection.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "این سفارش کاربر معتبر ندارد."
                });
            }

            const plan =
                PREMIUM_PLANS[
                    order.plan_id
                ];

            if (!plan) {
                await connection.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "پلن سفارش معتبر نیست."
                });
            }

            const [users] =
                await connection.query(
                    `
                    SELECT
                        premium_expires_at
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [order.user_id]
                );

            if (
                users.length === 0
            ) {
                await connection.rollback();

                return res.status(404).json({
                    success: false,
                    message:
                        "کاربر سفارش پیدا نشد."
                });
            }

            const now =
                new Date();

            let startDate =
                now;

            const currentExpiry =
                users[0]
                    .premium_expires_at;

            if (
                currentExpiry &&
                new Date(
                    currentExpiry
                ).getTime() >
                    now.getTime()
            ) {
                startDate =
                    new Date(
                        currentExpiry
                    );
            }

            const newExpiry =
                addDays(
                    startDate,
                    plan.days
                );

            await connection.query(
                `
                UPDATE users
                SET
                    premium_expires_at = ?,
                    updated_at = NOW()
                WHERE id = ?
                `,
                [
                    newExpiry,
                    order.user_id
                ]
            );

            await connection.query(
                `
                UPDATE orders
                SET
                    status = 'APPROVED',
                    paid_at = NOW(),
                    premium_expires_at = ?,
                    updated_at = NOW()
                WHERE order_id = ?
                `,
                [
                    newExpiry,
                    orderId
                ]
            );

            await connection.commit();

            res.json({
                success: true,
                message:
                    "درخواست Premium تأیید شد.",
                orderId,
                premiumExpiresAt:
                    newExpiry
            });
        } catch (error) {
            await connection.rollback();

            console.error(
                "ADMIN APPROVE ORDER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در تأیید درخواست Premium.",
                error:
                    error.message
            });
        } finally {
            connection.release();
        }
    }
);

/* =========================================================
   ADMIN REJECT ORDER
========================================================= */

app.post(
    "/api/admin/orders/:orderId/reject",
    requireAdmin,
    async (req, res) => {
        try {
            const orderId =
                String(
                    req.params.orderId
                );

            const [result] =
                await pool.query(
                    `
                    UPDATE orders
                    SET
                        status = 'REJECTED',
                        updated_at = NOW()
                    WHERE order_id = ?
                      AND status = 'CREATED'
                    `,
                    [orderId]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "درخواست قابل رد پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "درخواست رد شد."
            });
        } catch (error) {
            console.error(
                "ADMIN REJECT ORDER ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در رد درخواست.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN MOVIES LIST
========================================================= */

app.get(
    "/api/admin/movies",
    requireAdmin,
    async (req, res) => {
        try {
            const search =
                String(
                    req.query.search ||
                        ""
                ).trim();

            let query = `
                SELECT
                    id,
                    title,
                    genre,
                    year,
                    description,
                    premium,
                    poster_url,
                    video_url,
                    created_at,
                    updated_at
                FROM movies
            `;

            const params = [];

            if (search) {
                query += `
                    WHERE title LIKE ?
                       OR genre LIKE ?
                `;

                params.push(
                    `%${search}%`,
                    `%${search}%`
                );
            }

            query += `
                ORDER BY id DESC
            `;

            const [rows] =
                await pool.query(
                    query,
                    params
                );

            res.json({
                success: true,
                count:
                    rows.length,
                movies:
                    rows
            });
        } catch (error) {
            console.error(
                "ADMIN MOVIES ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت فیلم‌ها.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN CREATE MOVIE
========================================================= */

app.post(
    "/api/admin/movies",
    requireAdmin,
    async (req, res) => {
        try {
            const {
                title,
                genre,
                year,
                description,
                premium,
                posterUrl,
                videoUrl
            } = req.body;

            const cleanTitle =
                String(
                    title || ""
                ).trim();

            if (!cleanTitle) {
                return res.status(400).json({
                    success: false,
                    message:
                        "عنوان فیلم الزامی است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    INSERT INTO movies
                    (
                        title,
                        genre,
                        year,
                        description,
                        premium,
                        poster_url,
                        video_url,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                    `,
                    [
                        cleanTitle,
                        String(
                            genre || ""
                        ).trim(),
                        year
                            ? Number(year)
                            : null,
                        String(
                            description || ""
                        ).trim(),
                        parseBoolean(
                            premium
                        ),
                        String(
                            posterUrl || ""
                        ).trim(),
                        String(
                            videoUrl || ""
                        ).trim()
                    ]
                );

            res.json({
                success: true,
                message:
                    "فیلم با موفقیت اضافه شد.",
                movieId:
                    result.insertId
            });
        } catch (error) {
            console.error(
                "ADMIN CREATE MOVIE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در اضافه کردن فیلم.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN UPDATE MOVIE
========================================================= */

app.put(
    "/api/admin/movies/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const movieId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(movieId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه فیلم نامعتبر است."
                });
            }

            const {
                title,
                genre,
                year,
                description,
                premium,
                posterUrl,
                videoUrl
            } = req.body;

            const cleanTitle =
                String(
                    title || ""
                ).trim();

            if (!cleanTitle) {
                return res.status(400).json({
                    success: false,
                    message:
                        "عنوان فیلم الزامی است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    UPDATE movies
                    SET
                        title = ?,
                        genre = ?,
                        year = ?,
                        description = ?,
                        premium = ?,
                        poster_url = ?,
                        video_url = ?,
                        updated_at = NOW()
                    WHERE id = ?
                    `,
                    [
                        cleanTitle,
                        String(
                            genre || ""
                        ).trim(),
                        year
                            ? Number(year)
                            : null,
                        String(
                            description || ""
                        ).trim(),
                        parseBoolean(
                            premium
                        ),
                        String(
                            posterUrl || ""
                        ).trim(),
                        String(
                            videoUrl || ""
                        ).trim(),
                        movieId
                    ]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "فیلم پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "فیلم بروزرسانی شد."
            });
        } catch (error) {
            console.error(
                "ADMIN UPDATE MOVIE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در بروزرسانی فیلم.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN DELETE MOVIE
========================================================= */

app.delete(
    "/api/admin/movies/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const movieId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(movieId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه فیلم نامعتبر است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    DELETE FROM movies
                    WHERE id = ?
                    `,
                    [movieId]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "فیلم پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "فیلم حذف شد."
            });
        } catch (error) {
            console.error(
                "ADMIN DELETE MOVIE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در حذف فیلم.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN EXPLORE VIDEOS LIST
========================================================= */

app.get(
    "/api/admin/explore/videos",
    requireAdmin,
    async (req, res) => {
        try {
            const search =
                String(
                    req.query.search ||
                        ""
                ).trim();

            let query = `
                SELECT
                    id,
                    title,
                    description,
                    video_url,
                    thumbnail_url,
                    premium,
                    active,
                    sort_order,
                    created_at,
                    updated_at
                FROM explore_videos
            `;

            const params = [];

            if (search) {
                query += `
                    WHERE title LIKE ?
                       OR description LIKE ?
                `;

                params.push(
                    `%${search}%`,
                    `%${search}%`
                );
            }

            query += `
                ORDER BY
                    sort_order ASC,
                    id DESC
            `;

            const [rows] =
                await pool.query(
                    query,
                    params
                );

            res.json({
                success: true,
                count:
                    rows.length,
                videos:
                    rows
            });
        } catch (error) {
            console.error(
                "ADMIN EXPLORE LIST ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت ویدئوهای Explore.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN CREATE EXPLORE VIDEO
========================================================= */

app.post(
    "/api/admin/explore/videos",
    requireAdmin,
    async (req, res) => {
        try {
            const {
                title,
                description,
                videoUrl,
                thumbnailUrl,
                premium,
                active,
                sortOrder
            } = req.body;

            const cleanTitle =
                String(
                    title || ""
                ).trim();

            const cleanDescription =
                String(
                    description || ""
                ).trim();

            const cleanVideoUrl =
                String(
                    videoUrl || ""
                ).trim();

            const cleanThumbnailUrl =
                String(
                    thumbnailUrl || ""
                ).trim();

            if (!cleanVideoUrl) {
                return res.status(400).json({
                    success: false,
                    message:
                        "آدرس ویدئو الزامی است."
                });
            }

            const finalSortOrder =
                Number.isFinite(
                    Number(sortOrder)
                )
                    ? Number(
                          sortOrder
                      )
                    : 0;

            const [result] =
                await pool.query(
                    `
                    INSERT INTO explore_videos
                    (
                        title,
                        description,
                        video_url,
                        thumbnail_url,
                        premium,
                        active,
                        sort_order,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                    `,
                    [
                        cleanTitle,
                        cleanDescription,
                        cleanVideoUrl,
                        cleanThumbnailUrl,
                        parseBoolean(
                            premium
                        ),
                        active === undefined
                            ? true
                            : parseBoolean(
                                  active
                              ),
                        finalSortOrder
                    ]
                );

            res.json({
                success: true,
                message:
                    "ویدئوی Explore با موفقیت اضافه شد.",
                videoId:
                    result.insertId
            });
        } catch (error) {
            console.error(
                "ADMIN CREATE EXPLORE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در اضافه کردن ویدئوی Explore.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN UPDATE EXPLORE VIDEO
========================================================= */

app.put(
    "/api/admin/explore/videos/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const videoId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(videoId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه ویدئوی Explore نامعتبر است."
                });
            }

            const {
                title,
                description,
                videoUrl,
                thumbnailUrl,
                premium,
                active,
                sortOrder
            } = req.body;

            const cleanTitle =
                String(
                    title || ""
                ).trim();

            const cleanDescription =
                String(
                    description || ""
                ).trim();

            const cleanVideoUrl =
                String(
                    videoUrl || ""
                ).trim();

            const cleanThumbnailUrl =
                String(
                    thumbnailUrl || ""
                ).trim();

            if (!cleanVideoUrl) {
                return res.status(400).json({
                    success: false,
                    message:
                        "آدرس ویدئو الزامی است."
                });
            }

            const finalSortOrder =
                Number.isFinite(
                    Number(sortOrder)
                )
                    ? Number(
                          sortOrder
                      )
                    : 0;

            const [result] =
                await pool.query(
                    `
                    UPDATE explore_videos
                    SET
                        title = ?,
                        description = ?,
                        video_url = ?,
                        thumbnail_url = ?,
                        premium = ?,
                        active = ?,
                        sort_order = ?,
                        updated_at = NOW()
                    WHERE id = ?
                    `,
                    [
                        cleanTitle,
                        cleanDescription,
                        cleanVideoUrl,
                        cleanThumbnailUrl,
                        parseBoolean(
                            premium
                        ),
                        active === undefined
                            ? true
                            : parseBoolean(
                                  active
                              ),
                        finalSortOrder,
                        videoId
                    ]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "ویدئوی Explore پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "ویدئوی Explore بروزرسانی شد."
            });
        } catch (error) {
            console.error(
                "ADMIN UPDATE EXPLORE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در بروزرسانی ویدئوی Explore.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ADMIN DELETE EXPLORE VIDEO
========================================================= */

app.delete(
    "/api/admin/explore/videos/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const videoId =
                Number(
                    req.params.id
                );

            if (
                !isValidId(videoId)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "شناسه ویدئوی Explore نامعتبر است."
                });
            }

            const [result] =
                await pool.query(
                    `
                    DELETE FROM explore_videos
                    WHERE id = ?
                    `,
                    [videoId]
                );

            if (
                result.affectedRows === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "ویدئوی Explore پیدا نشد."
                });
            }

            res.json({
                success: true,
                message:
                    "ویدئوی Explore حذف شد."
            });
        } catch (error) {
            console.error(
                "ADMIN DELETE EXPLORE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در حذف ویدئوی Explore.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   PUBLIC MOVIES
========================================================= */

app.get(
    "/api/movies",
    async (req, res) => {
        try {
            const [rows] =
                await pool.query(
                    `
                    SELECT
                        id,
                        title,
                        genre,
                        year,
                        description,
                        premium,
                        poster_url,
                        video_url,
                        created_at,
                        updated_at
                    FROM movies
                    ORDER BY id DESC
                    `
                );

            res.json({
                success: true,
                count:
                    rows.length,
                movies:
                    rows
            });
        } catch (error) {
            console.error(
                "PUBLIC MOVIES ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت فیلم‌ها.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   PUBLIC EXPLORE VIDEOS
=========================================================

   بدون userId:
   فقط ویدئوهای رایگان

   با userId معتبر:
   وضعیت Premium همان کاربر از users خوانده می‌شود.

   کاربر Free:
   ویدئوهای رایگان + ویدئوهای Premium بدون videoUrl

   کاربر Premium:
   همه ویدئوها با videoUrl
========================================================= */

app.get(
    "/api/explore/videos",
    async (req, res) => {
        try {
            const rawUserId =
                req.query.userId;

            let userId = null;
            let premiumActive = false;

            if (
                rawUserId !== undefined &&
                rawUserId !== null &&
                String(
                    rawUserId
                ).trim() !== ""
            ) {
                const numericUserId =
                    Number(
                        rawUserId
                    );

                if (
                    !isValidId(
                        numericUserId
                    )
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "شناسه کاربر نامعتبر است."
                    });
                }

                const [users] =
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
                            numericUserId
                        ]
                    );

                if (
                    users.length === 0
                ) {
                    return res.status(404).json({
                        success: false,
                        message:
                            "کاربر پیدا نشد."
                    });
                }

                userId =
                    users[0].id;

                premiumActive =
                    isPremiumDateActive(
                        users[0]
                            .premium_expires_at
                    );
            }

            const [rows] =
                await pool.query(
                    `
                    SELECT
                        id,
                        title,
                        description,
                        video_url,
                        thumbnail_url,
                        premium,
                        active,
                        sort_order,
                        created_at,
                        updated_at
                    FROM explore_videos
                    WHERE active = TRUE
                    ORDER BY
                        sort_order ASC,
                        id DESC
                    `
                );

            const videos =
                rows.map(
                    video => {
                        const isPremium =
                            Boolean(
                                video.premium
                            );

                        const allowed =
                            !isPremium ||
                            premiumActive;

                        return {
                            id:
                                video.id,
                            title:
                                video.title,
                            description:
                                video.description,
                            videoUrl:
                                allowed
                                    ? (
                                          video.video_url ||
                                          ""
                                      )
                                    : "",
                            thumbnailUrl:
                                video.thumbnail_url ||
                                "",
                            premium:
                                isPremium,
                            active:
                                Boolean(
                                    video.active
                                ),
                            sortOrder:
                                Number(
                                    video.sort_order ||
                                        0
                                ),
                            createdAt:
                                video.created_at,
                            updatedAt:
                                video.updated_at,
                            locked:
                                !allowed
                        };
                    }
                );

            res.json({
                success: true,
                userId,
                premiumActive:
                    Boolean(
                        premiumActive
                    ),
                count:
                    videos.length,
                videos
            });
        } catch (error) {
            console.error(
                "PUBLIC EXPLORE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "خطا در دریافت ویدئوهای Explore.",
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   ROOT
========================================================= */

app.get(
    "/",
    (req, res) => {
        res.send(
            "SPlay Backend is running."
        );
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
   GLOBAL ERROR
========================================================= */

app.use(
    (error, req, res, next) => {
        console.error(
            "GLOBAL ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Internal server error",
            error:
                error.message
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
