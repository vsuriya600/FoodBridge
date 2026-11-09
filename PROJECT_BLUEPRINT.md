# FoodBridge – Smart Food Waste Reduction and Redistribution Platform

## 1. Project Overview

**Project Name:** FoodBridge

**Project Type:** Mini Project – Web Application

**Objective:**

FoodBridge is a web-based platform that connects food donors with people and organizations that need food.

Donors can publish information about surplus food. Receivers can browse available food and request the required quantity. Donors can accept or reject requests, and completed collections are recorded to calculate food redistribution statistics.

The platform also provides dashboards to monitor food donations, reused food, wasted food, and beneficiaries helped.

### Main Goals

- Reduce food wastage.
- Connect food donors with receivers.
- Make surplus food redistribution easier.
- Track donated, collected, wasted, and cancelled food quantities.
- Provide transparent statistics through dashboards.

---

## 2. Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Backend | Node.js |
| Backend Framework | Express.js |
| Database | Clever Cloud MySQL |
| MySQL Driver | mysql2 |
| Authentication | JWT |
| Password Hashing | bcryptjs |
| Environment Variables | dotenv |
| Charts | Chart.js |
| API Communication | Fetch API |
| Development Server | Nodemon |

### Important Technology Restrictions

- Use only HTML, CSS, and Vanilla JavaScript for the frontend.
- Use Node.js and Express.js for the backend.
- Use Clever Cloud MySQL as the database.
- Use mysql2 to connect Node.js with Clever Cloud MySQL.
- Do not use MongoDB, Firebase, or SQLite.
- Do not use React, Angular, or Vue.
- Do not use Python or FastAPI.
- Do not introduce an ORM such as Sequelize or Prisma.
- Avoid unnecessary dependencies and additional files.

---

## 3. Project Folder Structure

Keep the entire project simple and easy to maintain.

```text
FoodBridge/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── server.js
├── database.sql
├── package.json
├── package-lock.json
│
├── .env
├── .env.example
├── .gitignore
│
├── PROJECT_BLUEPRINT.md
├── PROJECT_PROGRESS.md
└── README.md
```

### File Responsibilities

**public/index.html**
- Main application interface.
- Login and registration screens.
- Dashboards and application sections.

**public/style.css**
- All application styling.
- Responsive layouts.
- Dashboard and component styling.

**public/app.js**
- Frontend navigation.
- Form handling.
- API calls using Fetch.
- Dashboard rendering.
- User interactions.

**server.js**
- Express server.
- Clever Cloud MySQL connection.
- Authentication.
- API endpoints.
- Role authorization.
- Food management.
- Request management.
- Dashboard calculations.
- Admin operations.

Keep the backend inside one `server.js` file, using clearly separated sections and reusable functions.

**database.sql**
- Database table definitions.
- Primary keys and foreign keys.
- Indexes and constraints.
- Initial database setup where necessary.

**.env**
- Actual database credentials.
- JWT secret.
- Admin initialization credentials.
- Local environment configuration.

**.env.example**
- Placeholder environment variables only.
- Never include actual credentials.

**PROJECT_PROGRESS.md**
- Development phase status.
- Completed features.
- Pending features.
- Known issues.

**README.md**
- Project introduction.
- Technology stack.
- Installation instructions.
- Configuration and execution instructions.

---

## 4. User Roles

The application has three user roles.

### 4.1 DONOR

Donors can:

- Register and log in.
- Create food donation listings.
- Edit their own food listings.
- Cancel their own listings.
- View incoming food requests.
- Accept or reject requests.
- Provide an optional rejection reason.
- Confirm successful food collection.
- Enter the estimated number of beneficiaries.
- Report remaining available food as wasted.
- View donation statistics.
- View donation history.

### 4.2 RECEIVER

Receivers can:

- Register and log in.
- Browse available food.
- Search food by name.
- Filter food by category.
- View food details.
- Request a specific quantity.
- Track request status.
- Cancel their own requests.
- View accepted requests.
- View completed collection history.
- View personal dashboard statistics.

### 4.3 ADMIN

The administrator can:

- Log in through a securely initialized admin account.
- View all registered users.
- Activate or deactivate users.
- View all food listings.
- Remove inappropriate food listings.
- View all food requests.
- Monitor platform statistics.
- View total donations, reused food, wasted food, and beneficiaries.

Admin registration must not be available through public registration.

Create the initial admin account securely using environment variables during database initialization or a controlled one-time initialization process.

---

## 5. Main Application Workflow

### Step 1: Donor Creates Food Listing

The donor enters:

- Food name.
- Food category.
- Description.
- Total quantity.
- Quantity unit.
- Food image URL (optional).
- Preparation date and time.
- Expiry date and time.
- Pickup address.

The listing becomes available to receivers.

### Step 2: Receiver Browses Food

