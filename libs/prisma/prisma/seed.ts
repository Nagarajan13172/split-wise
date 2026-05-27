import { PrismaClient } from '@prisma/client';
import { CURRENCIES, CATEGORIES } from '../../../packages/shared/src/constants/index.js';

const prisma = new PrismaClient();

async function main() {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, symbol: c.symbol, decimals: c.decimals },
      create: { code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals },
    });
  }

  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { key: cat.key },
      update: { label: cat.label, icon: cat.icon, parent: cat.parent ?? null },
      create: { key: cat.key, label: cat.label, icon: cat.icon, parent: cat.parent ?? null },
    });
  }

  console.log(`Seeded ${CURRENCIES.length} currencies and ${CATEGORIES.length} categories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
