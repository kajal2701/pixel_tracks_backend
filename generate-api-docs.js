import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const workbook = new ExcelJS.Workbook();
workbook.creator = 'Pixel Tracks Backend';
workbook.created = new Date();

// ── Colour palette ──────────────────────────────────────────────
const COLORS = {
  headerBg:    '1E3A5F',   // dark navy
  headerFg:    'FFFFFF',
  get:         'D4EDDA',   // green tint
  post:        'D1ECF1',   // blue tint
  put:         'FFF3CD',   // yellow tint
  patch:       'E2D9F3',   // purple tint
  delete:      'F8D7DA',   // red tint
  sectionBg:   '2E86AB',   // section header blue
  sectionFg:   'FFFFFF',
  required:    'C0392B',   // red text
  optional:    '196F3D',   // green text
  rowAlt:      'F2F7FB',
};

const METHOD_COLORS = { GET: COLORS.get, POST: COLORS.post, PUT: COLORS.put, PATCH: COLORS.patch, DELETE: COLORS.delete };

// ── API Data ────────────────────────────────────────────────────
const BASE = 'http://localhost:8000';

const apis = [
  // ── AUTH ──
  {
    section: 'Authentication',
    method: 'POST',
    endpoint: '/api/auth/login',
    description: 'Login with customer number and access code',
    paramType: 'Body (JSON)',
    params: [
      { name: 'customer_number', type: 'String', required: 'Required', description: 'Unique customer number  e.g. CUST-001' },
      { name: 'access_code',     type: 'String', required: 'Required', description: 'Customer access code / password' },
    ],
    successCode: '200',
    successResponse: '{ message, customer: { id, customer_number, company_name, ... } }',
    errorResponse: '401 Invalid credentials | 403 Inactive account | 400 Missing fields',
  },
  {
    section: 'Authentication',
    method: 'POST',
    endpoint: '/api/auth/set-access-code',
    description: 'Set or reset a customer access code (admin)',
    paramType: 'Body (JSON)',
    params: [
      { name: 'customer_number', type: 'String', required: 'Required', description: 'Target customer number' },
      { name: 'access_code',     type: 'String', required: 'Required', description: 'New access code (min 4 chars)' },
    ],
    successCode: '200',
    successResponse: '{ message: "Access code updated successfully." }',
    errorResponse: '404 Customer not found | 400 Too short',
  },

  // ── ADMIN ──
  {
    section: 'Admin',
    method: 'POST',
    endpoint: '/api/admin/login',
    description: 'Admin login with username and password',
    paramType: 'Body (JSON)',
    params: [
      { name: 'username', type: 'String', required: 'Required', description: 'Admin username' },
      { name: 'password', type: 'String', required: 'Required', description: 'Admin password (plain text, compared against bcrypt hash)' },
    ],
    successCode: '200',
    successResponse: '{ message, admin: { id, username, email, role, quick_access, ... } }',
    errorResponse: '401 Invalid credentials | 400 Missing fields | 500 Database error',
  },
  {
    section: 'Admin',
    method: 'GET',
    endpoint: '/api/admin/users',
    description: 'Get all admin users (password excluded)',
    paramType: 'None',
    params: [
      { name: '—', type: '—', required: 'None', description: 'No parameters required' },
    ],
    successCode: '200',
    successResponse: '{ data: [ ...adminUsers ], total: N }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Admin',
    method: 'POST',
    endpoint: '/api/admin/users',
    description: 'Create a new admin user',
    paramType: 'Body (JSON)',
    params: [
      { name: 'username',     type: 'String', required: 'Required', description: 'Unique admin username' },
      { name: 'password',     type: 'String', required: 'Required', description: 'Plain text password (stored as bcrypt hash)' },
      { name: 'email',        type: 'String', required: 'Required', description: 'Admin email address' },
      { name: 'role',         type: 'String', required: 'Optional', description: 'admin | superadmin  (default: admin)' },
      { name: 'quick_access', type: 'String', required: 'Optional', description: 'yes | no  (default: yes)' },
    ],
    successCode: '201',
    successResponse: '{ message, data: { id, username, email, role, quick_access, ... } }',
    errorResponse: '400 Missing fields | 409 Username exists | 500 Database error',
  },
  {
    section: 'Admin',
    method: 'PUT',
    endpoint: '/api/admin/users/:id',
    description: 'Update admin user details (partial update supported)',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id',           type: 'Integer', required: 'Required', description: 'Admin user row ID (URL)' },
      { name: 'username',     type: 'String',  required: 'Optional', description: 'New username' },
      { name: 'password',     type: 'String',  required: 'Optional', description: 'New password (re-hashed automatically)' },
      { name: 'email',        type: 'String',  required: 'Optional', description: 'New email' },
      { name: 'role',         type: 'String',  required: 'Optional', description: 'admin | superadmin' },
      { name: 'quick_access', type: 'String',  required: 'Optional', description: 'yes | no' },
    ],
    successCode: '200',
    successResponse: '{ message, data: { ...updatedAdmin } }',
    errorResponse: '400 No fields | 404 Not found | 409 Username exists',
  },
  {
    section: 'Admin',
    method: 'DELETE',
    endpoint: '/api/admin/users/:id',
    description: 'Delete an admin user by ID',
    paramType: 'URL Param',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Admin user row ID' },
    ],
    successCode: '200',
    successResponse: '{ message: "Admin user deleted successfully" }',
    errorResponse: '404 Not found | 500 Database error',
  },

  // ── CUSTOMERS ──
  {
    section: 'Customers',
    method: 'GET',
    endpoint: '/api/customers',
    description: 'Get all customers. Supports keyword search.',
    paramType: 'Query String',
    params: [
      { name: 'search', type: 'String', required: 'Optional', description: 'Search by company, customer number, contact, email or phone' },
    ],
    successCode: '200',
    successResponse: '{ data: [ ...customers ], total: N }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Customers',
    method: 'GET',
    endpoint: '/api/customers/:id',
    description: 'Get a single customer by ID',
    paramType: 'URL Param',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Customer row ID' },
    ],
    successCode: '200',
    successResponse: '{ data: { ...customer } }',
    errorResponse: '404 Not found | 500 Database error',
  },
  {
    section: 'Customers',
    method: 'POST',
    endpoint: '/api/customers',
    description: 'Create a new customer',
    paramType: 'Body (JSON)',
    params: [
      { name: 'customer_number', type: 'String',  required: 'Required', description: 'Unique customer number  e.g. CUST-001' },
      { name: 'company_name',    type: 'String',  required: 'Required', description: 'Company / business name' },
      { name: 'contact_name',    type: 'String',  required: 'Required', description: 'Contact person full name' },
      { name: 'email',           type: 'String',  required: 'Required', description: 'Unique email address' },
      { name: 'phone',           type: 'String',  required: 'Required', description: 'Phone number' },
      { name: 'status',          type: 'String',  required: 'Optional', description: 'active | inactive | vip  (default: active)' },
      { name: 'access_code',     type: 'String',  required: 'Optional', description: 'Login access code (plain text, stored as-is)' },
    ],
    successCode: '201',
    successResponse: '{ message, data: { ...customer } }',
    errorResponse: '400 Missing required fields | 409 Duplicate customer number or email',
  },
  {
    section: 'Customers',
    method: 'PUT',
    endpoint: '/api/customers/:id',
    description: 'Update customer details (partial update supported)',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id',              type: 'Integer', required: 'Required', description: 'Customer row ID (URL)' },
      { name: 'customer_number', type: 'String',  required: 'Optional', description: 'New customer number' },
      { name: 'company_name',    type: 'String',  required: 'Optional', description: 'New company name' },
      { name: 'contact_name',    type: 'String',  required: 'Optional', description: 'New contact person' },
      { name: 'email',           type: 'String',  required: 'Optional', description: 'New email' },
      { name: 'phone',           type: 'String',  required: 'Optional', description: 'New phone' },
      { name: 'status',          type: 'String',  required: 'Optional', description: 'active | inactive | vip' },
      { name: 'access_code',     type: 'String',  required: 'Optional', description: 'New access code' },
    ],
    successCode: '200',
    successResponse: '{ message, data: { ...updatedCustomer } }',
    errorResponse: '400 No fields | 404 Not found | 409 Duplicate',
  },
  {
    section: 'Customers',
    method: 'DELETE',
    endpoint: '/api/customers/:id',
    description: 'Delete a customer by ID',
    paramType: 'URL Param',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Customer row ID' },
    ],
    successCode: '200',
    successResponse: '{ message: "Customer deleted successfully" }',
    errorResponse: '404 Not found | 500 Database error',
  },

  // ── ORDERS ──
  {
    section: 'Orders',
    method: 'GET',
    endpoint: '/api/orders',
    description: 'Get all orders joined with customer info. Supports filters.',
    paramType: 'Query String',
    params: [
      { name: 'status',      type: 'String',  required: 'Optional', description: 'Filter by status: Pending | Confirmed | Ready | Cancelled' },
      { name: 'customer_id', type: 'Integer', required: 'Optional', description: 'Filter by customer ID' },
      { name: 'search',      type: 'String',  required: 'Optional', description: 'Search order_id, color, channel_type, company name' },
      { name: 'quick_access',type: 'String',  required: 'Optional', description: 'Filter by quick_access flag: yes | no' },
    ],
    successCode: '200',
    successResponse: '{ data: [...orders], summary: { total, pending, confirmed, cancelled, ready } }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Orders',
    method: 'GET',
    endpoint: '/api/orders/:id',
    description: 'Get a single order by ID with customer info',
    paramType: 'URL Param',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Order row ID' },
    ],
    successCode: '200',
    successResponse: '{ data: { ...order, company_name, contact_name, email } }',
    errorResponse: '404 Not found | 500 Database error',
  },
  {
    section: 'Orders',
    method: 'POST',
    endpoint: '/api/orders',
    description: 'Create a new order. order_id is auto-generated.',
    paramType: 'Body (JSON)',
    params: [
      { name: 'customer_id',      type: 'Integer', required: 'Required', description: 'ID of the customer placing the order' },
      { name: 'channel_type',     type: 'String',  required: 'Required', description: 'Commercial | Residential' },
      { name: 'color',            type: 'String',  required: 'Required', description: 'Product color e.g. BROWN (AS40)' },
      { name: 'hole_distance',    type: 'String',  required: 'Required', description: 'Hole distance e.g. 8' },
      { name: 'channel_length',   type: 'Float',   required: 'Required', description: 'Length per channel (ft)' },
      { name: 'total_length',     type: 'Float',   required: 'Required', description: 'Total length required (ft)' },
      { name: 'total_pieces',     type: 'Integer', required: 'Required', description: 'Total number of pieces' },
      { name: 'final_length',     type: 'Float',   required: 'Required', description: 'Final confirmed length (ft)' },
      { name: 'order_status',     type: 'String',  required: 'Optional', description: 'Pending | Confirmed | Ready | Cancelled  (default: Pending)' },
      { name: 'additional_notes', type: 'Text',    required: 'Optional', description: 'Any extra notes for the order' },
      { name: 'quick_access',     type: 'String',  required: 'Optional', description: 'yes | no  (default: yes)' },
    ],
    successCode: '201',
    successResponse: '{ message, data: { ...order, company_name, contact_name, email } }',
    errorResponse: '400 Missing required fields | 404 Customer not found | 409 Order ID conflict',
  },
  {
    section: 'Orders',
    method: 'PUT',
    endpoint: '/api/orders/:id',
    description: 'Update order fields (partial update supported)',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id',               type: 'Integer', required: 'Required', description: 'Order row ID (URL)' },
      { name: 'channel_type',     type: 'String',  required: 'Optional', description: 'Commercial | Residential' },
      { name: 'color',            type: 'String',  required: 'Optional', description: 'Product color' },
      { name: 'hole_distance',    type: 'String',  required: 'Optional', description: 'Hole distance' },
      { name: 'channel_length',   type: 'Float',   required: 'Optional', description: 'Length per channel (ft)' },
      { name: 'total_length',     type: 'Float',   required: 'Optional', description: 'Total length (ft)' },
      { name: 'total_pieces',     type: 'Integer', required: 'Optional', description: 'Total pieces' },
      { name: 'final_length',     type: 'Float',   required: 'Optional', description: 'Final length (ft)' },
      { name: 'order_status',     type: 'String',  required: 'Optional', description: 'Pending | Confirmed | Ready | Cancelled' },
      { name: 'additional_notes', type: 'Text',    required: 'Optional', description: 'Order notes' },
      { name: 'quick_access',     type: 'String',  required: 'Optional', description: 'yes | no' },
    ],
    successCode: '200',
    successResponse: '{ message, data: { ...updatedOrder } }',
    errorResponse: '400 No fields | 404 Not found | 500 Database error',
  },
  {
    section: 'Orders',
    method: 'PATCH',
    endpoint: '/api/orders/:id/status',
    description: 'Quickly update only the order status',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id',           type: 'Integer', required: 'Required', description: 'Order row ID (URL)' },
      { name: 'order_status', type: 'String',  required: 'Required', description: 'Pending | Confirmed | Ready | Cancelled' },
    ],
    successCode: '200',
    successResponse: '{ message, data: { ...updatedOrder } }',
    errorResponse: '400 Invalid status | 404 Not found',
  },
  {
    section: 'Orders',
    method: 'PATCH',
    endpoint: '/api/orders/:id/notes',
    description: 'Quickly update only the additional notes',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id',               type: 'Integer', required: 'Required', description: 'Order row ID (URL)' },
      { name: 'additional_notes', type: 'Text',    required: 'Required', description: 'New notes content' },
    ],
    successCode: '200',
    successResponse: '{ message: "Notes updated successfully" }',
    errorResponse: '400 Missing field | 404 Not found',
  },
  {
    section: 'Orders',
    method: 'DELETE',
    endpoint: '/api/orders/:id',
    description: 'Delete an order by ID',
    paramType: 'URL Param',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Order row ID' },
    ],
    successCode: '200',
    successResponse: '{ message: "Order deleted successfully" }',
    errorResponse: '404 Not found | 500 Database error',
  },

  // ── PRODUCTS ──
  {
    section: 'Products',
    method: 'GET',
    endpoint: '/api/products',
    description: 'Get all products (supplier configurations)',
    paramType: 'None',
    params: [],
    successCode: '200',
    successResponse: '{ data: [...products] }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Products',
    method: 'GET',
    endpoint: '/api/products/:id',
    description: 'Get a single product',
    paramType: 'URL Param',
    params: [{ name: 'id', type: 'Integer', required: 'Required', description: 'Product ID' }],
    successCode: '200',
    successResponse: '{ data: { ...product } }',
    errorResponse: '404 Not found | 500 Database error',
  },
  {
    section: 'Products',
    method: 'POST',
    endpoint: '/api/products',
    description: 'Create a new product configuration',
    paramType: 'Body (JSON)',
    params: [
      { name: 'manufacturer', type: 'String', required: 'Required', description: 'Supplier name' },
      { name: 'color', type: 'String', required: 'Required', description: 'Color name' },
      { name: 'color_code', type: 'String', required: 'Required', description: 'Color code' },
      { name: 'full_roll_length', type: 'Float', required: 'Optional', description: 'Length of full roll' },
      { name: 'slits_per_roll', type: 'Integer', required: 'Optional', description: 'Number of slits' },
      { name: 'slitted_roll_length', type: 'Float', required: 'Optional', description: 'Length of slitted roll' },
    ],
    successCode: '201',
    successResponse: '{ message: "Product created", data: { ...product } }',
    errorResponse: '400 Missing fields | 500 Database error',
  },
  {
    section: 'Products',
    method: 'PUT',
    endpoint: '/api/products/:id',
    description: 'Update a product configuration',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Product ID' },
      { name: 'manufacturer', type: 'String', required: 'Optional', description: 'Supplier name' },
      { name: 'color', type: 'String', required: 'Optional', description: 'Color name' },
      { name: 'color_code', type: 'String', required: 'Optional', description: 'Color code' },
      { name: 'full_roll_length', type: 'Float', required: 'Optional', description: 'Length of full roll' },
      { name: 'slits_per_roll', type: 'Integer', required: 'Optional', description: 'Number of slits' },
      { name: 'slitted_roll_length', type: 'Float', required: 'Optional', description: 'Length of slitted roll' },
    ],
    successCode: '200',
    successResponse: '{ message: "Product updated", data: { ...product } }',
    errorResponse: '404 Not found | 500 Database error',
  },
  {
    section: 'Products',
    method: 'DELETE',
    endpoint: '/api/products/:id',
    description: 'Delete a product',
    paramType: 'URL Param',
    params: [{ name: 'id', type: 'Integer', required: 'Required', description: 'Product ID' }],
    successCode: '200',
    successResponse: '{ message: "Product deleted" }',
    errorResponse: '404 Not found | 500 Database error',
  },

  // ── INVENTORY ──
  {
    section: 'Inventory',
    method: 'GET',
    endpoint: '/api/inventory',
    description: 'Get all inventory items, calculated available quantities, and holds',
    paramType: 'None',
    params: [],
    successCode: '200',
    successResponse: '{ data: [...inventoryItems] }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Inventory',
    method: 'GET',
    endpoint: '/api/inventory/:id',
    description: 'Get single inventory item',
    paramType: 'URL Param',
    params: [{ name: 'id', type: 'Integer', required: 'Required', description: 'Inventory ID' }],
    successCode: '200',
    successResponse: '{ data: { ...inventoryItem } }',
    errorResponse: '404 Not found | 500 Database error',
  },
  {
    section: 'Inventory',
    method: 'POST',
    endpoint: '/api/inventory',
    description: 'Create new inventory record',
    paramType: 'Body (JSON)',
    params: [
      { name: 'supplier', type: 'String', required: 'Required', description: 'Supplier name' },
      { name: 'color_name', type: 'String', required: 'Required', description: 'Color name' },
      { name: 'inventory_type', type: 'String', required: 'Required', description: 'Full Roll | Slitted | Ready Channel' },
      { name: 'quantity', type: 'Integer', required: 'Optional', description: 'For rolls' },
      { name: 'size', type: 'Float', required: 'Optional', description: 'For rolls' },
      { name: 'pieces', type: 'Integer', required: 'Optional', description: 'For ready channels' },
      { name: 'length', type: 'Float', required: 'Optional', description: 'For ready channels' },
    ],
    successCode: '201',
    successResponse: '{ message: "Inventory added", data: { ...item } }',
    errorResponse: '400 Missing fields | 500 Database error',
  },
  {
    section: 'Inventory',
    method: 'PUT',
    endpoint: '/api/inventory/:id',
    description: 'Update an inventory record',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Inventory ID' },
      { name: 'supplier', type: 'String', required: 'Optional', description: 'Supplier name' },
      { name: 'color_name', type: 'String', required: 'Optional', description: 'Color name' },
      { name: 'inventory_type', type: 'String', required: 'Optional', description: 'Full Roll | Slitted | Ready Channel' },
      { name: 'quantity', type: 'Integer', required: 'Optional', description: 'For rolls' },
      { name: 'size', type: 'Float', required: 'Optional', description: 'For rolls' },
      { name: 'pieces', type: 'Integer', required: 'Optional', description: 'For ready channels' },
      { name: 'length', type: 'Float', required: 'Optional', description: 'For ready channels' },
    ],
    successCode: '200',
    successResponse: '{ message: "Inventory updated", data: { ...item } }',
    errorResponse: '404 Not found | 500 Database error',
  },
  {
    section: 'Inventory',
    method: 'DELETE',
    endpoint: '/api/inventory/:id',
    description: 'Delete inventory record',
    paramType: 'URL Param',
    params: [{ name: 'id', type: 'Integer', required: 'Required', description: 'Inventory ID' }],
    successCode: '200',
    successResponse: '{ message: "Inventory deleted" }',
    errorResponse: '404 Not found | 500 Database error',
  },

  // ── PRODUCTION ──
  {
    section: 'Production',
    method: 'GET',
    endpoint: '/api/production',
    description: 'Get all production records with nested inventory item details',
    paramType: 'None',
    params: [],
    successCode: '200',
    successResponse: '{ data: [...productionList] }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Production',
    method: 'POST',
    endpoint: '/api/production',
    description: 'Create a production request manually',
    paramType: 'Body (JSON)',
    params: [
      { name: 'production_type', type: 'String', required: 'Required', description: 'General Inventory | Specific Order' },
      { name: 'raw_material_id', type: 'Integer', required: 'Required', description: 'Inventory ID to hold' },
      { name: 'target_state', type: 'String', required: 'Required', description: 'Ready Channel | Slitted' },
      { name: 'qty', type: 'Integer', required: 'Required', description: 'Amount to hold' },
      { name: 'waste_qty', type: 'Float', required: 'Optional', description: 'Estimated waste' },
    ],
    successCode: '201',
    successResponse: '{ message: "Production request created", data: { ...prod } }',
    errorResponse: '400 Missing fields | 500 Database error',
  },
  {
    section: 'Production',
    method: 'POST',
    endpoint: '/api/production/request',
    description: 'Auto-create production requests for an order (Step 1 & Step 2)',
    paramType: 'Body (JSON)',
    params: [
      { name: 'order_id', type: 'String', required: 'Required', description: 'Order ID' },
      { name: 'plan', type: 'Object', required: 'Required', description: 'Satisfaction plan from calculateInventorySatisfaction' },
    ],
    successCode: '201',
    successResponse: '{ message: "Production requests created successfully" }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Production',
    method: 'PATCH',
    endpoint: '/api/production/:id/status',
    description: 'Update production status and manage inventory holds/completions',
    paramType: 'URL Param + Body (JSON)',
    params: [
      { name: 'id', type: 'Integer', required: 'Required', description: 'Production ID' },
      { name: 'status', type: 'String', required: 'Required', description: 'In Progress | Completed | Cancelled' },
    ],
    successCode: '200',
    successResponse: '{ message: "Status updated to Completed" }',
    errorResponse: '500 Database error',
  },
  {
    section: 'Production',
    method: 'DELETE',
    endpoint: '/api/production/:id',
    description: 'Delete a production record and release holds',
    paramType: 'URL Param',
    params: [{ name: 'id', type: 'Integer', required: 'Required', description: 'Production ID' }],
    successCode: '200',
    successResponse: '{ message: "Deleted successfully" }',
    errorResponse: '404 Not found | 500 Database error',
  },
];

