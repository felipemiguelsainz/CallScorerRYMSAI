/**
 * Seed script: creates minimal and controlled test data.
 * Run with: npm run prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('Admin1234', 12);
  const gestorPassword = await bcrypt.hash('Gestor1234', 12);

  // Clean up legacy demo data created in early scaffolding.
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'gerardo@recuperosymandatos.com',
          'maria@recuperosymandatos.com',
          'carlos@recuperosymandatos.com',
        ],
      },
    },
  });

  await prisma.gestor.deleteMany({
    where: {
      OR: [
        { legajo: { in: ['001', '002', '003'] } },
        { name: { in: ['Gerardo Vicentini', 'María González', 'Carlos Rodríguez'] } },
      ],
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@recuperosymandatos.com' },
    update: {
      username: 'admin',
      password: adminPassword,
      name: 'Usuario Admin de Prueba',
      role: 'ADMIN',
      gestorId: null,
    },
    create: {
      username: 'admin',
      email: 'admin@recuperosymandatos.com',
      password: adminPassword,
      name: 'Usuario Admin de Prueba',
      role: 'ADMIN',
    },
  });

  const gestor = await prisma.gestor.upsert({
    where: { legajo: 'TEST-001' },
    update: {
      name: 'Gestor de Prueba',
      deletedAt: null,
    },
    create: {
      name: 'Gestor de Prueba',
      legajo: 'TEST-001',
    },
  });

  const gestorUser = await prisma.user.upsert({
    where: { email: 'gestor.prueba@recuperosymandatos.com' },
    update: {
      username: 'gestor.prueba',
      password: gestorPassword,
      name: 'Usuario Gestor de Prueba',
      role: 'GESTOR',
      gestorId: gestor.id,
    },
    create: {
      username: 'gestor.prueba',
      email: 'gestor.prueba@recuperosymandatos.com',
      password: gestorPassword,
      name: 'Usuario Gestor de Prueba',
      role: 'GESTOR',
      gestorId: gestor.id,
    },
  });

  console.log('✅ Admin de prueba:', admin.email);
  console.log('✅ Gestor de prueba:', gestor.name, gestor.legajo);
  console.log('✅ Usuario gestor de prueba:', gestorUser.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
