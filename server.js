const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();

// =====================================================================
// Security Middleware
// =====================================================================
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'"]
            }
        }
    })
);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 auth requests per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many authentication attempts. Please try again later."
    }
});

// =====================================================================
// Clever Cloud MySQL Connection Pool
// =====================================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false
    }
});

// Verify database connection and schema
async function initializeDatabase() {
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
        console.warn("Clever Cloud MySQL credentials not fully set in .env. Skipping database initialization.");
        return false;
    }

    let connection;
    try {
        connection = await pool.getConnection();
        console.log("Successfully connected to Clever Cloud MySQL.");

        // Read and execute database.sql if needed
        const sqlFilePath = path.join(__dirname, "database.sql");
        if (fs.existsSync(sqlFilePath)) {
            const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
            const cleanedSql = sqlContent
                .split("\n")
                .map(line => line.trim().startsWith("--") ? "" : line)
                .join("\n");

            const statements = cleanedSql
                .split(";")
                .map(st => st.trim())
                .filter(st => st.length > 0);

            for (const statement of statements) {
                await connection.query(statement);
            }
            console.log("Database schema checked/initialized successfully.");
        }

        // Verify the three required tables exist
        const [tables] = await connection.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('users', 'food_items', 'food_requests')",
            [process.env.DB_NAME]
        );
        const tableNames = tables.map(t => Object.values(t)[0]);
        console.log("Verified database tables:", tableNames.join(", "));

        // Ensure waste_reported_at column exists in food_items
        const [cols] = await connection.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'food_items' AND column_name = 'waste_reported_at'",
            [process.env.DB_NAME]
        );
        if (cols.length === 0) {
            await connection.query("ALTER TABLE food_items ADD COLUMN waste_reported_at DATETIME DEFAULT NULL AFTER created_at");
            console.log("Added waste_reported_at column to food_items.");
        }

        // Initialize admin account
        await initializeAdminAccount(connection);

        return true;
    } catch (err) {
        console.error("Clever Cloud MySQL connection/setup error:", err.message);
        return false;
    } finally {
        if (connection) connection.release();
    }
}

// Secure Admin Account Initialization
async function initializeAdminAccount(connection) {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || "System Administrator";

    if (!adminEmail || !adminPassword) {
        console.log("Admin initialization skipped: ADMIN_EMAIL or ADMIN_PASSWORD not configured in .env.");
        return;
    }

    try {
        const [existing] = await connection.query(
            "SELECT id FROM users WHERE email = ?",
            [adminEmail]
        );

        if (existing.length === 0) {
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            await connection.query(
                "INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, 'ADMIN', 'ACTIVE')",
                [adminName, adminEmail, hashedPassword]
            );
            console.log(`Admin account for ${adminEmail} successfully initialized.`);
        } else {
            console.log(`Admin account for ${adminEmail} already exists.`);
        }
    } catch (err) {
        console.error("Failed to initialize admin account:", err.message);
    }
}

// =====================================================================
// Authentication Middleware
// =====================================================================
async function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication token required"
        });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return res.status(500).json({
            success: false,
            message: "JWT secret is not configured on server"
        });
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);

        // Verify that the user still exists and is ACTIVE
        const [rows] = await pool.query(
            "SELECT id, name, email, phone, role, status FROM users WHERE id = ?",
            [decoded.id]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "User account no longer exists"
            });
        }

        const user = rows[0];
        if (user.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "Account is inactive. Access denied."
            });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token has expired"
            });
        }
        return res.status(403).json({
            success: false,
            message: "Invalid authentication token"
        });
    }
}

function authorizeRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "Access forbidden: insufficient role permissions"
            });
        }
        next();
    };
}

// =====================================================================
// Public & Health Routes
// =====================================================================
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "FoodBridge server is running"
    });
});

// =====================================================================
// Authentication Endpoints
// =====================================================================

// POST /api/register
app.post("/api/register", authLimiter, async (req, res) => {
    try {
        const { name, email, password, phone, role } = req.body;

        // Validation: required fields
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({ success: false, message: "Name is required" });
        }
        if (!email || typeof email !== "string" || !email.trim()) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        if (!password || typeof password !== "string") {
            return res.status(400).json({ success: false, message: "Password is required" });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const normalizedEmail = email.trim().toLowerCase();
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Invalid email format" });
        }

        // Password strength requirement (minimum 6 characters)
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long"
            });
        }

        // Enforce public registration role rules:
        // Default role is RECEIVER; DONOR is allowed if requested; ADMIN registration is prohibited.
        let assignedRole = "RECEIVER";
        if (role && typeof role === "string" && role.trim().toUpperCase() === "DONOR") {
            assignedRole = "DONOR";
        }

        // Prevent duplicate email registration
        const [existing] = await pool.query(
            "SELECT id FROM users WHERE email = ?",
            [normalizedEmail]
        );
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists"
            });
        }

        // Hash password with bcryptjs
        const hashedPassword = await bcrypt.hash(password, 10);
        const trimmedPhone = phone && typeof phone === "string" ? phone.trim() : null;

        // Save user into MySQL
        const [result] = await pool.query(
            "INSERT INTO users (name, email, password, phone, role, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')",
            [name.trim(), normalizedEmail, hashedPassword, trimmedPhone, assignedRole]
        );

        return res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: result.insertId,
                name: name.trim(),
                email: normalizedEmail,
                phone: trimmedPhone,
                role: assignedRole,
                status: "ACTIVE"
            }
        });
    } catch (err) {
        console.error("Registration error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error during registration"
        });
    }
});

// POST /api/login
app.post("/api/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

        // Find user by email
        const [rows] = await pool.query(
            "SELECT id, name, email, password, phone, role, status FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const user = rows[0];

        // Check if account is active
        if (user.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "Account is inactive. Please contact administrator."
            });
        }

        // Compare password using bcryptjs
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Generate JWT token
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return res.status(500).json({
                success: false,
                message: "Authentication service misconfigured"
            });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            jwtSecret,
            { expiresIn: "24h" }
        );

        return res.json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: user.status
            }
        });
    } catch (err) {
        console.error("Login error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error during login"
        });
    }
});

// GET /api/me
app.get("/api/me", authenticateToken, (req, res) => {
    return res.json({
        success: true,
        user: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            phone: req.user.phone,
            role: req.user.role,
            status: req.user.status
        }
    });
});

// =====================================================================
// Dashboard APIs (Real-time Clever Cloud MySQL Aggregations)
// =====================================================================

