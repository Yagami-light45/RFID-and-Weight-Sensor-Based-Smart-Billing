-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'BILL_GENERATED';
ALTER TYPE "SessionStatus" ADD VALUE 'PAYMENT_PENDING';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "billNumber" TEXT NOT NULL DEFAULT ('BILL-' || substr(md5(random()::text), 1, 10)),
ADD COLUMN     "billStatus" "BillStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "cashierConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "paymentMethod" DROP NOT NULL,
ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING',
ALTER COLUMN "reference" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_billNumber_key" ON "Transaction"("billNumber");
