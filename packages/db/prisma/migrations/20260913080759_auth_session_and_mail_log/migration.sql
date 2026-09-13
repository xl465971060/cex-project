/*
  Warnings:

  - You are about to drop the column `inviteCode` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `SecurityEvent` ADD COLUMN `userAgent` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `inviteCode`,
    ADD COLUMN `invitedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `UserSecurity` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `MailLog` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NULL,
    `to` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `MailLog_to_type_createdAt_idx`(`to`, `type`, `createdAt`),
    INDEX `MailLog_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
