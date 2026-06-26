/**
 * Seed script — creates the first admin account in the database.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts
 *
 * This will create an admin user with:
 *   username: admin
 *   password: admin123
 *
 * Change the password after first login!
 */

import bcrypt from 'bcrypt';
import pg from 'pg';
import { config } from '../src/config/index.js';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_DISPLAY_NAME = 'System Admin';

async function seed() {
  console.log('🔧 Connecting to database...');

  const client = new pg.Client({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Check if admin already exists
    const existing = await client.query(
      'SELECT id FROM users WHERE username = $1',
      [ADMIN_USERNAME]
    );

    if (existing.rows.length > 0) {
      console.log('⚠️  Admin user already exists. Skipping.');
      return;
    }

    // Hash password
    console.log('🔐 Hashing password...');
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);

    // Insert admin user
    await client.query(
      `INSERT INTO users (username, password, role, display_name)
       VALUES ($1, $2, 'admin', $3)`,
      [ADMIN_USERNAME, hashedPassword, ADMIN_DISPLAY_NAME]
    );

    console.log('');
    console.log('✅ Admin account created successfully!');
    console.log('');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('');
    console.log('   ⚠️  Change this password after first login!');
    console.log('');
  } catch (error) {
    console.error('❌ Failed to seed admin user:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
