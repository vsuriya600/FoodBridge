-- =====================================================================
-- FoodBridge - Smart Food Waste Reduction and Redistribution Platform
-- Database Schema for Clever Cloud MySQL
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table 1: users
-- Stores registered users (Donors, Receivers, and System Administrators)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(50) DEFAULT NULL,
    role ENUM('ADMIN', 'DONOR', 'RECEIVER') NOT NULL DEFAULT 'RECEIVER',
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_role (role),
    INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Table 2: food_items
-- Stores surplus food listings created by donors
-- Quantity invariant: total_quantity = available_quantity + reserved_quantity + collected_quantity + wasted_quantity + cancelled_quantity
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    donor_id INT NOT NULL,
    food_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT DEFAULT NULL,
    total_quantity DECIMAL(10, 2) NOT NULL,
    available_quantity DECIMAL(10, 2) NOT NULL,
    reserved_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    collected_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    wasted_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    cancelled_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    unit VARCHAR(50) NOT NULL,
    image_url VARCHAR(500) DEFAULT NULL,
    prepared_at DATETIME DEFAULT NULL,
    expiry_at DATETIME NOT NULL,
    pickup_address TEXT NOT NULL,
    status ENUM('AVAILABLE', 'FULLY_RESERVED', 'COMPLETED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'AVAILABLE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    waste_reported_at DATETIME DEFAULT NULL,
    CONSTRAINT fk_food_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_total_qty_positive CHECK (total_quantity >= 0),
    CONSTRAINT chk_avail_qty_non_negative CHECK (available_quantity >= 0),
    CONSTRAINT chk_res_qty_non_negative CHECK (reserved_quantity >= 0),
    CONSTRAINT chk_col_qty_non_negative CHECK (collected_quantity >= 0),
    CONSTRAINT chk_wast_qty_non_negative CHECK (wasted_quantity >= 0),
    CONSTRAINT chk_canc_qty_non_negative CHECK (cancelled_quantity >= 0),
    INDEX idx_food_donor (donor_id),
    INDEX idx_food_status (status),
    INDEX idx_food_expiry (expiry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Table 3: food_requests
-- Stores requests made by receivers for food items
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    food_id INT NOT NULL,
    receiver_id INT NOT NULL,
    requested_quantity DECIMAL(10, 2) NOT NULL,
    beneficiary_count INT DEFAULT NULL,
    rejection_reason TEXT DEFAULT NULL,
    status ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    pickup_time DATETIME DEFAULT NULL,
    completed_at DATETIME DEFAULT NULL,
    completed_by INT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_request_food FOREIGN KEY (food_id) REFERENCES food_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_request_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_request_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_requested_qty_positive CHECK (requested_quantity > 0),
    INDEX idx_requests_food (food_id),
    INDEX idx_requests_receiver (receiver_id),
    INDEX idx_requests_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
