import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    rfidTag: "E2MILK001",
    name: "Amul Milk 500ml",
    price: 28,
    expectedWeight: 520,
    weightTolerance: 15,
  },
  {
    rfidTag: "E2BREAD01",
    name: "Whole Wheat Bread",
    price: 45,
    expectedWeight: 400,
    weightTolerance: 15,
  },
  {
    rfidTag: "E2RICE001",
    name: "Basmati Rice 1kg",
    price: 120,
    expectedWeight: 1000,
    weightTolerance: 15,
  },
  {
    rfidTag: "E2EGGS001",
    name: "Eggs 6 pack",
    price: 72,
    expectedWeight: 360,
    weightTolerance: 20,
  },
  {
    rfidTag: "E2OIL0001",
    name: "Sunflower Oil 1L",
    price: 160,
    expectedWeight: 920,
    weightTolerance: 15,
  },
];

const carts = ["CART_01", "CART_02", "CART_03"];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { rfidTag: product.rfidTag },
      update: {
        name: product.name,
        price: product.price,
        expectedWeight: product.expectedWeight,
        weightTolerance: product.weightTolerance,
      },
      create: product,
    });
  }

  for (const cartId of carts) {
    await prisma.cart.upsert({
      where: { cartId },
      update: {},
      create: { cartId },
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
