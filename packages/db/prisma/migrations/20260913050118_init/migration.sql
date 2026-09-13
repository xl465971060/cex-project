-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `region` VARCHAR(191) NULL,
    `inviteCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSecurity` (
    `uid` VARCHAR(191) NOT NULL,
    `totpSecretEnc` VARCHAR(191) NULL,
    `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    `whitelistEnabled` BOOLEAN NOT NULL DEFAULT false,
    `forbiddenUntil` DATETIME(3) NULL,

    PRIMARY KEY (`uid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Kyc` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `realName` VARCHAR(191) NOT NULL,
    `idHash` VARCHAR(191) NOT NULL,
    `idNumberEnc` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `rejectReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Kyc_uid_key`(`uid`),
    UNIQUE INDEX `Kyc_idHash_key`(`idHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DepositAddress` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `chain` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `hdPath` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `DepositAddress_uid_coin_chain_key`(`uid`, `coin`, `chain`),
    UNIQUE INDEX `DepositAddress_chain_address_key`(`chain`, `address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Deposit` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(191) NOT NULL,
    `chain` VARCHAR(191) NOT NULL,
    `amount` BIGINT NOT NULL,
    `txid` VARCHAR(191) NOT NULL,
    `logIndex` INTEGER NOT NULL DEFAULT 0,
    `confirmations` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DETECTED',
    `creditedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Deposit_uid_createdAt_idx`(`uid`, `createdAt`),
    UNIQUE INDEX `Deposit_txid_logIndex_key`(`txid`, `logIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Withdraw` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(191) NOT NULL,
    `chain` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `amount` BIGINT NOT NULL,
    `fee` BIGINT NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_REVIEW',
    `txid` VARCHAR(191) NULL,
    `rejectReason` VARCHAR(191) NULL,
    `auditor1` VARCHAR(191) NULL,
    `auditor2` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Withdraw_uid_createdAt_idx`(`uid`, `createdAt`),
    INDEX `Withdraw_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Asset` (
    `uid` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(191) NOT NULL,
    `available` BIGINT NOT NULL DEFAULT 0,
    `frozen` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`uid`, `coin`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetFlow` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(191) NOT NULL,
    `bizNo` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `delta` BIGINT NOT NULL,
    `balanceAfter` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssetFlow_bizNo_key`(`bizNo`),
    INDEX `AssetFlow_uid_createdAt_idx`(`uid`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `clientOrderId` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `pair` VARCHAR(191) NOT NULL,
    `side` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `price` BIGINT NULL,
    `amount` BIGINT NOT NULL,
    `quoteAmount` BIGINT NULL,
    `filled` BIGINT NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACCEPTED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_clientOrderId_key`(`clientOrderId`),
    INDEX `Order_uid_createdAt_idx`(`uid`, `createdAt`),
    INDEX `Order_pair_status_idx`(`pair`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trade` (
    `id` VARCHAR(191) NOT NULL,
    `pair` VARCHAR(191) NOT NULL,
    `seq` BIGINT NOT NULL,
    `takerOrderId` VARCHAR(191) NOT NULL,
    `makerOrderId` VARCHAR(191) NOT NULL,
    `price` BIGINT NOT NULL,
    `amount` BIGINT NOT NULL,
    `takerFee` BIGINT NOT NULL DEFAULT 0,
    `makerFee` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Trade_pair_seq_key`(`pair`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PairConfig` (
    `pair` VARCHAR(191) NOT NULL,
    `baseCoin` VARCHAR(191) NOT NULL,
    `quoteCoin` VARCHAR(191) NOT NULL,
    `basePrecision` INTEGER NOT NULL,
    `quotePrecision` INTEGER NOT NULL,
    `minAmount` BIGINT NOT NULL,
    `minNotional` BIGINT NOT NULL,
    `makerFeeRateBp` INTEGER NOT NULL,
    `takerFeeRateBp` INTEGER NOT NULL,
    `tradingEnabled` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`pair`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChainConfig` (
    `id` VARCHAR(191) NOT NULL,
    `chain` VARCHAR(191) NOT NULL,
    `coin` VARCHAR(191) NOT NULL,
    `minDeposit` BIGINT NOT NULL,
    `minWithdraw` BIGINT NOT NULL,
    `withdrawFee` BIGINT NOT NULL,
    `confirmations` INTEGER NOT NULL,
    `depositEnabled` BOOLEAN NOT NULL DEFAULT false,
    `withdrawEnabled` BOOLEAN NOT NULL DEFAULT false,
    `hotWalletAddress` VARCHAR(191) NULL,
    `hotWalletLimit` BIGINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `ChainConfig_chain_coin_key`(`chain`, `coin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `target` VARCHAR(191) NOT NULL,
    `before` VARCHAR(191) NULL,
    `after` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_adminId_createdAt_idx`(`adminId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityEvent` (
    `id` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityEvent_uid_type_createdAt_idx`(`uid`, `type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WalletCursor` (
    `chain` VARCHAR(191) NOT NULL,
    `scannedBlock` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`chain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserSecurity` ADD CONSTRAINT `UserSecurity_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Kyc` ADD CONSTRAINT `Kyc_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deposit` ADD CONSTRAINT `Deposit_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Withdraw` ADD CONSTRAINT `Withdraw_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityEvent` ADD CONSTRAINT `SecurityEvent_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
