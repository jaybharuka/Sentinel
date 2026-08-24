-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Merchant" ("createdAt", "email", "id", "name", "password")
SELECT "createdAt", "email", "id", "name", '$2b$10$wPX0DL4w2n96RSjELkemtOOGEgkuzTC1qf70I2tznTRB0UU0Qpwtq' FROM "Merchant";
DROP TABLE "Merchant";
ALTER TABLE "new_Merchant" RENAME TO "Merchant";
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