// ── Helper: style cell ──────────────────────────────────────────
function styleHeader(cell, bgHex, fgHex = 'FFFFFF') {
  cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgHex } };
  cell.font   = { bold: true, color: { argb: 'FF' + fgHex }, size: 11 };
  cell.border = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function styleCell(cell, bgHex = null, fgHex = '000000', bold = false) {
  if (bgHex) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgHex } };
  cell.font   = { color: { argb: 'FF' + fgHex }, size: 10, bold };
  cell.border = {
    top: { style: 'hair' }, bottom: { style: 'hair' },
    left: { style: 'hair' }, right: { style: 'hair' },
  };
  cell.alignment = { vertical: 'middle', wrapText: true };
}

// ── Sheet 1: Overview ───────────────────────────────────────────
const overview = workbook.addWorksheet('API Overview', {
  views: [{ state: 'frozen', ySplit: 4 }],
  properties: { tabColor: { argb: 'FF1E3A5F' } },
});

overview.columns = [
  { key: 'section',   width: 18 },
  { key: 'method',    width: 10 },
  { key: 'endpoint',  width: 38 },
  { key: 'full_url',  width: 52 },
  { key: 'desc',      width: 50 },
  { key: 'paramType', width: 24 },
  { key: 'success',   width: 10 },
  { key: 'errors',    width: 42 },
];

