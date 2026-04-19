// prisma/seed-simple.js
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import prisma, { disconnectDatabase } from '../src/config/database.js';
import seedPermissions from './seed-permissions.js';

dotenv.config();

async function seedSuperAdmin() {
  try {
    console.log('Seeding Super Admin...');

    // 1. Seed permissions first
    await seedPermissions();

    // 2. Check for the Role first (Super Admin is a System Role, so companyId is NULL)
    let superAdminRole = await prisma.role.findFirst({
      where: {
        name: 'Super Administrator',
        isSystemAdmin: true,
        companyId: null,
      },
    });

    // 3. Create the role if it doesn't exist
    if (!superAdminRole) {
      console.log('Creating Super Admin Role...');
      superAdminRole = await prisma.role.create({
        data: {
          name: 'Super Administrator',
          description: 'System super administrator with full access',
          isSystemAdmin: true,
          companyId: null,
        },
      });

      // 4. Assign ALL permissions to Super Admin role
      const allPermissions = await prisma.permission.findMany();

      for (const permission of allPermissions) {
        await prisma.rolePermission.create({
          data: {
            roleId: superAdminRole.id,
            permissionId: permission.id,
          },
        });
      }

      console.log(
        `✅ Assigned ${allPermissions.length} permissions to Super Admin role`
      );
    }

    // 5. Check if Super Admin User already exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: {
        userType: 'SUPER_ADMIN',
      },
    });

    if (existingSuperAdmin) {
      console.log('Super Admin user already exists');
      console.log(`Phone: ${existingSuperAdmin.phone}`);
      console.log(`Email: ${existingSuperAdmin.email}`);
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('Admin@123', 10);

    // In the super admin creation section, update:
    const superAdmin = await prisma.user.create({
      data: {
        phone: '8779032050',
        email: 'superadmin@gmail.com',
        password: hashedPassword,
        name: 'Super Administrator',
        userType: 'SUPER_ADMIN',
        employeeId: 'SA001',
        designation: 'System Administrator',
        department: 'IT',
        employeeStatus: 'ACTIVE',
        defaultLocation: 'OFFICE',
        isActive: true,
        roleId: superAdminRole.id,
        // Add verification flags for super admin
        emailVerified: true,
        phoneVerified: true,
        accountSetupCompleted: true,
        accountSetupCompletedAt: new Date(),
      },
    });

    console.log('✅ Super Admin created successfully:');
    console.log(`Phone: ${superAdmin.phone}`);
    console.log(`Email: ${superAdmin.email}`);
    console.log('Password: Admin@123');
  } catch (error) {
    console.error('Error seeding Super Admin:', error);
    process.exit(1);
  }
}

async function main() {
  try {
    await seedSuperAdmin();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

main();
