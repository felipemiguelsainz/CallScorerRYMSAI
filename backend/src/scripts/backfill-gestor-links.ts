import prisma from '../lib/prisma';
import { logger } from '../lib/logger';

function usernameToGestorName(username: string): string {
  return username.replace(/[._-]+/g, ' ').trim();
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      role: 'GESTOR',
      gestorId: null,
    },
    select: {
      id: true,
      username: true,
      name: true,
    },
  });

  if (users.length === 0) {
    logger.info('No hay usuarios GESTOR sin vinculo a gestor.');
    return;
  }

  for (const user of users) {
    const sourceName = user.username ?? user.name;
    const gestor = await prisma.gestor.create({
      data: {
        name: usernameToGestorName(sourceName),
      },
      select: { id: true, name: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { gestorId: gestor.id },
    });

    logger.info(
      { userId: user.id, username: user.username, gestorId: gestor.id, gestorName: gestor.name },
      'Usuario GESTOR vinculado',
    );
  }

  logger.info({ updated: users.length }, 'Backfill de gestores completado');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Error ejecutando backfill de gestores');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