// GET /api/dashboard/admin
app.get("/api/dashboard/admin", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
    try {
        // User statistics (active/inactive breakdown)
        const [userStats] = await pool.query(
            "SELECT role, status, COUNT(*) as count FROM users GROUP BY role, status"
        );
        let totalUsers = 0;
        let totalDonors = 0;
        let totalReceivers = 0;
        let activeUsers = 0;
        let inactiveUsers = 0;
        for (const row of userStats) {
            totalUsers += Number(row.count);
            if (row.role === "DONOR") totalDonors += Number(row.count);
            if (row.role === "RECEIVER") totalReceivers += Number(row.count);
            if (row.status === "ACTIVE") activeUsers += Number(row.count);
            if (row.status === "INACTIVE") inactiveUsers += Number(row.count);
        }

        // Food item quantities and counts
        const [foodStats] = await pool.query(`
            SELECT 
                COUNT(*) as totalDonations,
                COALESCE(SUM(total_quantity), 0) as totalDonatedQuantity,
                COALESCE(SUM(available_quantity), 0) as totalAvailable,
                COALESCE(SUM(reserved_quantity), 0) as totalReserved,
                COALESCE(SUM(collected_quantity), 0) as totalCollected,
                COALESCE(SUM(wasted_quantity), 0) as totalWasted,
                COALESCE(SUM(cancelled_quantity), 0) as totalCancelled
            FROM food_items
        `);
        const food = foodStats[0] || {};

        // Food requests metrics
        const [reqStats] = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count,
                COALESCE(SUM(beneficiary_count), 0) as beneficiaries
            FROM food_requests
            GROUP BY status
        `);
        let pendingRequests = 0;
        let peopleHelped = 0;
        for (const row of reqStats) {
            if (row.status === "PENDING") pendingRequests = Number(row.count);
            if (row.status === "COMPLETED") peopleHelped = Number(row.beneficiaries);
        }

        // TODAY's daily statistics (accurate waste uses waste_reported_at)
        const [dailyFoodDonated] = await pool.query(`
            SELECT COALESCE(SUM(total_quantity), 0) as donatedToday
            FROM food_items WHERE DATE(created_at) = CURDATE()
        `);
        const [dailyFoodReused] = await pool.query(`
            SELECT 
                COALESCE(SUM(requested_quantity), 0) as reusedToday,
                COALESCE(SUM(beneficiary_count), 0) as peopleHelpedToday
            FROM food_requests
            WHERE status = 'COMPLETED' AND DATE(completed_at) = CURDATE()
        `);
        const [dailyFoodWasted] = await pool.query(`
            SELECT COALESCE(SUM(wasted_quantity), 0) as wastedToday
            FROM food_items
            WHERE waste_reported_at IS NOT NULL AND DATE(waste_reported_at) = CURDATE()
        `);

        // YESTERDAY's stats for comparison
        const [yFoodDonated] = await pool.query(`
            SELECT COALESCE(SUM(total_quantity), 0) as donatedYday
            FROM food_items WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `);
        const [yFoodReused] = await pool.query(`
            SELECT 
                COALESCE(SUM(requested_quantity), 0) as reusedYday,
                COALESCE(SUM(beneficiary_count), 0) as peopleHelpedYday
            FROM food_requests
            WHERE status = 'COMPLETED' AND DATE(completed_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `);
        const [yFoodWasted] = await pool.query(`
            SELECT COALESCE(SUM(wasted_quantity), 0) as wastedYday
            FROM food_items
            WHERE waste_reported_at IS NOT NULL AND DATE(waste_reported_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `);

        // Category breakdown for chart
        const [categories] = await pool.query(`
            SELECT category, COUNT(*) as count, COALESCE(SUM(total_quantity), 0) as quantity
            FROM food_items
            GROUP BY category
            ORDER BY quantity DESC
            LIMIT 6
        `);

        // Recent activities (richer: joins food names and user info)
        const [recentListings] = await pool.query(`
            SELECT 'LISTING' as activity_type,
                CONCAT(u.name, ' donated: ', f.food_name) as description,
                f.status, f.created_at
            FROM food_items f
            JOIN users u ON f.donor_id = u.id
            ORDER BY f.created_at DESC LIMIT 4
        `);
        const [recentCompletions] = await pool.query(`
            SELECT 'COLLECTION' as activity_type,
                CONCAT(ru.name, ' collected: ', fi.food_name) as description,
                r.status, r.completed_at as created_at
            FROM food_requests r
            JOIN food_items fi ON r.food_id = fi.id
            JOIN users ru ON r.receiver_id = ru.id
            WHERE r.status = 'COMPLETED'
            ORDER BY r.completed_at DESC LIMIT 3
        `);
        const [recentRegistrations] = await pool.query(`
            SELECT 'REGISTRATION' as activity_type,
                CONCAT(name, ' joined as ', role) as description,
                status, created_at
            FROM users
            ORDER BY created_at DESC LIMIT 3
        `);

        const recentActivities = [...recentListings, ...recentCompletions, ...recentRegistrations]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 8);

        return res.json({
            success: true,
            metrics: {
                totalUsers,
                totalDonors,
                totalReceivers,
                activeUsers,
                inactiveUsers,
                totalFoodDonations: Number(food.totalDonations || 0),
                foodReused: parseFloat(food.totalCollected || 0),
                foodWasted: parseFloat(food.totalWasted || 0),
                pendingRequests,
                peopleHelped
            },
            dailyStats: {
                foodDonatedToday: parseFloat(dailyFoodDonated[0]?.donatedToday || 0),
                foodReusedToday: parseFloat(dailyFoodReused[0]?.reusedToday || 0),
                foodWastedToday: parseFloat(dailyFoodWasted[0]?.wastedToday || 0),
                peopleHelpedToday: Number(dailyFoodReused[0]?.peopleHelpedToday || 0)
            },
            previousDayStats: {
                foodDonatedYday: parseFloat(yFoodDonated[0]?.donatedYday || 0),
                foodReusedYday: parseFloat(yFoodReused[0]?.reusedYday || 0),
                foodWastedYday: parseFloat(yFoodWasted[0]?.wastedYday || 0),
                peopleHelpedYday: Number(yFoodReused[0]?.peopleHelpedYday || 0)
            },
            charts: {
                redistribution: {
                    available: parseFloat(food.totalAvailable || 0),
                    reserved: parseFloat(food.totalReserved || 0),
                    collected: parseFloat(food.totalCollected || 0),
                    wasted: parseFloat(food.totalWasted || 0),
                    cancelled: parseFloat(food.totalCancelled || 0)
                },
                categories: categories.map(c => ({
                    category: c.category,
                    count: Number(c.count),
                    quantity: parseFloat(c.quantity)
                }))
            },
            recentActivities
        });
    } catch (err) {
        console.error("Admin dashboard error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error fetching admin dashboard"
        });
    }
});

// GET /api/dashboard/donor
app.get("/api/dashboard/donor", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    try {
        const donorId = req.user.id;

        // Food quantities for this donor
        const [donorFood] = await pool.query(`
            SELECT 
                COUNT(*) as totalDonations,
                COALESCE(SUM(total_quantity), 0) as totalDonated,
                COALESCE(SUM(available_quantity), 0) as totalAvailable,
                COALESCE(SUM(reserved_quantity), 0) as totalReserved,
                COALESCE(SUM(collected_quantity), 0) as totalCollected,
                COALESCE(SUM(wasted_quantity), 0) as totalWasted,
                COALESCE(SUM(cancelled_quantity), 0) as totalCancelled
            FROM food_items
            WHERE donor_id = ?
        `, [donorId]);
        const food = donorFood[0] || {};

        // Requests for this donor's listings
        const [reqStats] = await pool.query(`
            SELECT 
                r.status,
                COUNT(*) as count,
                COALESCE(SUM(r.beneficiary_count), 0) as beneficiaries
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE f.donor_id = ?
            GROUP BY r.status
        `, [donorId]);

        let pendingRequests = 0;
        let completedCollections = 0;
        let peopleHelped = 0;
        let acceptedRequests = 0;
        let rejectedRequests = 0;
        for (const row of reqStats) {
            if (row.status === "PENDING") pendingRequests = Number(row.count);
            if (row.status === "ACCEPTED") acceptedRequests = Number(row.count);
            if (row.status === "REJECTED") rejectedRequests = Number(row.count);
            if (row.status === "COMPLETED") {
                completedCollections = Number(row.count);
                peopleHelped = Number(row.beneficiaries);
            }
        }

        // Daily statistics
        const [dailyDonated] = await pool.query(`
            SELECT COALESCE(SUM(total_quantity), 0) as donatedToday
            FROM food_items
            WHERE donor_id = ? AND DATE(created_at) = CURDATE()
        `, [donorId]);

        const [dailyReused] = await pool.query(`
            SELECT 
                COALESCE(SUM(r.requested_quantity), 0) as reusedToday,
                COALESCE(SUM(r.beneficiary_count), 0) as peopleHelpedToday
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE f.donor_id = ? AND r.status = 'COMPLETED' AND DATE(r.completed_at) = CURDATE()
        `, [donorId]);

        const [dailyWasted] = await pool.query(`
            SELECT COALESCE(SUM(wasted_quantity), 0) as wastedToday
            FROM food_items
            WHERE donor_id = ? AND waste_reported_at IS NOT NULL AND DATE(waste_reported_at) = CURDATE()
        `, [donorId]);

        // Yesterday's stats for comparison
        const [yDonated] = await pool.query(`
            SELECT COALESCE(SUM(total_quantity), 0) as donatedYday
            FROM food_items
            WHERE donor_id = ? AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `, [donorId]);
        const [yReused] = await pool.query(`
            SELECT COALESCE(SUM(r.requested_quantity), 0) as reusedYday
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE f.donor_id = ? AND r.status = 'COMPLETED' AND DATE(r.completed_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `, [donorId]);

        // Recent listings by donor
        const [recentListings] = await pool.query(`
            SELECT id, food_name, category, total_quantity, available_quantity, unit, status, created_at
            FROM food_items
            WHERE donor_id = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [donorId]);

        return res.json({
            success: true,
            metrics: {
                totalDonated: parseFloat(food.totalDonated || 0),
                foodReused: parseFloat(food.totalCollected || 0),
                foodWasted: parseFloat(food.totalWasted || 0),
                pendingRequests,
                acceptedRequests,
                rejectedRequests,
                completedCollections,
                peopleHelped
            },
            dailyStats: {
                dailyDonation: parseFloat(dailyDonated[0]?.donatedToday || 0),
                dailyReused: parseFloat(dailyReused[0]?.reusedToday || 0),
                dailyWasted: parseFloat(dailyWasted[0]?.wastedToday || 0),
                peopleHelpedToday: Number(dailyReused[0]?.peopleHelpedToday || 0)
            },
            previousDayStats: {
                dailyDonationYday: parseFloat(yDonated[0]?.donatedYday || 0),
                dailyReusedYday: parseFloat(yReused[0]?.reusedYday || 0)
            },
            charts: {
                breakdown: {
                    available: parseFloat(food.totalAvailable || 0),
                    reserved: parseFloat(food.totalReserved || 0),
                    collected: parseFloat(food.totalCollected || 0),
                    wasted: parseFloat(food.totalWasted || 0),
                    cancelled: parseFloat(food.totalCancelled || 0)
                }
            },
            recentActivities: recentListings
        });
    } catch (err) {
        console.error("Donor dashboard error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error fetching donor dashboard"
        });
    }
});