// Title row
overview.mergeCells('A1:H1');
const titleCell = overview.getCell('A1');
titleCell.value = 'Pixel Tracks Backend — API Documentation';
titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
titleCell.font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
overview.getRow(1).height = 36;

// Base URL row
overview.mergeCells('A2:H2');
const baseCell = overview.getCell('A2');
baseCell.value = `Base URL: ${BASE}`;
baseCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
baseCell.font  = { size: 12, color: { argb: 'FFFFFFFF' }, bold: true };
baseCell.alignment = { vertical: 'middle', horizontal: 'center' };
overview.getRow(2).height = 24;

// Empty spacer
overview.getRow(3).height = 6;

// Column headers
const hdrRow = overview.getRow(4);
hdrRow.height = 28;
['Section', 'Method', 'Endpoint', 'Full URL', 'Description', 'Param Type', 'Success', 'Error Codes'].forEach((h, i) => {
  const cell = hdrRow.getCell(i + 1);
  cell.value = h;
  styleHeader(cell, COLORS.headerBg);
});

let rowIdx = 5;
let lastSection = '';

apis.forEach((api, idx) => {
  if (api.section !== lastSection) {
    // Section separator
    const sRow = overview.getRow(rowIdx++);
    sRow.height = 22;
    overview.mergeCells(`A${rowIdx - 1}:H${rowIdx - 1}`);
    const sCell = sRow.getCell(1);
    sCell.value = `— ${api.section} —`;
    sCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLORS.sectionBg } };
    sCell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    lastSection = api.section;
  }

  const row = overview.getRow(rowIdx++);
  row.height = 20;
  const bg = idx % 2 === 0 ? null : COLORS.rowAlt;
  const methodBg = METHOD_COLORS[api.method] || 'FFFFFF';

  row.getCell(1).value = api.section;
  styleCell(row.getCell(1), bg, '333333');

  row.getCell(2).value = api.method;
  row.getCell(2).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + methodBg.replace('#','') } };
  row.getCell(2).font  = { bold: true, size: 10, color: { argb: 'FF000000' } };
  row.getCell(2).border = { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:'hair'}, right:{style:'hair'} };
  row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };

  row.getCell(3).value = api.endpoint;
  styleCell(row.getCell(3), bg, '1A237E', true);

  row.getCell(4).value = BASE + api.endpoint;
  styleCell(row.getCell(4), bg, '555555');

  row.getCell(5).value = api.description;
  styleCell(row.getCell(5), bg);

  row.getCell(6).value = api.paramType;
  styleCell(row.getCell(6), bg, '555555');

  row.getCell(7).value = api.successCode;
  styleCell(row.getCell(7), 'D4EDDA', '196F3D', true);
  row.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };

  row.getCell(8).value = api.errorResponse;
  styleCell(row.getCell(8), bg, 'C0392B');
});

