/**
 * FoodBridge - Frontend Application Controller
 * Phase 3 & Phase 4: Food Donation and Request Management
 */

// Application State
const state = {
    token: null,
    user: null,
    currentSection: null,
    activeCharts: {},
    currentBrowseItems: [],
    currentDonorItems: []
};

// =====================================================================
// 1. Application Initialization & Auth Check
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
    initializeApp();
});

function initializeApp() {
    setupEventHandlers();
    checkAuthentication();
}

async function checkAuthentication() {
    const savedToken = localStorage.getItem("foodbridge_token");
    if (!savedToken) {
        showAuthView("login");
        return;
    }

    state.token = savedToken;
    const user = await fetchCurrentUser();
    if (user) {
        state.user = user;
        showAppView();
    } else {
        logoutUser(false);
    }
}

async function fetchCurrentUser() {
    if (!state.token) return null;
    try {
        const response = await fetch("/api/me", {
            headers: {
                "Authorization": `Bearer ${state.token}`
            }
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.success ? data.user : null;
    } catch (err) {
        console.error("fetchCurrentUser error:", err);
        return null;
    }
}

// =====================================================================
// 2. Authentication Logic (Login, Register, Logout)
// =====================================================================
async function loginUser(email, password) {
    const btn = document.getElementById("btn-login");
    setButtonLoading(btn, true);
    clearAuthFieldErrors();

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            state.token = data.token;
            state.user = data.user;
            localStorage.setItem("foodbridge_token", data.token);
            showNotification("Login successful. Welcome back!", "success");
            showAppView();
        } else {
            const msg = data.message || "Invalid credentials";
            showNotification(msg, "error");
            document.getElementById("login-password-error").textContent = msg;
        }
    } catch (err) {
        showNotification("Network error. Please try again later.", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

async function registerUser(name, email, phone, role, password, confirmPassword) {
    const btn = document.getElementById("btn-register");
    clearAuthFieldErrors();

    // Client-side validations
    let hasError = false;
    if (!name || name.trim().length === 0) {
        document.getElementById("register-name-error").textContent = "Full name is required";
        hasError = true;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
        document.getElementById("register-email-error").textContent = "Please enter a valid email address";
        hasError = true;
    }

    if (!password || password.length < 6) {
        document.getElementById("register-password-error").textContent = "Password must be at least 6 characters";
        hasError = true;
    }

    if (password !== confirmPassword) {
        document.getElementById("register-confirm-password-error").textContent = "Passwords do not match";
        hasError = true;
    }

    if (hasError) return;

    setButtonLoading(btn, true);

    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: name.trim(),
                email: email.trim(),
                phone: phone ? phone.trim() : undefined,
                role: role === "DONOR" ? "DONOR" : "RECEIVER",
                password
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showNotification("Registration successful! You may now sign in.", "success");
            showAuthView("login");
            document.getElementById("login-email").value = email.trim();
            document.getElementById("login-password").focus();
        } else {
            const msg = data.message || "Registration failed";
            showNotification(msg, "error");
            if (response.status === 409) {
                document.getElementById("register-email-error").textContent = msg;
            }
        }
    } catch (err) {
        showNotification("Network error during registration.", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

function logoutUser(notify = true) {
    state.token = null;
    state.user = null;
    localStorage.removeItem("foodbridge_token");
    destroyAllCharts();

    if (notify) {
        showNotification("You have been signed out.", "info");
    }
    showAuthView("login");
}

// =====================================================================
// 3. UI State Switching (Auth vs App, Sections)
// =====================================================================
function showAuthView(view = "login") {
    document.getElementById("app-container").classList.add("hidden");
    document.getElementById("auth-container").classList.remove("hidden");

    if (view === "login") {
        document.getElementById("section-login").classList.remove("hidden");
        document.getElementById("section-register").classList.add("hidden");
    } else {
        document.getElementById("section-login").classList.add("hidden");
        document.getElementById("section-register").classList.remove("hidden");
    }
}

function showAppView() {
    document.getElementById("auth-container").classList.add("hidden");
    document.getElementById("app-container").classList.remove("hidden");

    renderUserInfo();
    renderNavigation();

    // Default to role dashboard
    const role = state.user?.role;
    if (role === "ADMIN") {
        showSection("admin-dashboard", "Admin Overview");
    } else if (role === "DONOR") {
        showSection("donor-dashboard", "Donor Overview");
    } else {
        showSection("receiver-dashboard", "Receiver Overview");
    }
}

function showSection(sectionId, sectionTitle = null) {
    // Hide all app sections
    const sections = document.querySelectorAll(".app-section");
    sections.forEach(s => s.classList.add("hidden"));

    const target = document.getElementById(`section-${sectionId}`);
    if (target) {
        target.classList.remove("hidden");
        state.currentSection = sectionId;
    }

    // Update topbar title
    const titleEl = document.getElementById("topbar-title");
    if (sectionTitle) {
        titleEl.textContent = sectionTitle;
    } else if (sectionId.includes("dashboard")) {
        titleEl.textContent = "Dashboard";
    } else if (sectionId === "profile") {
        titleEl.textContent = "Account Profile";
    }

    // Update active nav link
    document.querySelectorAll(".nav-link").forEach(link => {
        if (link.dataset.section === sectionId) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    closeMobileSidebar();

    // Trigger section-specific data loaders
    if (sectionId === "admin-dashboard" && state.user?.role === "ADMIN") {
        loadAdminDashboard();
    } else if (sectionId === "admin-users" && state.user?.role === "ADMIN") {
        loadAdminUsers(1);
    } else if (sectionId === "admin-food" && state.user?.role === "ADMIN") {
        loadAdminFood(1);
    } else if (sectionId === "admin-requests" && state.user?.role === "ADMIN") {
        loadAdminRequests(1);
    } else if (sectionId === "admin-analytics" && state.user?.role === "ADMIN") {
        loadAdminAnalytics();
    } else if (sectionId === "donor-dashboard" && state.user?.role === "DONOR") {
        loadDonorDashboard();
    } else if (sectionId === "donor-my-donations") {
        loadDonorDonations();
    } else if (sectionId === "donor-incoming-requests") {
        loadDonorIncomingRequests();
    } else if (sectionId === "donor-history") {
        loadDonorHistory();
    } else if (sectionId === "donor-analytics" && state.user?.role === "DONOR") {
        loadDonorAnalytics();
    } else if (sectionId === "receiver-dashboard" && state.user?.role === "RECEIVER") {
        loadReceiverDashboard();
    } else if (sectionId === "receiver-browse") {
        loadBrowseFood();
    } else if (sectionId === "receiver-my-requests") {
        loadReceiverRequests();
    } else if (sectionId === "receiver-history") {
        loadReceiverHistory();
    } else if (sectionId === "profile") {
        renderProfileSection();
    }
}

function showPlaceholderSection(title, description) {
    const sections = document.querySelectorAll(".app-section");
    sections.forEach(s => s.classList.add("hidden"));

    document.getElementById("placeholder-title").textContent = title;
    document.getElementById("placeholder-desc").textContent = description;
    document.getElementById("section-placeholder").classList.remove("hidden");
    document.getElementById("topbar-title").textContent = title;

    closeMobileSidebar();
}

// =====================================================================
// 4. Role-based Navigation
// =====================================================================
function renderNavigation() {
    const list = document.getElementById("nav-links-list");
    list.innerHTML = "";

    const role = state.user?.role || "RECEIVER";

    const navConfigs = {
        ADMIN: [
            { id: "admin-dashboard", label: "Dashboard", icon: getIconSvg("grid") },
            { id: "admin-users", label: "Users", icon: getIconSvg("users") },
            { id: "admin-food", label: "Food Listings", icon: getIconSvg("package") },
            { id: "admin-requests", label: "Requests", icon: getIconSvg("inbox") },
            { id: "admin-analytics", label: "Analytics", icon: getIconSvg("chart") },
            { id: "profile", label: "Profile", icon: getIconSvg("user") }
        ],
        DONOR: [
            { id: "donor-dashboard", label: "Dashboard", icon: getIconSvg("grid") },
            { id: "donor-my-donations", label: "My Donations", icon: getIconSvg("package") },
            { id: "donor-incoming-requests", label: "Incoming Requests", icon: getIconSvg("inbox") },
            { id: "donor-history", label: "Donation History", icon: getIconSvg("clock") },
            { id: "donor-analytics", label: "Analytics", icon: getIconSvg("chart") },
            { id: "profile", label: "Profile", icon: getIconSvg("user") }
        ],
        RECEIVER: [
            { id: "receiver-dashboard", label: "Dashboard", icon: getIconSvg("grid") },
            { id: "receiver-browse", label: "Browse Food", icon: getIconSvg("search") },
            { id: "receiver-my-requests", label: "My Requests", icon: getIconSvg("inbox") },
            { id: "receiver-history", label: "Collection History", icon: getIconSvg("clock") },
            { id: "profile", label: "Profile", icon: getIconSvg("user") }
        ]
    };

    const items = navConfigs[role] || navConfigs.RECEIVER;

    items.forEach(item => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#";
        a.className = "nav-link";
        a.dataset.section = item.id;
        a.innerHTML = `${item.icon}<span>${item.label}</span>`;

        a.addEventListener("click", (e) => {
            e.preventDefault();
            if (item.placeholder) {
                showPlaceholderSection(item.label, `${item.placeholder} is scheduled for implementation in upcoming phases.`);
            } else {
                showSection(item.id, item.label);
            }
        });

        li.appendChild(a);
        list.appendChild(li);
    });
}

function renderUserInfo() {
    if (!state.user) return;
    const name = state.user.name || "User";
    const email = state.user.email || "";
    const role = state.user.role || "RECEIVER";
    const initial = name.charAt(0).toUpperCase();

    document.getElementById("sidebar-role-label").textContent = `${role} PORTAL`;
    document.getElementById("sidebar-user-name").textContent = name;
    document.getElementById("sidebar-user-email").textContent = email;
    document.getElementById("sidebar-user-avatar").textContent = initial;
    document.getElementById("topbar-avatar-text").textContent = initial;
}

function renderProfileSection() {
    if (!state.user) return;
    document.getElementById("profile-name").textContent = state.user.name;
    document.getElementById("profile-role-badge").textContent = state.user.role;
    document.getElementById("profile-email").textContent = state.user.email;
    document.getElementById("profile-phone").textContent = state.user.phone || "Not provided";
    document.getElementById("profile-status").textContent = state.user.status;
    document.getElementById("profile-id").textContent = `#${state.user.id}`;
    document.getElementById("profile-avatar").textContent = state.user.name.charAt(0).toUpperCase();
}

// =====================================================================
// 5. Dashboards Data Loaders
// =====================================================================
async function loadAdminDashboard() {
    setDashboardLoading(true);
    try {
        const res = await fetch("/api/dashboard/admin", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) return logoutUser(false);
            throw new Error("Failed to load admin metrics");
        }
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        document.getElementById("admin-daily-donated").textContent = `${formatNum(data.dailyStats.foodDonatedToday)} kg`;
        document.getElementById("admin-daily-reused").textContent = `${formatNum(data.dailyStats.foodReusedToday)} kg`;
        document.getElementById("admin-daily-wasted").textContent = `${formatNum(data.dailyStats.foodWastedToday)} kg`;
        document.getElementById("admin-daily-people").textContent = `${formatNum(data.dailyStats.peopleHelpedToday)}`;

        // Render previous-day comparison badges
        const prev = data.previousDayStats || {};
        const compDonated = document.getElementById("admin-comp-donated");
        if (compDonated) compDonated.innerHTML = renderComparisonBadge(data.dailyStats.foodDonatedToday, prev.foodDonatedYday);
        const compReused = document.getElementById("admin-comp-reused");
        if (compReused) compReused.innerHTML = renderComparisonBadge(data.dailyStats.foodReusedToday, prev.foodReusedYday);
        const compWasted = document.getElementById("admin-comp-wasted");
        if (compWasted) compWasted.innerHTML = renderComparisonBadge(data.dailyStats.foodWastedToday, prev.foodWastedYday, true);
        const compPeople = document.getElementById("admin-comp-people");
        if (compPeople) compPeople.innerHTML = renderComparisonBadge(data.dailyStats.peopleHelpedToday, prev.peopleHelpedYday);

        document.getElementById("admin-metric-users").textContent = formatNum(data.metrics.totalUsers);
        document.getElementById("admin-metric-donors").textContent = formatNum(data.metrics.totalDonors);
        document.getElementById("admin-metric-receivers").textContent = formatNum(data.metrics.totalReceivers);
        document.getElementById("admin-metric-donations").textContent = formatNum(data.metrics.totalFoodDonations);
        document.getElementById("admin-metric-reused").textContent = `${formatNum(data.metrics.foodReused)} kg`;
        document.getElementById("admin-metric-wasted").textContent = `${formatNum(data.metrics.foodWasted)} kg`;
        document.getElementById("admin-metric-pending").textContent = formatNum(data.metrics.pendingRequests);
        document.getElementById("admin-metric-people").textContent = formatNum(data.metrics.peopleHelped);

        initializeCharts("admin", data.charts);
        renderActivityList("admin-activity-list", data.recentActivities);

    } catch (err) {
        showNotification(err.message, "error");
    } finally {
        setDashboardLoading(false);
    }
}

async function loadDonorDashboard() {
    setDashboardLoading(true);
    try {
        const res = await fetch("/api/dashboard/donor", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) return logoutUser(false);
            throw new Error("Failed to load donor metrics");
        }
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        document.getElementById("donor-daily-donated").textContent = `${formatNum(data.dailyStats.dailyDonation)} kg`;
        document.getElementById("donor-daily-reused").textContent = `${formatNum(data.dailyStats.dailyReused)} kg`;
        document.getElementById("donor-daily-wasted").textContent = `${formatNum(data.dailyStats.dailyWasted)} kg`;
        document.getElementById("donor-daily-people").textContent = `${formatNum(data.dailyStats.peopleHelpedToday)}`;

        // Render previous-day comparison badges
        const dPrev = data.previousDayStats || {};
        const dCompDonated = document.getElementById("donor-comp-donated");
        if (dCompDonated) dCompDonated.innerHTML = renderComparisonBadge(data.dailyStats.dailyDonation, dPrev.dailyDonationYday);
        const dCompReused = document.getElementById("donor-comp-reused");
        if (dCompReused) dCompReused.innerHTML = renderComparisonBadge(data.dailyStats.dailyReused, dPrev.dailyReusedYday);
        const dCompWasted = document.getElementById("donor-comp-wasted");
        if (dCompWasted) dCompWasted.innerHTML = renderComparisonBadge(data.dailyStats.dailyWasted, 0, true);
        const dCompPeople = document.getElementById("donor-comp-people");
        if (dCompPeople) dCompPeople.innerHTML = renderComparisonBadge(data.dailyStats.peopleHelpedToday, 0);

        document.getElementById("donor-metric-donated").textContent = `${formatNum(data.metrics.totalDonated)} kg`;
        document.getElementById("donor-metric-reused").textContent = `${formatNum(data.metrics.foodReused)} kg`;
        document.getElementById("donor-metric-wasted").textContent = `${formatNum(data.metrics.foodWasted)} kg`;
        document.getElementById("donor-metric-pending").textContent = formatNum(data.metrics.pendingRequests);
        document.getElementById("donor-metric-completed").textContent = formatNum(data.metrics.completedCollections);
        document.getElementById("donor-metric-people").textContent = formatNum(data.metrics.peopleHelped);

        initializeCharts("donor", data.charts);
        renderDonorActivityList("donor-activity-list", data.recentActivities);

    } catch (err) {
        showNotification(err.message, "error");
    } finally {
        setDashboardLoading(false);
    }
}

async function loadReceiverDashboard() {
    setDashboardLoading(true);
    try {
        const res = await fetch("/api/dashboard/receiver", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) return logoutUser(false);
            throw new Error("Failed to load receiver metrics");
        }
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        document.getElementById("receiver-daily-collected").textContent = `${formatNum(data.dailyStats.collectedToday)} kg`;

        // Render previous-day comparison badge
        const rPrev = data.previousDayStats || {};
        const rCompColl = document.getElementById("receiver-comp-collected");
        if (rCompColl) rCompColl.innerHTML = renderComparisonBadge(data.dailyStats.collectedToday, rPrev.collectedYday);

        document.getElementById("receiver-metric-available").textContent = formatNum(data.metrics.availableFoodListings);
        document.getElementById("receiver-metric-pending").textContent = formatNum(data.metrics.pendingRequests);
        document.getElementById("receiver-metric-approved").textContent = formatNum(data.metrics.approvedRequests);
        document.getElementById("receiver-metric-completed").textContent = formatNum(data.metrics.completedCollections);
        document.getElementById("receiver-metric-collected-qty").textContent = `${formatNum(data.metrics.totalCollectedQuantity)} kg`;

        initializeCharts("receiver", data.charts);
        renderReceiverActivityList("receiver-activity-list", data.recentActivities);

    } catch (err) {
        showNotification(err.message, "error");
    } finally {
        setDashboardLoading(false);
    }
}

// =====================================================================
// 6. PHASE 4: DONOR FOOD DONATIONS CONTROLLER
// =====================================================================
async function loadDonorDonations() {
    const container = document.getElementById("donor-donations-list");
    if (!container) return;
    container.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Loading your listings...</p></div>';

    const statusFilter = document.getElementById("donor-status-filter")?.value || "";
    let url = "/api/my-food";
    if (statusFilter) url += `?status=${encodeURIComponent(statusFilter)}`;

    try {
        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load donations");

        state.currentDonorItems = data.food || [];

        if (state.currentDonorItems.length === 0) {
            container.innerHTML = `
                <div class="card placeholder-card">
                    <h3>No food listings found</h3>
                    <p class="text-muted">You haven't published any food donation listings matching this filter yet.</p>
                    <button class="btn btn-primary" onclick="showSection('donor-create-food', 'Publish Food Donation')">Donate Food Now</button>
                </div>
            `;
            return;
        }

        container.innerHTML = state.currentDonorItems.map(item => `
            <div class="donation-card" data-id="${item.id}">
                <div class="donation-card-header">
                    <div class="donation-title-wrap">
                        <h3>${escapeHtml(item.food_name)}</h3>
                        <div class="donation-submeta">
                            <span>Category: <strong>${escapeHtml(item.category)}</strong></span> •
                            <span>Expires: <strong>${new Date(item.expiry_at).toLocaleString()}</strong></span> •
                            <span>Pickup: ${escapeHtml(item.pickup_address)}</span>
                        </div>
                    </div>
                    <span class="status-badge ${getStatusBadgeClass(item.status)}">${item.status}</span>
                </div>

                <!-- Quantity Breakdown Row -->
                <div class="qty-breakdown-row">
                    <div class="qty-stat">
                        <span class="qty-stat-label">Total</span>
                        <span class="qty-stat-val">${item.total_quantity} ${item.unit}</span>
                    </div>
                    <div class="qty-stat">
                        <span class="qty-stat-label">Available</span>
                        <span class="qty-stat-val text-success">${item.available_quantity} ${item.unit}</span>
                    </div>
                    <div class="qty-stat">
                        <span class="qty-stat-label">Reserved</span>
                        <span class="qty-stat-val" style="color: #3b82f6;">${item.reserved_quantity} ${item.unit}</span>
                    </div>
                    <div class="qty-stat">
                        <span class="qty-stat-label">Collected</span>
                        <span class="qty-stat-val" style="color: #10b981;">${item.collected_quantity} ${item.unit}</span>
                    </div>
                    <div class="qty-stat">
                        <span class="qty-stat-label">Wasted</span>
                        <span class="qty-stat-val" style="color: #ef4444;">${item.wasted_quantity} ${item.unit}</span>
                    </div>
                    <div class="qty-stat">
                        <span class="qty-stat-label">Cancelled</span>
                        <span class="qty-stat-val text-muted">${item.cancelled_quantity} ${item.unit}</span>
                    </div>
                </div>

                <!-- Card Actions -->
                <div class="donation-card-actions">
                    ${item.status !== "CANCELLED" && item.status !== "COMPLETED" ? `
                        <button class="btn btn-outline btn-sm" onclick="openEditModal(${item.id})">Edit Listing</button>
                    ` : ""}

                    ${parseFloat(item.available_quantity) > 0 && item.status !== "CANCELLED" ? `
                        <button class="btn btn-outline-danger btn-sm" onclick="openWasteModal(${item.id})">Report Waste</button>
                    ` : ""}

                    ${item.status !== "CANCELLED" && item.status !== "COMPLETED" ? `
                        <button class="btn btn-outline-danger btn-sm" onclick="cancelFoodListing(${item.id})">Cancel Listing</button>
                    ` : ""}
                </div>
            </div>
        `).join("");

    } catch (err) {
        container.innerHTML = `<p class="text-center text-muted py-4">${escapeHtml(err.message)}</p>`;
    }
}

async function handleCreateFoodSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-create-food");
    setButtonLoading(btn, true);

    const payload = {
        food_name: document.getElementById("create-food-name").value,
        category: document.getElementById("create-category").value,
        total_quantity: document.getElementById("create-quantity").value,
        unit: document.getElementById("create-unit").value,
        prepared_at: document.getElementById("create-prepared-at").value || undefined,
        expiry_at: document.getElementById("create-expiry-at").value,
        pickup_address: document.getElementById("create-pickup-address").value,
        image_url: document.getElementById("create-image-url").value || undefined,
        description: document.getElementById("create-description").value || undefined
    };

    try {
        const res = await fetch("/api/food", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showNotification("Food donation published successfully!", "success");
            document.getElementById("form-create-food").reset();
            showSection("donor-my-donations", "My Food Donations");
        } else {
            showNotification(data.message || "Failed to create listing", "error");
        }
    } catch (err) {
        showNotification("Network error submitting food listing", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

async function cancelFoodListing(foodId) {
    if (!confirm("Are you sure you want to cancel this food listing? Any remaining available food will be cancelled.")) {
        return;
    }

    try {
        const res = await fetch(`/api/food/${foodId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            loadDonorDonations();
        } else {
            showNotification(data.message || "Failed to cancel listing", "error");
        }
    } catch (err) {
        showNotification("Network error cancelling food listing", "error");
    }
}

// Waste Reporting
function openWasteModal(foodId) {
    const item = state.currentDonorItems.find(i => i.id === foodId);
    if (!item) return;

    document.getElementById("modal-waste-food-id").value = item.id;
    document.getElementById("modal-waste-food-name").textContent = item.food_name;
    document.getElementById("modal-waste-avail-qty").textContent = item.available_quantity;
    document.getElementById("modal-waste-unit").textContent = item.unit;

    const qtyInput = document.getElementById("modal-waste-quantity");
    qtyInput.max = item.available_quantity;
    qtyInput.value = item.available_quantity;
    document.getElementById("modal-waste-error").textContent = "";

    openModal("modal-report-waste");
}

async function handleReportWasteSubmit(e) {
    e.preventDefault();
    const foodId = document.getElementById("modal-waste-food-id").value;
    const quantity = document.getElementById("modal-waste-quantity").value;

    try {
        const res = await fetch(`/api/food/${foodId}/waste`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ quantity })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            closeModal("modal-report-waste");
            loadDonorDonations();
        } else {
            document.getElementById("modal-waste-error").textContent = data.message || "Waste report failed";
        }
    } catch (err) {
        showNotification("Network error reporting waste", "error");
    }
}

// Edit Food
function openEditModal(foodId) {
    const item = state.currentDonorItems.find(i => i.id === foodId);
    if (!item) return;

    document.getElementById("edit-food-id").value = item.id;
    document.getElementById("edit-food-name").value = item.food_name;
    document.getElementById("edit-food-category").value = item.category;
    document.getElementById("edit-total-qty").value = item.total_quantity;
    document.getElementById("edit-unit").value = item.unit;
    document.getElementById("edit-pickup-address").value = item.pickup_address;
    document.getElementById("edit-image-url").value = item.image_url || "";
    document.getElementById("edit-description").value = item.description || "";

    const committed = parseFloat(item.reserved_quantity) +
                      parseFloat(item.collected_quantity) +
                      parseFloat(item.wasted_quantity) +
                      parseFloat(item.cancelled_quantity);
    document.getElementById("edit-qty-hint").textContent = `Minimum total: ${committed} ${item.unit} (already committed).`;

    openModal("modal-edit-food");
}

async function handleEditFoodSubmit(e) {
    e.preventDefault();
    const foodId = document.getElementById("edit-food-id").value;

    const payload = {
        food_name: document.getElementById("edit-food-name").value,
        category: document.getElementById("edit-food-category").value,
        total_quantity: document.getElementById("edit-total-qty").value,
        unit: document.getElementById("edit-unit").value,
        pickup_address: document.getElementById("edit-pickup-address").value,
        image_url: document.getElementById("edit-image-url").value || undefined,
        description: document.getElementById("edit-description").value || undefined
    };

    try {
        const res = await fetch(`/api/food/${foodId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification("Food listing updated successfully!", "success");
            closeModal("modal-edit-food");
            loadDonorDonations();
        } else {
            showNotification(data.message || "Update failed", "error");
        }
    } catch (err) {
        showNotification("Network error updating food listing", "error");
    }
}

// =====================================================================
// 7. PHASE 4: DONOR INCOMING REQUESTS CONTROLLER
// =====================================================================
async function loadDonorIncomingRequests() {
    const container = document.getElementById("donor-requests-list");
    if (!container) return;
    container.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Loading incoming requests...</p></div>';

    try {
        const res = await fetch("/api/received-requests", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load requests");

        const requests = (data.requests || []).filter(r => r.status === "PENDING" || r.status === "ACCEPTED");

        if (requests.length === 0) {
            container.innerHTML = `
                <div class="card placeholder-card">
                    <h3>No Active Requests</h3>
                    <p class="text-muted">You currently have no pending or accepted requests requiring your action.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = requests.map(req => `
            <div class="request-card" data-id="${req.id}">
                <div class="request-header">
                    <div>
                        <h4>Request for ${escapeHtml(req.food_name)}</h4>
                        <span class="text-muted text-sm">Requested on ${new Date(req.created_at).toLocaleString()}</span>
                    </div>
                    <span class="status-badge ${getStatusBadgeClass(req.status)}">${req.status}</span>
                </div>

                <div class="request-meta-grid">
                    <div><strong>Receiver:</strong> ${escapeHtml(req.receiver_name)}</div>
                    <div><strong>Contact:</strong> ${escapeHtml(req.receiver_phone || req.receiver_email)}</div>
                    <div><strong>Requested:</strong> <span class="text-success font-semibold">${req.requested_quantity} ${req.unit}</span></div>
                    <div><strong>Pickup Time:</strong> ${req.pickup_time ? new Date(req.pickup_time).toLocaleString() : "Flexible / Coordinate"}</div>
                </div>

                <div class="request-actions">
                    ${req.status === "PENDING" ? `
                        <button class="btn btn-outline-danger btn-sm" onclick="openRejectModal(${req.id})">Reject Request</button>
                        <button class="btn btn-primary btn-sm" onclick="acceptFoodRequest(${req.id})">Accept & Reserve</button>
                    ` : ""}

                    ${req.status === "ACCEPTED" ? `
                        <button class="btn btn-outline-danger btn-sm" onclick="cancelAcceptedRequest(${req.id})">Cancel Reservation</button>
                        <button class="btn btn-success btn-sm" onclick="openCompleteModal(${req.id})">Confirm Collection</button>
                    ` : ""}
                </div>
            </div>
        `).join("");

    } catch (err) {
        container.innerHTML = `<p class="text-center text-muted py-4">${escapeHtml(err.message)}</p>`;
    }
}

async function loadDonorHistory() {
    const container = document.getElementById("donor-history-list");
    if (!container) return;
    container.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Loading donation history...</p></div>';

    try {
        const res = await fetch("/api/received-requests", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        const completed = (data.requests || []).filter(r => r.status === "COMPLETED");

        if (completed.length === 0) {
            container.innerHTML = '<p class="text-center text-muted py-4">No completed collections recorded yet.</p>';
            return;
        }

        container.innerHTML = completed.map(req => `
            <div class="request-card">
                <div class="request-header">
                    <div>
                        <h4>${escapeHtml(req.food_name)}</h4>
                        <span class="text-muted text-sm">Completed on ${new Date(req.completed_at).toLocaleString()}</span>
                    </div>
                    <span class="status-badge status-completed">COMPLETED</span>
                </div>
                <div class="request-meta-grid">
                    <div><strong>Receiver:</strong> ${escapeHtml(req.receiver_name)}</div>
                    <div><strong>Quantity Collected:</strong> ${req.requested_quantity} ${req.unit}</div>
                    <div><strong>Beneficiaries Helped:</strong> ${req.beneficiary_count} people</div>
                </div>
            </div>
        `).join("");
    } catch (err) {
        container.innerHTML = `<p class="text-center text-muted py-4">${escapeHtml(err.message)}</p>`;
    }
}

async function acceptFoodRequest(reqId) {
    try {
        const res = await fetch(`/api/requests/${reqId}/accept`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            loadDonorIncomingRequests();
        } else {
            showNotification(data.message || "Failed to accept request", "error");
        }
    } catch (err) {
        showNotification("Network error accepting request", "error");
    }
}

function openRejectModal(reqId) {
    document.getElementById("modal-reject-req-id").value = reqId;
    document.getElementById("modal-reject-reason").value = "";
    openModal("modal-reject-request");
}

async function handleRejectRequestSubmit(e) {
    e.preventDefault();
    const reqId = document.getElementById("modal-reject-req-id").value;
    const reason = document.getElementById("modal-reject-reason").value;

    try {
        const res = await fetch(`/api/requests/${reqId}/reject`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ rejection_reason: reason })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification("Request rejected", "info");
            closeModal("modal-reject-request");
            loadDonorIncomingRequests();
        } else {
            showNotification(data.message || "Rejection failed", "error");
        }
    } catch (err) {
        showNotification("Network error rejecting request", "error");
    }
}

function openCompleteModal(reqId) {
    document.getElementById("modal-complete-req-id").value = reqId;
    document.getElementById("modal-complete-beneficiaries").value = "1";
    document.getElementById("modal-complete-error").textContent = "";
    openModal("modal-complete-request");
}

async function handleCompleteRequestSubmit(e) {
    e.preventDefault();
    const reqId = document.getElementById("modal-complete-req-id").value;
    const beneficiaries = document.getElementById("modal-complete-beneficiaries").value;

    try {
        const res = await fetch(`/api/requests/${reqId}/complete`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ beneficiary_count: beneficiaries })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            closeModal("modal-complete-request");
            loadDonorIncomingRequests();
        } else {
            document.getElementById("modal-complete-error").textContent = data.message || "Completion failed";
        }
    } catch (err) {
        showNotification("Network error completing collection", "error");
    }
}

async function cancelAcceptedRequest(reqId) {
    if (!confirm("Are you sure you want to cancel this reservation? The quantity will be safely released.")) {
        return;
    }
    try {
        const res = await fetch(`/api/requests/${reqId}/cancel`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            loadDonorIncomingRequests();
        } else {
            showNotification(data.message || "Cancellation failed", "error");
        }
    } catch (err) {
        showNotification("Network error cancelling request", "error");
    }
}

// =====================================================================
// 8. PHASE 4: RECEIVER BROWSE & REQUESTS CONTROLLER
// =====================================================================
async function loadBrowseFood() {
    const container = document.getElementById("browse-food-list");
    if (!container) return;
    container.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Searching available surplus food...</p></div>';

    const search = document.getElementById("browse-search")?.value || "";
    const category = document.getElementById("browse-category")?.value || "";
    const sort = document.getElementById("browse-sort")?.value || "newest";

    const params = new URLSearchParams();
    if (search.trim()) params.append("search", search.trim());
    if (category.trim()) params.append("category", category.trim());
    if (sort) params.append("sort", sort);

    try {
        const res = await fetch(`/api/food?${params.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load available food");

        state.currentBrowseItems = data.food || [];

        if (state.currentBrowseItems.length === 0) {
            container.innerHTML = `
                <div class="card placeholder-card" style="grid-column: 1 / -1;">
                    <h3>No Available Food Found</h3>
                    <p class="text-muted">No surplus food listings match your current filters. Check back soon!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = state.currentBrowseItems.map(item => `
            <div class="food-card">
                <div class="food-card-img-wrap">
                    ${item.image_url ? `
                        <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.food_name)}" class="food-card-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'food-card-img-placeholder\\'>${getIconSvg('package')}<span>No Image</span></div>'">
                    ` : `
                        <div class="food-card-img-placeholder">
                            ${getIconSvg("package")}
                            <span>Fresh Surplus</span>
                        </div>
                    `}
                    <span class="food-card-category-badge">${escapeHtml(item.category)}</span>
                </div>

                <div class="food-card-body">
                    <h3 class="food-card-title">${escapeHtml(item.food_name)}</h3>
                    <p class="food-card-desc">${escapeHtml(item.description || "No specific handling instructions provided.")}</p>

                    <div class="food-card-meta">
                        <div class="meta-row">
                            <span>Available:</span>
                            <span class="meta-val-highlight">${item.available_quantity} ${item.unit}</span>
                        </div>
                        <div class="meta-row">
                            <span>Expires:</span>
                            <span class="expiry-tag">${new Date(item.expiry_at).toLocaleDateString()}</span>
                        </div>
                        <div class="meta-row text-muted text-sm">
                            <span>Pickup:</span>
                            <span style="max-width: 170px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(item.pickup_address)}</span>
                        </div>
                    </div>
                </div>

                <div class="food-card-footer">
                    <button class="btn btn-primary btn-block" onclick="openRequestModal(${item.id})">Request Food</button>
                </div>
            </div>
        `).join("");

    } catch (err) {
        container.innerHTML = `<p class="text-center text-muted py-4">${escapeHtml(err.message)}</p>`;
    }
}

function openRequestModal(foodId) {
    const item = state.currentBrowseItems.find(i => i.id === foodId);
    if (!item) return;

    document.getElementById("modal-req-food-id").value = item.id;
    document.getElementById("modal-req-food-name").textContent = item.food_name;
    document.getElementById("modal-req-avail-qty").textContent = item.available_quantity;
    document.getElementById("modal-req-unit").textContent = item.unit;
    document.getElementById("modal-req-expiry").textContent = new Date(item.expiry_at).toLocaleString();

    const qtyInput = document.getElementById("modal-req-quantity");
    qtyInput.max = item.available_quantity;
    qtyInput.value = item.available_quantity;
    document.getElementById("modal-req-qty-error").textContent = "";

    openModal("modal-request-food");
}

async function handleRequestFoodSubmit(e) {
    e.preventDefault();
    const foodId = document.getElementById("modal-req-food-id").value;
    const requestedQuantity = document.getElementById("modal-req-quantity").value;
    const pickupTime = document.getElementById("modal-req-pickup-time").value || undefined;

    try {
        const res = await fetch("/api/requests", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({
                food_id: foodId,
                requested_quantity: requestedQuantity,
                pickup_time: pickupTime
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showNotification("Request submitted with PENDING status!", "success");
            closeModal("modal-request-food");
            showSection("receiver-my-requests", "My Food Requests");
        } else {
            document.getElementById("modal-req-qty-error").textContent = data.message || "Request submission failed";
        }
    } catch (err) {
        showNotification("Network error submitting request", "error");
    }
}

async function loadReceiverRequests() {
    const container = document.getElementById("receiver-requests-list");
    if (!container) return;
    container.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Loading your requests...</p></div>';

    try {
        const res = await fetch("/api/my-requests", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load requests");

        const requests = (data.requests || []).filter(r => r.status !== "COMPLETED");

        if (requests.length === 0) {
            container.innerHTML = `
                <div class="card placeholder-card">
                    <h3>No Active Requests</h3>
                    <p class="text-muted">You haven't placed any pending or approved food requests.</p>
                    <button class="btn btn-primary" onclick="showSection('receiver-browse', 'Browse Surplus Food')">Browse Food</button>
                </div>
            `;
            return;
        }

        container.innerHTML = requests.map(req => `
            <div class="request-card">
                <div class="request-header">
                    <div>
                        <h4>${escapeHtml(req.food_name)}</h4>
                        <span class="text-muted text-sm">Requested on ${new Date(req.created_at).toLocaleString()}</span>
                    </div>
                    <span class="status-badge ${getStatusBadgeClass(req.status)}">${req.status}</span>
                </div>

                <div class="request-meta-grid">
                    <div><strong>Requested Qty:</strong> <span class="text-success font-semibold">${req.requested_quantity} ${req.unit}</span></div>
                    <div><strong>Donor Contact:</strong> ${escapeHtml(req.donor_phone || req.donor_name)}</div>
                    <div><strong>Pickup Address:</strong> ${escapeHtml(req.pickup_address)}</div>
                    ${req.rejection_reason ? `<div><strong>Rejection Reason:</strong> <span class="text-danger">${escapeHtml(req.rejection_reason)}</span></div>` : ""}
                </div>

                ${req.status === "PENDING" ? `
                    <div class="request-actions">
                        <button class="btn btn-outline-danger btn-sm" onclick="cancelReceiverRequest(${req.id})">Cancel Request</button>
                    </div>
                ` : ""}

                ${req.status === "ACCEPTED" ? `
                    <div class="request-actions">
                        <span class="badge status-available" style="font-size: 0.85rem;">Approved! Coordinate collection with donor</span>
                    </div>
                ` : ""}
            </div>
        `).join("");

    } catch (err) {
        container.innerHTML = `<p class="text-center text-muted py-4">${escapeHtml(err.message)}</p>`;
    }
}

async function loadReceiverHistory() {
    const container = document.getElementById("receiver-history-list");
    if (!container) return;
    container.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Loading collection history...</p></div>';

    try {
        const res = await fetch("/api/my-requests", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        const completed = (data.requests || []).filter(r => r.status === "COMPLETED");

        if (completed.length === 0) {
            container.innerHTML = '<p class="text-center text-muted py-4">No completed food collections recorded yet.</p>';
            return;
        }

        container.innerHTML = completed.map(req => `
            <div class="request-card">
                <div class="request-header">
                    <div>
                        <h4>${escapeHtml(req.food_name)}</h4>
                        <span class="text-muted text-sm">Collected on ${new Date(req.completed_at).toLocaleString()}</span>
                    </div>
                    <span class="status-badge status-completed">COMPLETED</span>
                </div>
                <div class="request-meta-grid">
                    <div><strong>Quantity Received:</strong> ${req.requested_quantity} ${req.unit}</div>
                    <div><strong>Pickup Location:</strong> ${escapeHtml(req.pickup_address)}</div>
                    <div><strong>Donor:</strong> ${escapeHtml(req.donor_name)}</div>
                </div>
            </div>
        `).join("");
    } catch (err) {
        container.innerHTML = `<p class="text-center text-muted py-4">${escapeHtml(err.message)}</p>`;
    }
}

async function cancelReceiverRequest(reqId) {
    if (!confirm("Are you sure you want to cancel this request?")) return;

    try {
        const res = await fetch(`/api/requests/${reqId}/cancel`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            loadReceiverRequests();
        } else {
            showNotification(data.message || "Failed to cancel request", "error");
        }
    } catch (err) {
        showNotification("Network error cancelling request", "error");
    }
}

// =====================================================================
// 9. Charts & Visualizations
// =====================================================================
function initializeCharts(role, chartData) {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js library is not loaded.");
        return;
    }

    if (role === "admin") {
        const ctx1 = document.getElementById("chart-admin-redistribution");
        if (ctx1) {
            destroyChart("admin-redistribution");
            const r = chartData.redistribution || {};
            const total = (r.available || 0) + (r.reserved || 0) + (r.collected || 0) + (r.wasted || 0) + (r.cancelled || 0);

            state.activeCharts["admin-redistribution"] = new Chart(ctx1, {
                type: "doughnut",
                data: {
                    labels: ["Available", "Reserved", "Collected", "Wasted", "Cancelled"],
                    datasets: [{
                        data: total > 0 ? [r.available, r.reserved, r.collected, r.wasted, r.cancelled] : [1, 0, 0, 0, 0],
                        backgroundColor: total > 0 
                            ? ["#52b788", "#3b82f6", "#1b4332", "#ef4444", "#94a3b8"]
                            : ["#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0"]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "bottom" },
                        tooltip: {
                            callbacks: {
                                label: (item) => total > 0 ? ` ${item.label}: ${item.raw} kg` : " No redistribution data yet"
                            }
                        }
                    }
                }
            });
        }

        const ctx2 = document.getElementById("chart-admin-categories");
        if (ctx2) {
            destroyChart("admin-categories");
            const cats = chartData.categories || [];
            const labels = cats.length > 0 ? cats.map(c => c.category) : ["No data"];
            const quantities = cats.length > 0 ? cats.map(c => c.quantity) : [0];

            state.activeCharts["admin-categories"] = new Chart(ctx2, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{
                        label: "Donated Quantity (kg)",
                        data: quantities,
                        backgroundColor: "#2d6a4f",
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, grid: { color: "#f1f5f9" } },
                        x: { grid: { display: false } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
    } else if (role === "donor") {
        const ctx = document.getElementById("chart-donor-breakdown");
        if (ctx) {
            destroyChart("donor-breakdown");
            const b = chartData.breakdown || {};
            const total = (b.available || 0) + (b.reserved || 0) + (b.collected || 0) + (b.wasted || 0) + (b.cancelled || 0);

            state.activeCharts["donor-breakdown"] = new Chart(ctx, {
                type: "doughnut",
                data: {
                    labels: ["Available", "Reserved", "Collected", "Wasted", "Cancelled"],
                    datasets: [{
                        data: total > 0 ? [b.available, b.reserved, b.collected, b.wasted, b.cancelled] : [1, 0, 0, 0, 0],
                        backgroundColor: total > 0 
                            ? ["#52b788", "#3b82f6", "#1b4332", "#ef4444", "#94a3b8"]
                            : ["#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0"]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "bottom" },
                        tooltip: {
                            callbacks: {
                                label: (item) => total > 0 ? ` ${item.label}: ${item.raw} kg` : " No donation data yet"
                            }
                        }
                    }
                }
            });
        }
    } else if (role === "receiver") {
        const ctx = document.getElementById("chart-receiver-status");
        if (ctx) {
            destroyChart("receiver-status");
            const s = chartData.statusBreakdown || {};
            const total = (s.PENDING || 0) + (s.ACCEPTED || 0) + (s.COMPLETED || 0) + (s.REJECTED || 0) + (s.CANCELLED || 0);

            state.activeCharts["receiver-status"] = new Chart(ctx, {
                type: "bar",
                data: {
                    labels: ["Pending", "Accepted", "Completed", "Rejected", "Cancelled"],
                    datasets: [{
                        label: "Requests Count",
                        data: [s.PENDING || 0, s.ACCEPTED || 0, s.COMPLETED || 0, s.REJECTED || 0, s.CANCELLED || 0],
                        backgroundColor: ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#94a3b8"],
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: "#f1f5f9" } },
                        x: { grid: { display: false } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
    }
}

function destroyChart(id) {
    if (state.activeCharts[id]) {
        state.activeCharts[id].destroy();
        delete state.activeCharts[id];
    }
}

function destroyAllCharts() {
    Object.keys(state.activeCharts).forEach(id => destroyChart(id));
}

// =====================================================================
// PHASE 5: ADMIN MANAGEMENT & ANALYTICS CONTROLLERS
// =====================================================================
function renderComparisonBadge(today, yesterday, isWaste = false) {
    const t = parseFloat(today || 0);
    const y = parseFloat(yesterday || 0);
    if (y === 0) {
        if (t === 0) return '<span class="comp-badge neutral">0% vs yesterday</span>';
        return '<span class="comp-badge up">+100% vs yesterday</span>';
    }
    const diff = t - y;
    const pct = ((diff / y) * 100).toFixed(1);
    if (diff > 0) {
        const cls = isWaste ? "down" : "up";
        return `<span class="comp-badge ${cls}">+${pct}% vs yesterday</span>`;
    } else if (diff < 0) {
        const cls = isWaste ? "up" : "down";
        return `<span class="comp-badge ${cls}">${pct}% vs yesterday</span>`;
    } else {
        return '<span class="comp-badge neutral">0% vs yesterday</span>';
    }
}

// 1. Admin Users Controller
async function loadAdminUsers(page = 1) {
    const tbody = document.getElementById("admin-users-table-body");
    const pagination = document.getElementById("admin-users-pagination");
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner"></div> Loading users...</td></tr>';

    const search = document.getElementById("admin-users-search")?.value || "";
    const role = document.getElementById("admin-users-role-filter")?.value || "";
    const status = document.getElementById("admin-users-status-filter")?.value || "";

    const params = new URLSearchParams({ page, limit: 15 });
    if (search.trim()) params.append("search", search.trim());
    if (role) params.append("role", role);
    if (status) params.append("status", status);

    try {
        const res = await fetch(`/api/admin/users?${params.toString()}`, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load users");

        const users = data.users || [];
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No users found matching your filters.</td></tr>';
            if (pagination) pagination.innerHTML = "";
            return;
        }

        tbody.innerHTML = users.map(u => {
            const isSelf = u.id === state.user.id;
            const isAdmin = u.role === "ADMIN";
            const canToggle = !isSelf && !isAdmin;

            let actionBtn = "";
            if (canToggle) {
                if (u.status === "ACTIVE") {
                    actionBtn = `<button class="btn btn-outline-danger btn-sm" onclick="toggleUserStatus(${u.id}, 'ACTIVE', '${escapeHtml(u.name)}')">Deactivate</button>`;
                } else {
                    actionBtn = `<button class="btn btn-outline btn-sm" onclick="toggleUserStatus(${u.id}, 'INACTIVE', '${escapeHtml(u.name)}')">Activate</button>`;
                }
            } else {
                actionBtn = '<span class="text-muted text-sm font-semibold">Protected</span>';
            }

            return `
                <tr>
                    <td class="font-mono">#${u.id}</td>
                    <td><strong>${escapeHtml(u.name)}</strong>${isSelf ? ' <span class="badge" style="font-size:0.7rem;">You</span>' : ''}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${escapeHtml(u.phone || 'N/A')}</td>
                    <td><span class="badge">${u.role}</span></td>
                    <td><span class="status-badge ${u.status === 'ACTIVE' ? 'status-available' : 'status-cancelled'}">${u.status}</span></td>
                    <td>${new Date(u.created_at).toLocaleDateString()}</td>
                    <td><div class="table-actions">${actionBtn}</div></td>
                </tr>
            `;
        }).join("");

        // Render Pagination
        const p = data.pagination;
        if (pagination) {
            pagination.innerHTML = `
                <div class="pagination-info">Showing page ${p.page} of ${p.totalPages || 1} (${p.total} users)</div>
                <div class="pagination-btns">
                    <button class="btn-page" ${p.page <= 1 ? "disabled" : ""} onclick="loadAdminUsers(${p.page - 1})">Previous</button>
                    <button class="btn-page" ${p.page >= p.totalPages ? "disabled" : ""} onclick="loadAdminUsers(${p.page + 1})">Next</button>
                </div>
            `;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function toggleUserStatus(userId, currentStatus, userName) {
    const nextStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const actionWord = nextStatus === "ACTIVE" ? "activate" : "deactivate";

    if (!confirm(`Are you sure you want to ${actionWord} the account for ${userName}?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/admin/users/${userId}/status`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ status: nextStatus })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            loadAdminUsers(1);
        } else {
            showNotification(data.message || "Failed to update user status", "error");
        }
    } catch (err) {
        showNotification("Network error updating user status", "error");
    }
}

// 2. Admin Food Listings Controller
async function loadAdminFood(page = 1) {
    const tbody = document.getElementById("admin-food-table-body");
    const pagination = document.getElementById("admin-food-pagination");
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="12" class="text-center py-4"><div class="spinner"></div> Loading food listings...</td></tr>';

    const search = document.getElementById("admin-food-search")?.value || "";
    const category = document.getElementById("admin-food-category-filter")?.value || "";
    const status = document.getElementById("admin-food-status-filter")?.value || "";

    const params = new URLSearchParams({ page, limit: 15 });
    if (search.trim()) params.append("search", search.trim());
    if (category) params.append("category", category);
    if (status) params.append("status", status);

    try {
        const res = await fetch(`/api/admin/food?${params.toString()}`, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load food listings");

        const food = data.food || [];
        if (food.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center py-4 text-muted">No food listings found.</td></tr>';
            if (pagination) pagination.innerHTML = "";
            return;
        }

        tbody.innerHTML = food.map(item => `
            <tr>
                <td class="font-mono">#${item.id}</td>
                <td><strong>${escapeHtml(item.food_name)}</strong></td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.donor_name)}</td>
                <td>${item.total_quantity} ${item.unit}</td>
                <td class="text-success font-semibold">${item.available_quantity}</td>
                <td style="color:#3b82f6;">${item.reserved_quantity}</td>
                <td style="color:#10b981;">${item.collected_quantity}</td>
                <td style="color:#ef4444;">${item.wasted_quantity}</td>
                <td><span class="status-badge ${getStatusBadgeClass(item.status)}">${item.status}</span></td>
                <td class="text-sm">${new Date(item.expiry_at).toLocaleDateString()}</td>
                <td>
                    <div class="table-actions">
                        ${item.status !== "CANCELLED" && item.status !== "COMPLETED" ? `
                            <button class="btn btn-outline-danger btn-sm" onclick="removeAdminFood(${item.id}, '${escapeHtml(item.food_name)}')">Remove</button>
                        ` : '<span class="text-muted text-sm">—</span>'}
                    </div>
                </td>
            </tr>
        `).join("");

        const p = data.pagination;
        if (pagination) {
            pagination.innerHTML = `
                <div class="pagination-info">Showing page ${p.page} of ${p.totalPages || 1} (${p.total} listings)</div>
                <div class="pagination-btns">
                    <button class="btn-page" ${p.page <= 1 ? "disabled" : ""} onclick="loadAdminFood(${p.page - 1})">Previous</button>
                    <button class="btn-page" ${p.page >= p.totalPages ? "disabled" : ""} onclick="loadAdminFood(${p.page + 1})">Next</button>
                </div>
            `;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function removeAdminFood(foodId, foodName) {
    if (!confirm(`Are you sure you want to administratively remove "${foodName}"? Any pending requests will be rejected and uncollected food will be safely cancelled.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/admin/food/${foodId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(data.message, "success");
            loadAdminFood(1);
        } else {
            showNotification(data.message || "Failed to remove food listing", "error");
        }
    } catch (err) {
        showNotification("Network error removing food listing", "error");
    }
}

// 3. Admin Requests Controller
async function loadAdminRequests(page = 1) {
    const tbody = document.getElementById("admin-requests-table-body");
    const pagination = document.getElementById("admin-requests-pagination");
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner"></div> Loading requests...</td></tr>';

    const search = document.getElementById("admin-requests-search")?.value || "";
    const status = document.getElementById("admin-requests-status-filter")?.value || "";

    const params = new URLSearchParams({ page, limit: 15 });
    if (search.trim()) params.append("search", search.trim());
    if (status) params.append("status", status);

    try {
        const res = await fetch(`/api/admin/requests?${params.toString()}`, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load requests");

        const requests = data.requests || [];
        if (requests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No requests found.</td></tr>';
            if (pagination) pagination.innerHTML = "";
            return;
        }

        tbody.innerHTML = requests.map(r => `
            <tr>
                <td class="font-mono">#${r.id}</td>
                <td><strong>${escapeHtml(r.food_name)}</strong></td>
                <td>${escapeHtml(r.receiver_name)}</td>
                <td>${escapeHtml(r.donor_name)}</td>
                <td><span class="text-success font-semibold">${r.requested_quantity} ${r.unit}</span></td>
                <td>${r.beneficiary_count ? `${r.beneficiary_count} people` : '<span class="text-muted">—</span>'}</td>
                <td><span class="status-badge ${getStatusBadgeClass(r.status)}">${r.status}</span></td>
                <td class="text-sm">${new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
        `).join("");

        const p = data.pagination;
        if (pagination) {
            pagination.innerHTML = `
                <div class="pagination-info">Showing page ${p.page} of ${p.totalPages || 1} (${p.total} requests)</div>
                <div class="pagination-btns">
                    <button class="btn-page" ${p.page <= 1 ? "disabled" : ""} onclick="loadAdminRequests(${p.page - 1})">Previous</button>
                    <button class="btn-page" ${p.page >= p.totalPages ? "disabled" : ""} onclick="loadAdminRequests(${p.page + 1})">Next</button>
                </div>
            `;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
}

// 4. Admin Analytics Controller
async function loadAdminAnalytics() {
    setDashboardLoading(true);
    try {
        const res = await fetch("/api/dashboard/admin", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load platform analytics");

        const m = data.metrics || {};
        const reused = parseFloat(m.foodReused || 0);
        const wasted = parseFloat(m.foodWasted || 0);
        const totalClosed = reused + wasted;
        const efficiency = totalClosed > 0 ? ((reused / totalClosed) * 100).toFixed(1) : "0.0";
        const wasteRate = totalClosed > 0 ? ((wasted / totalClosed) * 100).toFixed(1) : "0.0";
        const activeUsersRatio = m.totalUsers > 0 ? (((m.activeUsers || 0) / m.totalUsers) * 100).toFixed(1) : "0.0";

        document.getElementById("admin-analytics-efficiency").textContent = `${efficiency}%`;
        document.getElementById("admin-analytics-total-qty").textContent = `${formatNum(m.totalFoodDonations)} items`;
        document.getElementById("admin-analytics-waste-rate").textContent = `${wasteRate}%`;
        document.getElementById("admin-analytics-active-ratio").textContent = `${activeUsersRatio}%`;

        // Render analytics charts
        const ctx1 = document.getElementById("chart-admin-analytics-breakdown");
        if (ctx1 && typeof Chart !== "undefined") {
            destroyChart("admin-analytics-breakdown");
            const r = data.charts?.redistribution || {};
            const total = (r.available || 0) + (r.reserved || 0) + (r.collected || 0) + (r.wasted || 0) + (r.cancelled || 0);

            state.activeCharts["admin-analytics-breakdown"] = new Chart(ctx1, {
                type: "doughnut",
                data: {
                    labels: ["Available", "Reserved", "Collected", "Wasted", "Cancelled"],
                    datasets: [{
                        data: total > 0 ? [r.available, r.reserved, r.collected, r.wasted, r.cancelled] : [1, 0, 0, 0, 0],
                        backgroundColor: total > 0 
                            ? ["#52b788", "#3b82f6", "#1b4332", "#ef4444", "#94a3b8"]
                            : ["#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0"]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "bottom" },
                        tooltip: {
                            callbacks: {
                                label: (item) => total > 0 ? ` ${item.label}: ${item.raw} kg` : " No data"
                            }
                        }
                    }
                }
            });
        }

        const ctx2 = document.getElementById("chart-admin-analytics-categories");
        if (ctx2 && typeof Chart !== "undefined") {
            destroyChart("admin-analytics-categories");
            const cats = data.charts?.categories || [];
            const labels = cats.length > 0 ? cats.map(c => c.category) : ["No data"];
            const quantities = cats.length > 0 ? cats.map(c => c.quantity) : [0];

            state.activeCharts["admin-analytics-categories"] = new Chart(ctx2, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{
                        label: "Quantity (kg)",
                        data: quantities,
                        backgroundColor: "#2d6a4f",
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, grid: { color: "#f1f5f9" } },
                        x: { grid: { display: false } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }

    } catch (err) {
        showNotification(err.message, "error");
    } finally {
        setDashboardLoading(false);
    }
}

// 5. Donor Analytics Controller
async function loadDonorAnalytics() {
    setDashboardLoading(true);
    try {
        const res = await fetch("/api/dashboard/donor", {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load donor analytics");

        const m = data.metrics || {};
        const reused = parseFloat(m.foodReused || 0);
        const wasted = parseFloat(m.foodWasted || 0);
        const total = reused + wasted;
        const rate = total > 0 ? ((reused / total) * 100).toFixed(1) : "100.0";

        document.getElementById("donor-analytics-rate").textContent = `${rate}%`;
        document.getElementById("donor-analytics-total").textContent = `${formatNum(m.totalDonated)} kg`;
        document.getElementById("donor-analytics-people").textContent = `${formatNum(m.peopleHelped)}`;
        document.getElementById("donor-analytics-saved").textContent = `${formatNum(m.foodReused)} kg`;

        // Render donor breakdown chart
        const ctx = document.getElementById("chart-donor-analytics-breakdown");
        if (ctx && typeof Chart !== "undefined") {
            destroyChart("donor-analytics-breakdown");
            const b = data.charts?.breakdown || {};
            const sum = (b.available || 0) + (b.reserved || 0) + (b.collected || 0) + (b.wasted || 0) + (b.cancelled || 0);

            state.activeCharts["donor-analytics-breakdown"] = new Chart(ctx, {
                type: "doughnut",
                data: {
                    labels: ["Available", "Reserved", "Collected", "Wasted", "Cancelled"],
                    datasets: [{
                        data: sum > 0 ? [b.available, b.reserved, b.collected, b.wasted, b.cancelled] : [1, 0, 0, 0, 0],
                        backgroundColor: sum > 0 
                            ? ["#52b788", "#3b82f6", "#1b4332", "#ef4444", "#94a3b8"]
                            : ["#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0", "#e2e8f0"]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "bottom" }
                    }
                }
            });
        }

        // Render completed collection history
        const listContainer = document.getElementById("donor-analytics-history-list");
        if (listContainer) {
            const completed = data.recentCompletedCollections || [];
            if (completed.length === 0) {
                listContainer.innerHTML = '<p class="text-muted text-center py-4">No completed collection records yet.</p>';
            } else {
                listContainer.innerHTML = completed.map(c => `
                    <div class="activity-item">
                        <div>
                            <div class="activity-desc">Collected by ${escapeHtml(c.receiver_name)}: ${escapeHtml(c.food_name)} (${c.requested_quantity} ${c.unit})</div>
                            <div class="activity-meta">Beneficiaries Helped: ${c.beneficiary_count} people • ${new Date(c.completed_at).toLocaleString()}</div>
                        </div>
                        <span class="status-badge status-completed">COMPLETED</span>
                    </div>
                `).join("");
            }
        }

    } catch (err) {
        showNotification(err.message, "error");
    } finally {
        setDashboardLoading(false);
    }
}

// =====================================================================
// 10. Activity Lists Renderers
// =====================================================================
function renderActivityList(containerId, activities) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!activities || activities.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">No recent platform activities recorded yet.</p>';
        return;
    }

    container.innerHTML = activities.map(item => `
        <div class="activity-item">
            <div>
                <div class="activity-desc">${escapeHtml(item.description)}</div>
                <div class="activity-meta">${new Date(item.created_at).toLocaleString()}</div>
            </div>
            <span class="status-badge ${getStatusBadgeClass(item.status)}">${item.status}</span>
        </div>
    `).join("");
}

function renderDonorActivityList(containerId, listings) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!listings || listings.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">No donation listings published yet.</p>';
        return;
    }

    container.innerHTML = listings.map(item => `
        <div class="activity-item">
            <div>
                <div class="activity-desc">${escapeHtml(item.food_name)} (${item.total_quantity} ${item.unit})</div>
                <div class="activity-meta">Category: ${escapeHtml(item.category)} • ${new Date(item.created_at).toLocaleDateString()}</div>
            </div>
            <span class="status-badge ${getStatusBadgeClass(item.status)}">${item.status}</span>
        </div>
    `).join("");
}

function renderReceiverActivityList(containerId, requests) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!requests || requests.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">No requests placed yet.</p>';
        return;
    }

    container.innerHTML = requests.map(item => `
        <div class="activity-item">
            <div>
                <div class="activity-desc">${escapeHtml(item.food_name)} - Requested: ${item.requested_quantity} ${item.unit}</div>
                <div class="activity-meta">Requested on ${new Date(item.created_at).toLocaleDateString()}</div>
            </div>
            <span class="status-badge ${getStatusBadgeClass(item.status)}">${item.status}</span>
        </div>
    `).join("");
}

function getStatusBadgeClass(status) {
    switch (status) {
        case "AVAILABLE": return "status-available";
        case "COMPLETED": return "status-completed";
        case "PENDING": return "status-pending";
        case "FULLY_RESERVED": return "status-pending";
        case "CANCELLED":
        case "REJECTED": return "status-cancelled";
        default: return "";
    }
}

// =====================================================================
// 11. Modal Helpers
// =====================================================================
function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove("hidden");
}

function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add("hidden");
}

// =====================================================================
// 12. Event Handlers Setup
// =====================================================================
function setupEventHandlers() {
    // Auth screens navigation
    document.getElementById("link-go-to-register").addEventListener("click", (e) => {
        e.preventDefault();
        showAuthView("register");
    });

    document.getElementById("link-go-to-login").addEventListener("click", (e) => {
        e.preventDefault();
        showAuthView("login");
    });

    // Form Submissions
    document.getElementById("form-login").addEventListener("submit", (e) => {
        e.preventDefault();
        loginUser(
            document.getElementById("login-email").value,
            document.getElementById("login-password").value
        );
    });

    document.getElementById("form-register").addEventListener("submit", (e) => {
        e.preventDefault();
        registerUser(
            document.getElementById("register-name").value,
            document.getElementById("register-email").value,
            document.getElementById("register-phone").value,
            document.getElementById("register-role").value,
            document.getElementById("register-password").value,
            document.getElementById("register-confirm-password").value
        );
    });

    // Logout
    document.getElementById("btn-sidebar-logout").addEventListener("click", () => {
        logoutUser(true);
    });

    // Topbar Profile
    document.getElementById("btn-topbar-profile").addEventListener("click", () => {
        showSection("profile");
    });

    // Placeholder Back
    document.getElementById("btn-placeholder-back").addEventListener("click", () => {
        const role = state.user?.role;
        if (role === "ADMIN") showSection("admin-dashboard");
        else if (role === "DONOR") showSection("donor-dashboard");
        else showSection("receiver-dashboard");
    });

    // Mobile Sidebar Toggles
    const toggleBtn = document.getElementById("btn-toggle-sidebar");
    const closeBtn = document.getElementById("btn-close-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (toggleBtn) toggleBtn.addEventListener("click", openMobileSidebar);
    if (closeBtn) closeBtn.addEventListener("click", closeMobileSidebar);
    if (backdrop) backdrop.addEventListener("click", closeMobileSidebar);

    // Modal Close Buttons
    document.querySelectorAll(".modal-close").forEach(btn => {
        btn.addEventListener("click", () => {
            const modalId = btn.dataset.modal;
            if (modalId) closeModal(modalId);
        });
    });

    // Donor Listing Actions
    const btnOpenCreate = document.getElementById("btn-open-create-food");
    if (btnOpenCreate) {
        btnOpenCreate.addEventListener("click", () => {
            showSection("donor-create-food", "Publish Food Donation");
        });
    }

    const btnCancelCreate = document.getElementById("btn-cancel-create-food");
    if (btnCancelCreate) {
        btnCancelCreate.addEventListener("click", () => {
            showSection("donor-my-donations", "My Food Donations");
        });
    }

    const formCreateFood = document.getElementById("form-create-food");
    if (formCreateFood) formCreateFood.addEventListener("submit", handleCreateFoodSubmit);

    const formEditFood = document.getElementById("form-edit-food");
    if (formEditFood) formEditFood.addEventListener("submit", handleEditFoodSubmit);

    const formReportWaste = document.getElementById("form-report-waste");
    if (formReportWaste) formReportWaste.addEventListener("submit", handleReportWasteSubmit);

    const formRejectReq = document.getElementById("form-reject-request");
    if (formRejectReq) formRejectReq.addEventListener("submit", handleRejectRequestSubmit);

    const formCompleteReq = document.getElementById("form-complete-request");
    if (formCompleteReq) formCompleteReq.addEventListener("submit", handleCompleteRequestSubmit);

    const donorStatusFilter = document.getElementById("donor-status-filter");
    if (donorStatusFilter) donorStatusFilter.addEventListener("change", () => loadDonorDonations());

    // Receiver Actions
    const formSubmitReq = document.getElementById("form-submit-request");
    if (formSubmitReq) formSubmitReq.addEventListener("submit", handleRequestFoodSubmit);

    const searchInput = document.getElementById("browse-search");
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => loadBrowseFood(), 350);
        });
    }

    const categorySelect = document.getElementById("browse-category");
    if (categorySelect) categorySelect.addEventListener("change", () => loadBrowseFood());

    const sortSelect = document.getElementById("browse-sort");
    if (sortSelect) sortSelect.addEventListener("change", () => loadBrowseFood());

    // Phase 5 Admin Filter Events
    const adminUserSearch = document.getElementById("admin-users-search");
    if (adminUserSearch) {
        let uTimer;
        adminUserSearch.addEventListener("input", () => {
            clearTimeout(uTimer);
            uTimer = setTimeout(() => loadAdminUsers(1), 350);
        });
    }
    const adminUserRole = document.getElementById("admin-users-role-filter");
    if (adminUserRole) adminUserRole.addEventListener("change", () => loadAdminUsers(1));
    const adminUserStatus = document.getElementById("admin-users-status-filter");
    if (adminUserStatus) adminUserStatus.addEventListener("change", () => loadAdminUsers(1));

    const adminFoodSearch = document.getElementById("admin-food-search");
    if (adminFoodSearch) {
        let fTimer;
        adminFoodSearch.addEventListener("input", () => {
            clearTimeout(fTimer);
            fTimer = setTimeout(() => loadAdminFood(1), 350);
        });
    }
    const adminFoodCategory = document.getElementById("admin-food-category-filter");
    if (adminFoodCategory) adminFoodCategory.addEventListener("change", () => loadAdminFood(1));
    const adminFoodStatus = document.getElementById("admin-food-status-filter");
    if (adminFoodStatus) adminFoodStatus.addEventListener("change", () => loadAdminFood(1));

    const adminReqSearch = document.getElementById("admin-requests-search");
    if (adminReqSearch) {
        let rTimer;
        adminReqSearch.addEventListener("input", () => {
            clearTimeout(rTimer);
            rTimer = setTimeout(() => loadAdminRequests(1), 350);
        });
    }
    const adminReqStatus = document.getElementById("admin-requests-status-filter");
    if (adminReqStatus) adminReqStatus.addEventListener("change", () => loadAdminRequests(1));
}

function openMobileSidebar() {
    document.getElementById("sidebar").classList.add("open");
}

function closeMobileSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("open");
}

// =====================================================================
// 13. Helpers & UI Utilities
// =====================================================================
function showNotification(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function setButtonLoading(button, isLoading) {
    if (!button) return;
    const textEl = button.querySelector(".btn-text");
    const spinner = button.querySelector(".btn-spinner");
    if (isLoading) {
        button.disabled = true;
        if (spinner) spinner.classList.remove("hidden");
    } else {
        button.disabled = false;
        if (spinner) spinner.classList.add("hidden");
    }
}

function setDashboardLoading(isLoading) {
    const loader = document.getElementById("dashboard-loading");
    if (loader) {
        if (isLoading) loader.classList.remove("hidden");
        else loader.classList.add("hidden");
    }
}

function clearAuthFieldErrors() {
    document.querySelectorAll(".field-error").forEach(el => el.textContent = "");
}

function formatNum(num) {
    if (num === undefined || num === null || isNaN(num)) return "0";
    return Number(num).toLocaleString();
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[m]);
}

function getIconSvg(name) {
    switch (name) {
        case "grid":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
        case "users":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
        case "package":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
        case "inbox":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`;
        case "chart":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`;
        case "user":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        case "clock":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        case "search":
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
        default:
            return "";
    }
}