// GET /api/dashboard/receiver
app.get("/api/dashboard/receiver", authenticateToken, authorizeRole("RECEIVER"), async (req, res) => {
    try {
        const receiverId = req.user.id;

        // Count available listings on platform
        const [availListings] = await pool.query(`
            SELECT COUNT(*) as availableCount
            FROM food_items
            WHERE status = 'AVAILABLE' AND expiry_at > NOW()
        `);
        const availableCount = Number(availListings[0]?.availableCount || 0);

        // Requests by receiver
        const [reqStats] = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count,
                COALESCE(SUM(requested_quantity), 0) as totalQuantity
            FROM food_requests
            WHERE receiver_id = ?
            GROUP BY status
        `, [receiverId]);

        let pendingRequests = 0;
        let approvedRequests = 0;
        let completedCollections = 0;
        let totalCollectedQuantity = 0;
        const statusBreakdown = {
            PENDING: 0,
            ACCEPTED: 0,
            REJECTED: 0,
            CANCELLED: 0,
            COMPLETED: 0
        };

        for (const row of reqStats) {
            statusBreakdown[row.status] = Number(row.count);
            if (row.status === "PENDING") pendingRequests = Number(row.count);
            if (row.status === "ACCEPTED") approvedRequests = Number(row.count);
            if (row.status === "COMPLETED") {
                completedCollections = Number(row.count);
                totalCollectedQuantity = parseFloat(row.totalQuantity);
            }
        }

        // Daily collected
        const [dailyCollected] = await pool.query(`
            SELECT COALESCE(SUM(requested_quantity), 0) as collectedToday
            FROM food_requests
            WHERE receiver_id = ? AND status = 'COMPLETED' AND DATE(completed_at) = CURDATE()
        `, [receiverId]);

        // Yesterday collected for comparison
        const [yCollected] = await pool.query(`
            SELECT COALESCE(SUM(requested_quantity), 0) as collectedYday
            FROM food_requests
            WHERE receiver_id = ? AND status = 'COMPLETED' AND DATE(completed_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        `, [receiverId]);

        // Recent requests by receiver
        const [recentRequests] = await pool.query(`
            SELECT 
                r.id,
                f.food_name,
                r.requested_quantity,
                f.unit,
                r.status,
                r.created_at
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE r.receiver_id = ?
            ORDER BY r.created_at DESC
            LIMIT 5
        `, [receiverId]);

        return res.json({
            success: true,
            metrics: {
                availableFoodListings: availableCount,
                pendingRequests,
                approvedRequests,
                completedCollections,
                totalCollectedQuantity
            },
            dailyStats: {
                collectedToday: parseFloat(dailyCollected[0]?.collectedToday || 0)
            },
            previousDayStats: {
                collectedYday: parseFloat(yCollected[0]?.collectedYday || 0)
            },
            charts: {
                statusBreakdown
            },
            recentActivities: recentRequests
        });
    } catch (err) {
        console.error("Receiver dashboard error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error fetching receiver dashboard"
        });
    }
});

// =====================================================================
// PHASE 4: FOOD DONATION & REDISTRIBUTION APIS
// =====================================================================

// ---------------------------------------------------------------------
// 1. POST /api/food - Create Food Donation Listing (Donor Only)
// ---------------------------------------------------------------------
app.post("/api/food", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    try {
        const {
            food_name,
            category,
            description,
            total_quantity,
            unit,
            prepared_at,
            expiry_at,
            pickup_address,
            image_url
        } = req.body;

        // Validation: required fields
        if (!food_name || typeof food_name !== "string" || !food_name.trim()) {
            return res.status(400).json({ success: false, message: "Food name is required" });
        }
        if (!category || typeof category !== "string" || !category.trim()) {
            return res.status(400).json({ success: false, message: "Food category is required" });
        }
        if (!unit || typeof unit !== "string" || !unit.trim()) {
            return res.status(400).json({ success: false, message: "Quantity unit is required (e.g. kg, packets, meals)" });
        }
        if (!pickup_address || typeof pickup_address !== "string" || !pickup_address.trim()) {
            return res.status(400).json({ success: false, message: "Pickup address is required" });
        }
        if (!expiry_at) {
            return res.status(400).json({ success: false, message: "Expiry date and time is required" });
        }

        const parsedQuantity = parseFloat(total_quantity);
        if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
            return res.status(400).json({ success: false, message: "Total quantity must be greater than zero" });
        }

        const expiryDate = new Date(expiry_at);
        if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
            return res.status(400).json({ success: false, message: "Expiry date must be a valid future date and time" });
        }

        let prepDate = null;
        if (prepared_at) {
            prepDate = new Date(prepared_at);
            if (isNaN(prepDate.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid preparation date and time" });
            }
            if (prepDate > new Date()) {
                return res.status(400).json({ success: false, message: "Preparation date cannot be in the future" });
            }
            if (expiryDate <= prepDate) {
                return res.status(400).json({ success: false, message: "Expiry date must be later than preparation date" });
            }
        }

        const trimmedImage = image_url && typeof image_url === "string" && image_url.trim().length > 0 ? image_url.trim() : null;

        // Save listing into MySQL
        const [result] = await pool.query(`
            INSERT INTO food_items (
                donor_id, food_name, category, description,
                total_quantity, available_quantity, reserved_quantity,
                collected_quantity, wasted_quantity, cancelled_quantity,
                unit, image_url, prepared_at, expiry_at, pickup_address, status
            ) VALUES (?, ?, ?, ?, ?, ?, 0.00, 0.00, 0.00, 0.00, ?, ?, ?, ?, ?, 'AVAILABLE')
        `, [
            req.user.id,
            food_name.trim(),
            category.trim(),
            description ? description.trim() : null,
            parsedQuantity,
            parsedQuantity, // available_quantity initialized to total_quantity
            unit.trim(),
            trimmedImage,
            prepDate,
            expiryDate,
            pickup_address.trim()
        ]);

        const [createdRows] = await pool.query("SELECT * FROM food_items WHERE id = ?", [result.insertId]);

        return res.status(201).json({
            success: true,
            message: "Food donation listing created successfully",
            food: createdRows[0]
        });
    } catch (err) {
        console.error("Create food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error creating food listing" });
    }
});

// ---------------------------------------------------------------------
// 2. GET /api/my-food - View Donor's Own Food Listings (Donor Only)
// ---------------------------------------------------------------------
app.get("/api/my-food", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    try {
        let query = "SELECT * FROM food_items WHERE donor_id = ?";
        const params = [req.user.id];

        if (req.query.status) {
            query += " AND status = ?";
            params.push(req.query.status);
        }

        query += " ORDER BY created_at DESC";

        const [rows] = await pool.query(query, params);

        return res.json({
            success: true,
            food: rows
        });
    } catch (err) {
        console.error("Get my-food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching your food listings" });
    }
});

// ---------------------------------------------------------------------
// 3. PUT /api/food/:id - Edit Food Donation Listing (Donor Only)
// ---------------------------------------------------------------------
app.put("/api/food/:id", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    const foodId = parseInt(req.params.id, 10);
    if (isNaN(foodId)) {
        return res.status(400).json({ success: false, message: "Invalid food ID" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query("SELECT * FROM food_items WHERE id = ? FOR UPDATE", [foodId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Food listing not found" });
        }

        const item = rows[0];

        // Ownership check
        if (item.donor_id !== req.user.id) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: "You are not authorized to edit this listing" });
        }

        // Status check
        if (item.status === "CANCELLED" || item.status === "COMPLETED") {
            await conn.rollback();
            return res.status(400).json({ success: false, message: `Cannot edit listing with status ${item.status}` });
        }

        const {
            food_name,
            category,
            description,
            total_quantity,
            unit,
            prepared_at,
            expiry_at,
            pickup_address,
            image_url
        } = req.body;

        const updatedName = food_name !== undefined ? food_name.trim() : item.food_name;
        const updatedCat = category !== undefined ? category.trim() : item.category;
        const updatedDesc = description !== undefined ? description.trim() : item.description;
        const updatedUnit = unit !== undefined ? unit.trim() : item.unit;
        const updatedAddress = pickup_address !== undefined ? pickup_address.trim() : item.pickup_address;
        const updatedImage = image_url !== undefined ? (image_url ? image_url.trim() : null) : item.image_url;

        let updatedExpiry = item.expiry_at;
        if (expiry_at !== undefined) {
            const expD = new Date(expiry_at);
            if (isNaN(expD.getTime()) || expD <= new Date()) {
                await conn.rollback();
                return res.status(400).json({ success: false, message: "Expiry date must be in the future" });
            }
            updatedExpiry = expD;
        }

        let updatedPrep = item.prepared_at;
        if (prepared_at !== undefined) {
            if (prepared_at) {
                const pD = new Date(prepared_at);
                if (isNaN(pD.getTime()) || pD > new Date() || pD >= new Date(updatedExpiry)) {
                    await conn.rollback();
                    return res.status(400).json({ success: false, message: "Invalid preparation date" });
                }
                updatedPrep = pD;
            } else {
                updatedPrep = null;
            }
        }

        // Quantity calculations preserving invariant
        let newTotal = parseFloat(item.total_quantity);
        let newAvailable = parseFloat(item.available_quantity);
        let newStatus = item.status;

        if (total_quantity !== undefined) {
            const parsedTotal = parseFloat(total_quantity);
            if (isNaN(parsedTotal) || parsedTotal <= 0) {
                await conn.rollback();
                return res.status(400).json({ success: false, message: "Total quantity must be greater than zero" });
            }

            const committed = parseFloat(item.reserved_quantity) +
                              parseFloat(item.collected_quantity) +
                              parseFloat(item.wasted_quantity) +
                              parseFloat(item.cancelled_quantity);

            if (parsedTotal < committed) {
                await conn.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Total quantity cannot be reduced below committed quantities (${committed} ${item.unit})`
                });
            }

            newTotal = parsedTotal;
            newAvailable = newTotal - committed;

            if (newAvailable === 0 && parseFloat(item.reserved_quantity) > 0) {
                newStatus = "FULLY_RESERVED";
            } else if (newAvailable > 0) {
                newStatus = "AVAILABLE";
            }
        }

        await conn.query(`
            UPDATE food_items SET
                food_name = ?,
                category = ?,
                description = ?,
                total_quantity = ?,
                available_quantity = ?,
                unit = ?,
                image_url = ?,
                prepared_at = ?,
                expiry_at = ?,
                pickup_address = ?,
                status = ?
            WHERE id = ?
        `, [
            updatedName,
            updatedCat,
            updatedDesc,
            newTotal,
            newAvailable,
            updatedUnit,
            updatedImage,
            updatedPrep,
            updatedExpiry,
            updatedAddress,
            newStatus,
            foodId
        ]);

        await conn.commit();

        const [updatedRows] = await pool.query("SELECT * FROM food_items WHERE id = ?", [foodId]);

        return res.json({
            success: true,
            message: "Food listing updated successfully",
            food: updatedRows[0]
        });
    } catch (err) {
        await conn.rollback();
        console.error("Edit food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error updating food listing" });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------