// ── Sheet 2: Parameters Detail ──────────────────────────────────
const detail = workbook.addWorksheet('Parameters Detail', {
  views: [{ state: 'frozen', ySplit: 4 }],
  properties: { tabColor: { argb: 'FF2E86AB' } },
});

detail.columns = [
  { key: 'section',    width: 18 },
  { key: 'method',     width: 10 },
  { key: 'endpoint',   width: 38 },
  { key: 'paramType',  width: 20 },
  { key: 'paramName',  width: 22 },
  { key: 'dataType',   width: 12 },
  { key: 'required',   width: 12 },
  { key: 'paramDesc',  width: 52 },
];

// Title
detail.mergeCells('A1:H1');
const dTitle = detail.getCell('A1');
dTitle.value = 'Pixel Tracks Backend — Parameters Detail';
dTitle.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
dTitle.font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
dTitle.alignment = { vertical: 'middle', horizontal: 'center' };
detail.getRow(1).height = 36;

detail.mergeCells('A2:H2');
const dBase = detail.getCell('A2');
dBase.value = `Base URL: ${BASE}`;
dBase.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E86AB' } };
dBase.font  = { size: 12, color: { argb: 'FFFFFFFF' }, bold: true };
dBase.alignment = { vertical: 'middle', horizontal: 'center' };
detail.getRow(2).height = 24;
detail.getRow(3).height = 6;

