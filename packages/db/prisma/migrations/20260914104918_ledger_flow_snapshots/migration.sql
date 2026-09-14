/*
  Warnings:

  - You are about to drop the column `balanceAfter` on the `AssetFlow` table. All the data in the column will be lost.
  - You are about to drop the column `delta` on the `AssetFlow` table. All the data in the column will be lost.
  - Added the required column `availAfter` to the `AssetFlow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `availBefore` to the `AssetFlow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `availDelta` to the `AssetFlow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `frozenAfter` to the `AssetFlow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `frozenBefore` to the `AssetFlow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `frozenDelta` to the `AssetFlow` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `AssetFlow` DROP COLUMN `balanceAfter`,
    DROP COLUMN `delta`,
    ADD COLUMN `availAfter` BIGINT NOT NULL,
    ADD COLUMN `availBefore` BIGINT NOT NULL,
    ADD COLUMN `availDelta` BIGINT NOT NULL,
    ADD COLUMN `frozenAfter` BIGINT NOT NULL,
    ADD COLUMN `frozenBefore` BIGINT NOT NULL,
    ADD COLUMN `frozenDelta` BIGINT NOT NULL,
    ADD COLUMN `ref` VARCHAR(191) NULL;