// 4. DELETE /api/food/:id - Cancel Food Donation Listing (Donor Only)
// ---------------------------------------------------------------------
app.delete("/api/food/:id", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    const foodId = parseInt(req.params.id, 10);
    if (isNaN(foodId)) {
        return res.status(400).json({ success: false, message: "Invalid food ID" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query("SELECT * FROM food_items WHERE id = ? FOR UPDATE", [foodId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Food listing not found" });
        }

        const item = rows[0];

        // Ownership check
        if (item.donor_id !== req.user.id) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: "You are not authorized to cancel this listing" });
        }

        if (item.status === "CANCELLED") {
            await conn.rollback();
            return res.status(400).json({ success: false, message: "Listing is already cancelled" });
        }
        if (item.status === "COMPLETED") {
            await conn.rollback();
            return res.status(400).json({ success: false, message: "Cannot cancel a completed listing" });
        }

        // Rule: Resolve accepted reservations safely before fully cancelling a listing.
        const [activeReservations] = await conn.query(
            "SELECT COUNT(*) as count FROM food_requests WHERE food_id = ? AND status = 'ACCEPTED'",
            [foodId]
        );

        if (activeReservations[0].count > 0) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                message: "Cannot cancel listing with unresolved accepted requests. Please complete collections or resolve accepted requests first."
            });
        }

        // Reject any pending requests
        await conn.query(`
            UPDATE food_requests 
            SET status = 'REJECTED', rejection_reason = 'Listing was cancelled by donor' 
            WHERE food_id = ? AND status = 'PENDING'
        `, [foodId]);

        // Move remaining available quantity into cancelled_quantity; available becomes 0
        const avail = parseFloat(item.available_quantity);
        await conn.query(`
            UPDATE food_items 
            SET cancelled_quantity = cancelled_quantity + ?, available_quantity = 0.00, status = 'CANCELLED' 
            WHERE id = ?
        `, [avail, foodId]);

        await conn.commit();

        return res.json({
            success: true,
            message: "Food listing cancelled successfully. Unreserved available quantity moved to cancelled quantity."
        });
    } catch (err) {
        await conn.rollback();
        console.error("Cancel food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error cancelling food listing" });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------