const dHdr = detail.getRow(4);
dHdr.height = 28;
['Section', 'Method', 'Endpoint', 'Param Type', 'Parameter', 'Data Type', 'Required', 'Description'].forEach((h, i) => {
  const cell = dHdr.getCell(i + 1);
  cell.value = h;
  styleHeader(cell, COLORS.headerBg);
});

let dRow = 5;
let dSection = '';

apis.forEach((api, idx) => {
  if (api.section !== dSection) {
    const sRow = detail.getRow(dRow++);
    sRow.height = 22;
    detail.mergeCells(`A${dRow - 1}:H${dRow - 1}`);
    const sCell = sRow.getCell(1);
    sCell.value = `— ${api.section} —`;
    sCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLORS.sectionBg } };
    sCell.font  = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    dSection = api.section;
  }

  const methodBg = METHOD_COLORS[api.method] || 'FFFFFF';

  api.params.forEach((param, pIdx) => {
    const row = detail.getRow(dRow++);
    row.height = 20;
    const bg = idx % 2 === 0 ? null : COLORS.rowAlt;

    row.getCell(1).value = pIdx === 0 ? api.section : '';
    styleCell(row.getCell(1), bg, '333333');

    row.getCell(2).value = pIdx === 0 ? api.method : '';
    if (pIdx === 0) {
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + methodBg } };
      row.getCell(2).font = { bold: true, size: 10 };
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(2).border = { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:'hair'}, right:{style:'hair'} };
    } else {
      styleCell(row.getCell(2), bg);
    }

    row.getCell(3).value = pIdx === 0 ? api.endpoint : '';
    styleCell(row.getCell(3), bg, '1A237E', pIdx === 0);

    row.getCell(4).value = pIdx === 0 ? api.paramType : '';
    styleCell(row.getCell(4), bg, '555555');

    row.getCell(5).value = param.name;
    styleCell(row.getCell(5), bg, '000000', true);

    row.getCell(6).value = param.type;
    styleCell(row.getCell(6), bg, '555555');

    row.getCell(7).value = param.required;
    styleCell(
      row.getCell(7),
      param.required === 'Required' ? 'FDECEA' : 'EAF7EE',
      param.required === 'Required' ? COLORS.required : COLORS.optional,
      true,
    );
    row.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };

    row.getCell(8).value = param.description;
    styleCell(row.getCell(8), bg);
  });

  // Response row
  const rRow = detail.getRow(dRow++);
  rRow.height = 18;
  rRow.getCell(1).value = '';
  rRow.getCell(2).value = '';
  rRow.getCell(3).value = '';
  rRow.getCell(4).value = 'Success Response';
  styleCell(rRow.getCell(4), 'D4EDDA', '196F3D', true);
  rRow.getCell(5).value = api.successCode + ' OK';
  styleCell(rRow.getCell(5), 'D4EDDA', '196F3D', true);
  detail.mergeCells(`F${dRow - 1}:H${dRow - 1}`);
  rRow.getCell(6).value = api.successResponse;
  styleCell(rRow.getCell(6), 'D4EDDA', '196F3D');

  // Spacer
  dRow++;
});

// ── Save ────────────────────────────────────────────────────────
const outputPath = path.join(__dirname, 'PixelTracks_API_Documentation.xlsx');
await workbook.xlsx.writeFile(outputPath);
console.log(`✅ Excel file saved: ${outputPath}`);