Receivers can browse food listings that are available and not expired.

They can search, filter, and view the available quantity.

### Step 3: Receiver Requests Food

The receiver selects a food listing and enters the requested quantity.

The request is created with PENDING status.

A receiver must not request more than the currently available quantity.

A receiver must not have multiple active requests for the same food listing.

### Step 4: Donor Accepts or Rejects

The donor can:

- Accept the request.
- Reject the request.
- Add an optional rejection reason.

When accepted, the requested quantity is moved from available quantity to reserved quantity.

### Step 5: Receiver Collects Food

After collection, the donor confirms the collection.

The donor enters the estimated number of beneficiaries.

The system:

- Marks the request as COMPLETED.
- Moves the reserved quantity to collected quantity.
- Records the completion date and time.
- Records the person who confirmed collection.
- Updates the platform statistics.

Only confirmed collections count as reused food.

### Step 6: Donor Reports Wasted Food

If some available food cannot be redistributed, the donor can explicitly report it as wasted.

The system moves the reported quantity from available quantity to wasted quantity.

Wasted food must only be counted when explicitly reported.

### Step 7: Dashboards Update

The system updates relevant statistics after successful transactions.

---

## 6. Database Design – Clever Cloud MySQL

Use **Clever Cloud MySQL** as the only database.

Use the `mysql2` Node.js package with a connection pool.

Use InnoDB tables and appropriate foreign keys, indexes, and constraints.

### Database Tables

Use only three main tables.

### Table 1: users

| Column | Description |
|---|---|
| id | Primary key |
| name | User's full name |
| email | Unique email address |
| password | Bcrypt password hash |
| phone | Contact number |
| role | ADMIN / DONOR / RECEIVER |
| status | ACTIVE / INACTIVE |
| created_at | Registration timestamp |

### Table 2: food_items

| Column | Description |
|---|---|
| id | Primary key |
| donor_id | Foreign key referencing users.id |
| food_name | Name of the food |
| category | Food category |
| description | Food description |
| total_quantity | Original donated quantity |
| available_quantity | Quantity available for requests |
| reserved_quantity | Quantity reserved for accepted requests |
| collected_quantity | Successfully collected quantity |
| wasted_quantity | Explicitly reported wasted quantity |
| cancelled_quantity | Quantity cancelled by the donor |
| unit | kg, packets, meals, etc. |
| image_url | Optional image URL |
| prepared_at | Food preparation date and time |
| expiry_at | Food expiry date and time |
| pickup_address | Food collection location |
| status | Listing status |
| created_at | Listing creation timestamp |

Listing statuses:

- AVAILABLE
- FULLY_RESERVED
- COMPLETED
- CANCELLED
- EXPIRED

### Table 3: food_requests

| Column | Description |
|---|---|
| id | Primary key |
| food_id | Foreign key referencing food_items.id |
| receiver_id | Foreign key referencing users.id |
| requested_quantity | Requested food quantity |
| beneficiary_count | Estimated beneficiaries |
| rejection_reason | Optional rejection explanation |
| status | Request status |
| pickup_time | Collection time if recorded |
| completed_at | Completion timestamp |
| completed_by | User who confirmed collection |
| created_at | Request creation timestamp |

Request statuses:

- PENDING
- ACCEPTED
- REJECTED
- CANCELLED
- COMPLETED

### Important Database Rules

Maintain this quantity invariant for every food listing:

`total_quantity = available_quantity + reserved_quantity + collected_quantity + wasted_quantity + cancelled_quantity`

All quantity values must be non-negative.

Use DECIMAL columns for quantities rather than FLOAT.

Use database transactions for operations that modify multiple related records.

Use `SELECT ... FOR UPDATE` where necessary to prevent concurrent requests from reserving the same available food.

Prevent duplicate active requests from the same receiver for the same listing. A PENDING or ACCEPTED request is considered active.

Do not count rejected requests or cancelled food as wasted food.

Do not automatically mark expired food as wasted.

When a listing is cancelled, its unreserved available quantity must be moved to cancelled quantity. Existing accepted reservations must be resolved before the listing is fully cancelled.

If an accepted request is cancelled, release its reserved quantity only if the listing remains valid and active. Do not return expired or cancelled food to available quantity.

A listing must not become COMPLETED while accepted reservations remain unresolved.

---

## 7. Clever Cloud MySQL Connection

The database will be hosted on Clever Cloud.

### Required Node.js Package

`mysql2`

### Environment Variables

The local `.env` file will contain:

```env
PORT=3000

DB_HOST=
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_PORT=3306

JWT_SECRET=

ADMIN_NAME=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

### Connection Requirements

1. Create a MySQL add-on in Clever Cloud.
2. Retrieve the database connection information from the Clever Cloud console.
3. Store the host, username, password, database name, and port in `.env`.
4. Use `dotenv` to load environment variables.
5. Create a MySQL connection pool using `mysql2/promise`.
6. Never hardcode database credentials in `server.js`.
7. Never expose database credentials to the frontend.
8. Configure SSL/TLS if required by the current Clever Cloud connection settings.
9. Handle database connection errors properly.
10. Use parameterized SQL queries for every database operation.

The application must connect to Clever Cloud MySQL, not a local MySQL installation.

The database schema in `database.sql` must be executed against the Clever Cloud database during initial setup.

Do not create a separate database connection file. Keep the connection pool in `server.js`.

---

## 8. Authentication and Security

Use JWT-based authentication.

### Registration

Endpoint:

`POST /api/register`

Requirements:

- Accept name, email, password, and phone.
- Validate required fields.
- Check whether the email already exists.
- Hash the password using bcryptjs.
- Assign RECEIVER as the default public registration role.
- Never allow users to register themselves as ADMIN.
- Save the account as ACTIVE.

### Login

Endpoint:

`POST /api/login`

Requirements:

- Verify email and password.
- Compare the password with bcryptjs.
- Prevent inactive users from logging in.
- Generate a JWT token.
- Return basic user details and the token.
- Never return the password hash.

### Current User

Endpoint:

`GET /api/me`

Requirements:

- Read the JWT from the Authorization Bearer header.
- Verify the token.
- Return the authenticated user's details.

### Middleware

Implement:

- `authenticateToken`
- `authorizeRole`

Use these middleware functions to protect API endpoints.

### Additional Security

- Use bcryptjs for password hashing.
- Use parameterized SQL queries.
- Use Helmet.
- Configure CORS appropriately.
- Use express-rate-limit for authentication endpoints.
- Validate backend input.
- Check resource ownership before modifications.
- Store secrets only in `.env`.
- Block inactive accounts.
- Never expose admin credentials.

---

## 9. API Endpoints

Implement only the endpoints required by the application.

### Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/register | Register receiver or donor |
| POST | /api/login | Login |
| GET | /api/me | Get current user |

### Food Management

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/food | Create food listing |
| GET | /api/food | Browse available food |
| GET | /api/food/:id | Get food details |
| PUT | /api/food/:id | Edit own listing |
| DELETE | /api/food/:id | Cancel own listing |
| GET | /api/my-food | View donor listings |
| PATCH | /api/food/:id/waste | Report wasted quantity |

### Food Requests

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/requests | Create food request |
| GET | /api/my-requests | View receiver requests |
| GET | /api/received-requests | View donor's incoming requests |
| PATCH | /api/requests/:id/accept | Accept request |
| PATCH | /api/requests/:id/reject | Reject request |
| PATCH | /api/requests/:id/cancel | Cancel request |
| PATCH | /api/requests/:id/complete | Confirm collection |

### Dashboard

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/dashboard/admin | Admin statistics |
| GET | /api/dashboard/donor | Donor statistics |
| GET | /api/dashboard/receiver | Receiver statistics |

### Admin

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/admin/users | View users |
| PATCH | /api/admin/users/:id/status | Activate/deactivate user |
| GET | /api/admin/food | View all food listings |
| DELETE | /api/admin/food/:id | Remove inappropriate listing |
| GET | /api/admin/requests | View all requests |

Protect every endpoint using authentication, role checks, ownership checks, and input validation as appropriate.

---

## 10. Frontend Design

Build the frontend using HTML, CSS, and Vanilla JavaScript.

Use a clean, modern, responsive dashboard interface.

### Main Application Screens

1. Login
2. Registration
3. Donor Dashboard
4. Receiver Dashboard
5. Admin Dashboard
6. Food Listing
7. Food Details
8. Create Food Listing
9. Manage Donations
10. Incoming Requests
11. My Requests
12. Collection History
13. Profile / Account Information

Do not create a separate marketing landing page.

The application should open directly into the appropriate login or application interface.

### Frontend Requirements

- Responsive design.
- Simple navigation.
- Dashboard summary cards.
- Food listing cards.
- Search and category filters.
- Request status indicators.
- Forms with validation.
- Confirmation dialogs for important actions.
- Clear loading and error messages.
- Charts using Chart.js.
- API communication through Fetch API.

Use role-based navigation so users only see the sections relevant to their role.

---

## 11. Dashboard Statistics

### Admin Dashboard

Display:

- Total registered users.
- Total donors.
- Total receivers.
- Total food donations.
- Total food collected.
- Total food wasted.
- Pending requests.
- Total beneficiaries helped.
- Food redistribution chart.
- Recent platform activity.

### Donor Dashboard

Display:

- Total donated quantity.
- Total collected quantity.
- Total wasted quantity.
- Pending requests.
- Completed requests.
- Donation history.
- Food redistribution chart.

### Receiver Dashboard

Display:

- Available food listings.
- Pending requests.
- Accepted requests.
- Completed requests.
- Total collected quantity.
- Collection history.

### Daily Statistics

Calculate the following:

**Food Donated Today**

Sum the original quantities of listings created today.

**Food Reused Today**

Sum the collected quantities of requests completed today.

**Food Wasted Today**

Sum quantities explicitly reported as wasted today. Use the actual waste-report timestamp, not the listing creation date.

**People Helped Today**

Sum the beneficiary counts from requests completed today.

Do not count accepted requests as reused food. Only completed collections count.

For percentage comparisons:

`Percentage Change = ((Today - Previous Day) / Previous Day) * 100`

If the previous day's value is zero, display "No previous-day data" rather than calculating an invalid percentage.

---

## 12. Development Phases

Develop the project in the following order.

### Phase 1 – Initial Node.js Setup

Completed manually by the developer.

Tasks:

- Create the FoodBridge folder.
- Initialize Node.js using npm.
- Install required dependencies.
- Configure package.json scripts.
- Create the basic project structure.
- Create `.env`, `.env.example`, and `.gitignore`.
- Create a minimal Express server.
- Test the server locally.

Do not create frontend pages, database tables, authentication, or dashboards in this phase.

### Phase 2 – Database and Authentication

Tasks:

- Configure Clever Cloud MySQL connection.
- Create the three database tables.
- Configure the MySQL connection pool.
- Implement registration.
- Implement login.
- Implement JWT authentication.
- Implement role authorization.
- Implement `/api/me`.
- Securely initialize the admin account.
- Test database connectivity and authentication.

### Phase 3 – Frontend Foundation and Dashboards

Tasks:

- Build the basic frontend interface.
- Implement login and registration screens.
- Implement role-based navigation.
- Build donor dashboard.
- Build receiver dashboard.
- Build admin dashboard.
- Connect dashboard data to backend APIs.
- Implement Chart.js visualizations.

### Phase 4 – Food Donations and Requests

Tasks:

- Create food listings.
- Display available food.
- Search and filter food.
- View food details.
- Edit and cancel listings.
- Create food requests.
- Accept and reject requests.
- Cancel requests.
- Confirm collection.
- Report wasted food.
- Maintain correct quantity calculations.

### Phase 5 – Admin Management and Analytics

Tasks:

- Implement user management.
- Activate and deactivate accounts.
- Manage food listings.
- Monitor requests.
- Implement platform statistics.
- Implement daily statistics.
- Verify dashboard calculations.

### Phase 6 – Testing and Finalization

Tasks:

- Test all user roles.
- Test authentication and authorization.
- Test food listing operations.
- Test request workflows.
- Test quantity calculations.
- Test concurrent requests and database transactions.
- Test expired food handling.
- Test responsive layouts.
- Fix bugs.
- Update README.md.
- Prepare the project demonstration.

---

## 13. Development Rules for AI Coding Assistants

Use this blueprint as the single source of truth.

Follow these instructions throughout development:

1. Work on one development phase at a time.
2. Read `PROJECT_BLUEPRINT.md` and `PROJECT_PROGRESS.md` before making changes.
3. Inspect existing project files before editing.
4. Preserve existing working features.
5. Keep the project structure simple.
6. Keep backend logic in `server.js`.
7. Keep frontend logic in `public/app.js`.
8. Do not create unnecessary files.
9. Do not add unrequested frameworks or dependencies.
10. Do not use fake data in place of actual database operations.
11. Do not create buttons without working functionality.
12. Use Clever Cloud MySQL for all persistent application data.
13. Use secure, parameterized database queries.
14. Use transactions for quantity-changing operations.
15. Test the implemented functionality before finishing a phase.
16. Update `PROJECT_PROGRESS.md` after each phase.
17. Report files created or modified, features completed, tests performed, and remaining issues.
18. Stop after completing the requested phase and wait for approval before moving to the next phase.

---

## 14. Final Project Expectations

The final FoodBridge mini project must provide:

- Secure registration and login.
- Three user roles.
- Food donation management.
- Food browsing and searching.
- Food request management.
- Request acceptance and rejection.
- Collection confirmation.
- Explicit waste reporting.
- Accurate quantity tracking.
- Role-based dashboards.
- Admin management.
- Food redistribution statistics.
- Clever Cloud MySQL integration.
- Responsive user interface.

### Future Expansion Possibilities

The architecture should allow future improvements such as:

- Email notifications.
- Real-time request notifications.
- Google Maps pickup locations.
- Food image uploads.
- Food expiry notifications.
- NGO verification.
- Advanced analytics.
- Mobile application integration.

These are future enhancements, not requirements for the current mini project.

**Important: Prioritize completing a stable, functional mini project quickly. Do not overcomplicate the implementation.**