// 5. PATCH /api/food/:id/waste - Report Wasted Quantity (Donor Only)
// ---------------------------------------------------------------------
app.patch("/api/food/:id/waste", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    const foodId = parseInt(req.params.id, 10);
    if (isNaN(foodId)) {
        return res.status(400).json({ success: false, message: "Invalid food ID" });
    }

    const { quantity } = req.body;
    const wasteQty = parseFloat(quantity);
    if (isNaN(wasteQty) || wasteQty <= 0) {
        return res.status(400).json({ success: false, message: "Waste quantity must be greater than zero" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query("SELECT * FROM food_items WHERE id = ? FOR UPDATE", [foodId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Food listing not found" });
        }

        const item = rows[0];

        // Ownership check
        if (item.donor_id !== req.user.id) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: "You are not authorized to report waste for this listing" });
        }

        const currentAvail = parseFloat(item.available_quantity);
        if (wasteQty > currentAvail) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                message: `Waste quantity (${wasteQty}) cannot exceed available quantity (${currentAvail})`
            });
        }

        const newAvail = currentAvail - wasteQty;
        const newWasted = parseFloat(item.wasted_quantity) + wasteQty;

        let newStatus = item.status;
        if (newAvail === 0) {
            newStatus = parseFloat(item.reserved_quantity) > 0 ? "FULLY_RESERVED" : "COMPLETED";
        }

        await conn.query(`
            UPDATE food_items 
            SET available_quantity = ?, wasted_quantity = ?, status = ?, waste_reported_at = NOW()
            WHERE id = ?
        `, [newAvail, newWasted, newStatus, foodId]);

        await conn.commit();

        const [updatedRows] = await pool.query("SELECT * FROM food_items WHERE id = ?", [foodId]);

        return res.json({
            success: true,
            message: `Successfully reported ${wasteQty} ${item.unit} as wasted`,
            food: updatedRows[0]
        });
    } catch (err) {
        await conn.rollback();
        console.error("Waste report error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error reporting food waste" });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------
// 6. GET /api/food - Browse Available Food Listings
// ---------------------------------------------------------------------
app.get("/api/food", async (req, res) => {
    try {
        const { category, search, sort } = req.query;

        // Base criteria: Available, available_quantity > 0, not expired
        let query = `
            SELECT 
                f.id, f.donor_id, f.food_name, f.category, f.description,
                f.total_quantity, f.available_quantity, f.reserved_quantity,
                f.unit, f.image_url, f.prepared_at, f.expiry_at, f.pickup_address,
                f.status, f.created_at,
                u.name as donor_name, u.phone as donor_phone
            FROM food_items f
            JOIN users u ON f.donor_id = u.id
            WHERE f.status = 'AVAILABLE' 
              AND f.available_quantity > 0 
              AND f.expiry_at > NOW()
        `;
        const params = [];

        if (category && typeof category === "string" && category.trim()) {
            query += " AND f.category = ?";
            params.push(category.trim());
        }

        if (search && typeof search === "string" && search.trim()) {
            query += " AND f.food_name LIKE ?";
            params.push(`%${search.trim()}%`);
        }

        if (sort === "expiry") {
            query += " ORDER BY f.expiry_at ASC";
        } else if (sort === "quantity") {
            query += " ORDER BY f.available_quantity DESC";
        } else {
            query += " ORDER BY f.created_at DESC";
        }

        const [rows] = await pool.query(query, params);

        return res.json({
            success: true,
            food: rows
        });
    } catch (err) {
        console.error("Browse food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error browsing food listings" });
    }
});

// ---------------------------------------------------------------------
// 7. GET /api/food/:id - View Food Details
// ---------------------------------------------------------------------
app.get("/api/food/:id", async (req, res) => {
    try {
        const foodId = parseInt(req.params.id, 10);
        if (isNaN(foodId)) {
            return res.status(400).json({ success: false, message: "Invalid food ID" });
        }

        const [rows] = await pool.query(`
            SELECT 
                f.id, f.donor_id, f.food_name, f.category, f.description,
                f.total_quantity, f.available_quantity, f.reserved_quantity,
                f.collected_quantity, f.wasted_quantity, f.cancelled_quantity,
                f.unit, f.image_url, f.prepared_at, f.expiry_at, f.pickup_address,
                f.status, f.created_at,
                u.name as donor_name, u.phone as donor_phone
            FROM food_items f
            JOIN users u ON f.donor_id = u.id
            WHERE f.id = ?
        `, [foodId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Food listing not found" });
        }

        return res.json({
            success: true,
            food: rows[0]
        });
    } catch (err) {
        console.error("Get food details error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching food details" });
    }
});

