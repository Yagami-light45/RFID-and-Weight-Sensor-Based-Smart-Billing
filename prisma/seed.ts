import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    rfidUid: "E2MILK001",
    name: "Amul Milk 500ml",
    price: new Prisma.Decimal(28),
    expectedWeight: 520,
    weightTolerance: 15,
    isAvailable: true,
  },
  {
    rfidUid: "E2BREAD01",
    name: "Whole Wheat Bread",
    price: new Prisma.Decimal(45),
    expectedWeight: 400,
    weightTolerance: 15,
    isAvailable: true,
  },
  {
    rfidUid: "E2RICE001",
    name: "Basmati Rice 1kg",
    price: new Prisma.Decimal(120),
    expectedWeight: 1000,
    weightTolerance: 15,
    isAvailable: true,
  },
  {
    rfidUid: "E2EGGS001",
    name: "Eggs 6 pack",
    price: new Prisma.Decimal(72),
    expectedWeight: 360,
    weightTolerance: 20,
    isAvailable: true,
  },
  {
    rfidUid: "E2OIL0001",
    name: "Sunflower Oil 1L",
    price: new Prisma.Decimal(160),
    expectedWeight: 920,
    weightTolerance: 15,
    isAvailable: true,
  },
];

const carts = ["CART_01", "CART_02", "CART_03"];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { rfidUid: product.rfidUid },
      update: {
        name: product.name,
        price: product.price,
        expectedWeight: product.expectedWeight,
        weightTolerance: product.weightTolerance,
        isAvailable: product.isAvailable,
      },
      create: product,
    });
  }

  for (const cartId of carts) {
    await prisma.cart.upsert({
      where: { cartId },
      update: {},
      create: {
        cartId,
        cartCode: cartId,
        operationalStatus: "ACTIVE",
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