// ---------------------------------------------------------------------
// 8. POST /api/requests - Submit Food Request (Receiver Only)
// ---------------------------------------------------------------------
app.post("/api/requests", authenticateToken, authorizeRole("RECEIVER"), async (req, res) => {
    try {
        const { food_id, requested_quantity, pickup_time } = req.body;

        const foodId = parseInt(food_id, 10);
        if (isNaN(foodId)) {
            return res.status(400).json({ success: false, message: "Valid food_id is required" });
        }

        const reqQty = parseFloat(requested_quantity);
        if (isNaN(reqQty) || reqQty <= 0) {
            return res.status(400).json({ success: false, message: "Requested quantity must be greater than zero" });
        }

        const [foodRows] = await pool.query("SELECT * FROM food_items WHERE id = ?", [foodId]);
        if (foodRows.length === 0) {
            return res.status(404).json({ success: false, message: "Food listing not found" });
        }

        const food = foodRows[0];

        // Rule: Prevent donors from requesting their own food
        if (food.donor_id === req.user.id) {
            return res.status(400).json({ success: false, message: "Donors cannot request their own food listings" });
        }

        // Check availability & expiry
        if (food.status !== "AVAILABLE") {
            return res.status(400).json({ success: false, message: "This food listing is not currently available for requests" });
        }
        if (new Date(food.expiry_at) <= new Date()) {
            return res.status(400).json({ success: false, message: "This food listing has expired and cannot be requested" });
        }
        if (reqQty > parseFloat(food.available_quantity)) {
            return res.status(400).json({
                success: false,
                message: `Requested quantity (${reqQty}) exceeds available quantity (${food.available_quantity})`
            });
        }

        // Rule: Prevent duplicate active requests from the same receiver for the same listing
        const [existingActive] = await pool.query(`
            SELECT id FROM food_requests 
            WHERE food_id = ? AND receiver_id = ? AND status IN ('PENDING', 'ACCEPTED')
        `, [foodId, req.user.id]);

        if (existingActive.length > 0) {
            return res.status(409).json({
                success: false,
                message: "You already have an active request pending or accepted for this food listing."
            });
        }

        let parsedPickup = null;
        if (pickup_time) {
            const pDate = new Date(pickup_time);
            if (!isNaN(pDate.getTime())) parsedPickup = pDate;
        }

        // Insert request with PENDING status (does not reserve quantity yet)
        const [result] = await pool.query(`
            INSERT INTO food_requests (food_id, receiver_id, requested_quantity, pickup_time, status)
            VALUES (?, ?, ?, ?, 'PENDING')
        `, [foodId, req.user.id, reqQty, parsedPickup]);

        const [createdRequest] = await pool.query("SELECT * FROM food_requests WHERE id = ?", [result.insertId]);

        return res.status(201).json({
            success: true,
            message: "Food request submitted successfully with PENDING status",
            request: createdRequest[0]
        });
    } catch (err) {
        console.error("Submit request error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error submitting food request" });
    }
});

// ---------------------------------------------------------------------
// 9. GET /api/received-requests - View Incoming Requests for Donor's Listings
// ---------------------------------------------------------------------
app.get("/api/received-requests", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                r.id, r.food_id, r.receiver_id, r.requested_quantity, r.beneficiary_count,
                r.rejection_reason, r.status, r.pickup_time, r.completed_at, r.created_at,
                f.food_name, f.unit, f.available_quantity, f.pickup_address,
                u.name as receiver_name, u.phone as receiver_phone, u.email as receiver_email
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            JOIN users u ON r.receiver_id = u.id
            WHERE f.donor_id = ?
            ORDER BY r.created_at DESC
        `, [req.user.id]);

        return res.json({
            success: true,
            requests: rows
        });
    } catch (err) {
        console.error("Get received requests error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching incoming requests" });
    }
});

// ---------------------------------------------------------------------
// 10. GET /api/my-requests - View Receiver's Own Requests
// ---------------------------------------------------------------------
app.get("/api/my-requests", authenticateToken, authorizeRole("RECEIVER"), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                r.id, r.food_id, r.requested_quantity, r.beneficiary_count,
                r.rejection_reason, r.status, r.pickup_time, r.completed_at, r.created_at,
                f.food_name, f.category, f.unit, f.pickup_address, f.expiry_at,
                u.name as donor_name, u.phone as donor_phone
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            JOIN users u ON f.donor_id = u.id
            WHERE r.receiver_id = ?
            ORDER BY r.created_at DESC
        `, [req.user.id]);

        return res.json({
            success: true,
            requests: rows
        });
    } catch (err) {
        console.error("Get my-requests error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching your requests" });
    }
});

// ---------------------------------------------------------------------
// 11. PATCH /api/requests/:id/accept - Accept Request & Reserve Quantity
// ---------------------------------------------------------------------
app.patch("/api/requests/:id/accept", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) {
        return res.status(400).json({ success: false, message: "Invalid request ID" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Lock both request and food item rows
        const [reqRows] = await conn.query(`
            SELECT r.*, f.donor_id, f.available_quantity, f.reserved_quantity, f.status as food_status, f.expiry_at
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE r.id = ?
            FOR UPDATE
        `, [requestId]);

        if (reqRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const reqData = reqRows[0];

        // Authorization check: only listing donor can accept
        if (reqData.donor_id !== req.user.id) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized: only the donor can accept this request" });
        }

        // Only PENDING requests can be accepted
        if (reqData.status !== "PENDING") {
            await conn.rollback();
            return res.status(400).json({ success: false, message: `Only PENDING requests can be accepted. Current status: ${reqData.status}` });
        }

        // Recheck expiry
        if (new Date(reqData.expiry_at) <= new Date()) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: "Cannot accept request: food listing has expired" });
        }

        const requested = parseFloat(reqData.requested_quantity);
        const available = parseFloat(reqData.available_quantity);

        // Ensure requested quantity is still available
        if (requested > available) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                message: `Insufficient quantity available. Requested: ${requested}, Available: ${available}`
            });
        }

        // Move requested_quantity from available_quantity to reserved_quantity
        const newAvailable = available - requested;
        const newReserved = parseFloat(reqData.reserved_quantity) + requested;
        const newFoodStatus = newAvailable === 0 ? "FULLY_RESERVED" : "AVAILABLE";

        await conn.query(`
            UPDATE food_items 
            SET available_quantity = ?, reserved_quantity = ?, status = ? 
            WHERE id = ?
        `, [newAvailable, newReserved, newFoodStatus, reqData.food_id]);

        // Change request status to ACCEPTED
        await conn.query(`
            UPDATE food_requests 
            SET status = 'ACCEPTED' 
            WHERE id = ?
        `, [requestId]);

        await conn.commit();

        return res.json({
            success: true,
            message: `Request #${requestId} accepted. ${requested} reserved.`
        });
    } catch (err) {
        await conn.rollback();
        console.error("Accept request error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error accepting request" });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------
// 12. PATCH /api/requests/:id/reject - Reject Request (Donor Only)
// ---------------------------------------------------------------------
app.patch("/api/requests/:id/reject", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) {
        return res.status(400).json({ success: false, message: "Invalid request ID" });
    }

    try {
        const { rejection_reason } = req.body;

        const [reqRows] = await pool.query(`
            SELECT r.*, f.donor_id
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE r.id = ?
        `, [requestId]);

        if (reqRows.length === 0) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const reqData = reqRows[0];

        if (reqData.donor_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Unauthorized: only the donor can reject this request" });
        }

        if (reqData.status !== "PENDING") {
            return res.status(400).json({ success: false, message: `Only PENDING requests can be rejected. Current status: ${reqData.status}` });
        }

        const reason = rejection_reason && typeof rejection_reason === "string" ? rejection_reason.trim() : null;

        await pool.query(`
            UPDATE food_requests 
            SET status = 'REJECTED', rejection_reason = ? 
            WHERE id = ?
        `, [reason, requestId]);

        return res.json({
            success: true,
            message: "Request rejected successfully"
        });
    } catch (err) {
        console.error("Reject request error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error rejecting request" });
    }
});

// ---------------------------------------------------------------------
// 13. PATCH /api/requests/:id/cancel - Cancel Request (Receiver or Donor)
// ---------------------------------------------------------------------
app.patch("/api/requests/:id/cancel", authenticateToken, async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) {
        return res.status(400).json({ success: false, message: "Invalid request ID" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [reqRows] = await conn.query(`
            SELECT r.*, f.donor_id, f.available_quantity, f.reserved_quantity, f.status as food_status, f.expiry_at
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE r.id = ?
            FOR UPDATE
        `, [requestId]);

        if (reqRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const reqData = reqRows[0];

        // Authorization check: receiver who created it OR donor who owns listing
        const isReceiver = reqData.receiver_id === req.user.id;
        const isDonor = reqData.donor_id === req.user.id;

        if (!isReceiver && !isDonor) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized to cancel this request" });
        }

        if (reqData.status === "CANCELLED" || reqData.status === "COMPLETED" || reqData.status === "REJECTED") {
            await conn.rollback();
            return res.status(400).json({ success: false, message: `Cannot cancel a request that is already ${reqData.status}` });
        }

        const requested = parseFloat(reqData.requested_quantity);

        // If PENDING: no reserved quantity to release
        if (reqData.status === "PENDING") {
            await conn.query("UPDATE food_requests SET status = 'CANCELLED' WHERE id = ?", [requestId]);
            await conn.commit();
            return res.json({ success: true, message: "Pending request cancelled successfully" });
        }

        // If ACCEPTED: release reserved quantity safely
        if (reqData.status === "ACCEPTED") {
            const isListingActive = reqData.food_status !== "CANCELLED" && new Date(reqData.expiry_at) > new Date();

            if (isListingActive) {
                // Return to available quantity
                const newAvailable = parseFloat(reqData.available_quantity) + requested;
                const newReserved = Math.max(0, parseFloat(reqData.reserved_quantity) - requested);
                const newFoodStatus = newAvailable > 0 ? "AVAILABLE" : reqData.food_status;

                await conn.query(`
                    UPDATE food_items 
                    SET available_quantity = ?, reserved_quantity = ?, status = ? 
                    WHERE id = ?
                `, [newAvailable, newReserved, newFoodStatus, reqData.food_id]);
            } else {
                // Listing is expired or cancelled: do not return to available quantity.
                // Deduct from reserved and add to cancelled to maintain total quantity formula.
                const newReserved = Math.max(0, parseFloat(reqData.reserved_quantity) - requested);
                await conn.query(`
                    UPDATE food_items 
                    SET reserved_quantity = ?, cancelled_quantity = cancelled_quantity + ? 
                    WHERE id = ?
                `, [newReserved, requested, reqData.food_id]);
            }

            await conn.query("UPDATE food_requests SET status = 'CANCELLED' WHERE id = ?", [requestId]);
            await conn.commit();

            return res.json({
                success: true,
                message: "Accepted request cancelled and quantities released safely."
            });
        }
    } catch (err) {
        await conn.rollback();
        console.error("Cancel request error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error cancelling request" });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------
// 14. PATCH /api/requests/:id/complete - Confirm Food Collection (Donor Only)
// ---------------------------------------------------------------------
app.patch("/api/requests/:id/complete", authenticateToken, authorizeRole("DONOR"), async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) {
        return res.status(400).json({ success: false, message: "Invalid request ID" });
    }

    const { beneficiary_count } = req.body;
    const parsedBeneficiaries = parseInt(beneficiary_count, 10);
    if (isNaN(parsedBeneficiaries) || parsedBeneficiaries < 0) {
        return res.status(400).json({
            success: false,
            message: "Beneficiary count is required and must be a non-negative number"
        });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [reqRows] = await conn.query(`
            SELECT r.*, f.donor_id, f.available_quantity, f.reserved_quantity, f.collected_quantity, f.status as food_status
            FROM food_requests r
            JOIN food_items f ON r.food_id = f.id
            WHERE r.id = ?
            FOR UPDATE
        `, [requestId]);

        if (reqRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const reqData = reqRows[0];

        // Ownership check
        if (reqData.donor_id !== req.user.id) {
            await conn.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized: only the donor can confirm collection" });
        }

        // Only ACCEPTED requests can be completed
        if (reqData.status !== "ACCEPTED") {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                message: `Only ACCEPTED requests can be confirmed as completed. Current status: ${reqData.status}`
            });
        }

        const requested = parseFloat(reqData.requested_quantity);
        const newReserved = Math.max(0, parseFloat(reqData.reserved_quantity) - requested);
        const newCollected = parseFloat(reqData.collected_quantity) + requested;

        let newFoodStatus = reqData.food_status;
        if (parseFloat(reqData.available_quantity) === 0 && newReserved === 0) {
            newFoodStatus = "COMPLETED";
        } else if (parseFloat(reqData.available_quantity) === 0) {
            newFoodStatus = "FULLY_RESERVED";
        }

        // Move from reserved to collected
        await conn.query(`
            UPDATE food_items 
            SET reserved_quantity = ?, collected_quantity = ?, status = ? 
            WHERE id = ?
        `, [newReserved, newCollected, newFoodStatus, reqData.food_id]);

        // Complete the request
        await conn.query(`
            UPDATE food_requests 
            SET status = 'COMPLETED', beneficiary_count = ?, completed_at = NOW(), completed_by = ? 
            WHERE id = ?
        `, [parsedBeneficiaries, req.user.id, requestId]);

        await conn.commit();

        return res.json({
            success: true,
            message: `Collection confirmed successfully for ${requested} units with ${parsedBeneficiaries} beneficiaries helped.`
        });
    } catch (err) {
        await conn.rollback();
        console.error("Complete request error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error confirming collection" });
    } finally {
        conn.release();
    }
});

// =====================================================================
// PHASE 5: ADMIN MANAGEMENT APIs
// =====================================================================

// ---------------------------------------------------------------------
// A. GET /api/admin/users - List All Users (Admin Only)
// ---------------------------------------------------------------------
app.get("/api/admin/users", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
    try {
        const { search, role, status, page, limit } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let where = "WHERE 1=1";
        const params = [];

        if (search && typeof search === "string" && search.trim()) {
            where += " AND (name LIKE ? OR email LIKE ?)";
            params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }
        if (role && ["ADMIN", "DONOR", "RECEIVER"].includes(role.toUpperCase())) {
            where += " AND role = ?";
            params.push(role.toUpperCase());
        }
        if (status && ["ACTIVE", "INACTIVE"].includes(status.toUpperCase())) {
            where += " AND status = ?";
            params.push(status.toUpperCase());
        }

        const countParams = [...params];
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM users ${where}`,
            countParams
        );
        const total = Number(countRows[0]?.total || 0);

        params.push(limitNum, offset);
        const [rows] = await pool.query(
            `SELECT id, name, email, phone, role, status, created_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            params
        );

        return res.json({
            success: true,
            users: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (err) {
        console.error("Admin get users error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching users" });
    }
});

// ---------------------------------------------------------------------
// B. PATCH /api/admin/users/:id/status - Activate/Deactivate User (Admin Only)
// ---------------------------------------------------------------------
app.patch("/api/admin/users/:id/status", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const { status } = req.body;
    if (!status || !["ACTIVE", "INACTIVE"].includes(status.toUpperCase())) {
        return res.status(400).json({ success: false, message: "Status must be ACTIVE or INACTIVE" });
    }
    const newStatus = status.toUpperCase();

    // Prevent admin from changing their own status
    if (userId === req.user.id) {
        return res.status(400).json({ success: false, message: "Administrators cannot change their own account status" });
    }

    try {
        const [rows] = await pool.query("SELECT id, name, email, role, status FROM users WHERE id = ?", [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const target = rows[0];

        // Prevent modifying other ADMIN accounts
        if (target.role === "ADMIN") {
            return res.status(403).json({ success: false, message: "Cannot modify the status of another administrator account" });
        }

        await pool.query("UPDATE users SET status = ? WHERE id = ?", [newStatus, userId]);

        return res.json({
            success: true,
            message: `User ${target.name} status updated to ${newStatus}`,
            user: { id: target.id, name: target.name, email: target.email, role: target.role, status: newStatus }
        });
    } catch (err) {
        console.error("Admin update user status error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error updating user status" });
    }
});

// ---------------------------------------------------------------------
// C. GET /api/admin/food - List All Food Items (Admin Only)
// ---------------------------------------------------------------------
app.get("/api/admin/food", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
    try {
        const { search, category, status, page, limit } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let where = "WHERE 1=1";
        const params = [];

        if (search && typeof search === "string" && search.trim()) {
            where += " AND (f.food_name LIKE ? OR u.name LIKE ?)";
            params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }
        if (category && typeof category === "string" && category.trim()) {
            where += " AND f.category = ?";
            params.push(category.trim());
        }
        if (status && typeof status === "string" && status.trim()) {
            where += " AND f.status = ?";
            params.push(status.trim().toUpperCase());
        }

        const countParams = [...params];
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM food_items f JOIN users u ON f.donor_id = u.id ${where}`,
            countParams
        );
        const total = Number(countRows[0]?.total || 0);

        params.push(limitNum, offset);
        const [rows] = await pool.query(`
            SELECT f.id, f.food_name, f.category, f.total_quantity, f.available_quantity,
                   f.reserved_quantity, f.collected_quantity, f.wasted_quantity, f.unit,
                   f.status, f.expiry_at, f.created_at,
                   u.id as donor_id, u.name as donor_name, u.email as donor_email
            FROM food_items f
            JOIN users u ON f.donor_id = u.id
            ${where}
            ORDER BY f.created_at DESC LIMIT ? OFFSET ?
        `, params);

        return res.json({
            success: true,
            food: rows,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
        });
    } catch (err) {
        console.error("Admin get food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching food listings" });
    }
});

// ---------------------------------------------------------------------
// D. DELETE /api/admin/food/:id - Remove Food Listing (Admin Only)
// ---------------------------------------------------------------------
app.delete("/api/admin/food/:id", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
    const foodId = parseInt(req.params.id, 10);
    if (isNaN(foodId)) {
        return res.status(400).json({ success: false, message: "Invalid food ID" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query("SELECT * FROM food_items WHERE id = ? FOR UPDATE", [foodId]);
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: "Food listing not found" });
        }

        const item = rows[0];

        // Reject all PENDING requests with admin reason
        await conn.query(`
            UPDATE food_requests
            SET status = 'REJECTED', rejection_reason = 'Listing removed by administrator'
            WHERE food_id = ? AND status = 'PENDING'
        `, [foodId]);

        // For ACCEPTED requests: release reserved quantity back to cancelled_quantity
        const [acceptedReqs] = await conn.query(
            "SELECT SUM(requested_quantity) as total FROM food_requests WHERE food_id = ? AND status = 'ACCEPTED'",
            [foodId]
        );
        const acceptedQty = parseFloat(acceptedReqs[0]?.total || 0);

        if (acceptedQty > 0) {
            await conn.query(`
                UPDATE food_requests
                SET status = 'CANCELLED', rejection_reason = 'Listing removed by administrator'
                WHERE food_id = ? AND status = 'ACCEPTED'
            `, [foodId]);
        }

        // Cancel the food listing: remaining available + reserved go to cancelled
        const avail = parseFloat(item.available_quantity);
        const reserved = parseFloat(item.reserved_quantity);
        await conn.query(`
            UPDATE food_items
            SET available_quantity = 0.00, reserved_quantity = 0.00,
                cancelled_quantity = cancelled_quantity + ? + ?, status = 'CANCELLED'
            WHERE id = ?
        `, [avail, reserved, foodId]);

        await conn.commit();

        return res.json({
            success: true,
            message: `Food listing "${item.food_name}" removed by administrator. Pending requests rejected, accepted requests cancelled.`
        });
    } catch (err) {
        await conn.rollback();
        console.error("Admin delete food error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error removing food listing" });
    } finally {
        conn.release();
    }
});

// ---------------------------------------------------------------------
// E. GET /api/admin/requests - Monitor All Requests (Admin Only, Read-only)
// ---------------------------------------------------------------------
app.get("/api/admin/requests", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
    try {
        const { search, status, page, limit } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let where = "WHERE 1=1";
        const params = [];

        if (search && typeof search === "string" && search.trim()) {
            where += " AND (fi.food_name LIKE ? OR ru.name LIKE ? OR du.name LIKE ?)";
            const s = `%${search.trim()}%`;
            params.push(s, s, s);
        }
        if (status && typeof status === "string" && status.trim()) {
            where += " AND r.status = ?";
            params.push(status.trim().toUpperCase());
        }

        const countParams = [...params];
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM food_requests r
             JOIN food_items fi ON r.food_id = fi.id
             JOIN users ru ON r.receiver_id = ru.id
             JOIN users du ON fi.donor_id = du.id
             ${where}`,
            countParams
        );
        const total = Number(countRows[0]?.total || 0);

        params.push(limitNum, offset);
        const [rows] = await pool.query(`
            SELECT r.id, r.requested_quantity, r.beneficiary_count, r.status,
                   r.pickup_time, r.completed_at, r.rejection_reason, r.created_at,
                   fi.id as food_id, fi.food_name, fi.category, fi.unit,
                   ru.id as receiver_id, ru.name as receiver_name, ru.email as receiver_email,
                   du.id as donor_id, du.name as donor_name, du.email as donor_email
            FROM food_requests r
            JOIN food_items fi ON r.food_id = fi.id
            JOIN users ru ON r.receiver_id = ru.id
            JOIN users du ON fi.donor_id = du.id
            ${where}
            ORDER BY r.created_at DESC LIMIT ? OFFSET ?
        `, params);

        return res.json({
            success: true,
            requests: rows,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
        });
    } catch (err) {
        console.error("Admin get requests error:", err.message);
        return res.status(500).json({ success: false, message: "Internal server error fetching requests" });
    }
});

// =====================================================================
// Centralized Error Handling Middleware
// =====================================================================
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err.message);
    res.status(500).json({
        success: false,
        message: "An unexpected error occurred"
    });
});

// =====================================================================
// Start Express Server
// =====================================================================
const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`FoodBridge server running on port ${PORT}`);
        await initializeDatabase();
    });
}

module.exports = { app, pool, authenticateToken, authorizeRole, initializeDatabase };
