BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LiveSubscription] (
    [id] NVARCHAR(64) NOT NULL,
    [deviceSecretHash] NVARCHAR(64) NOT NULL,
    [isDemo] BIT NOT NULL CONSTRAINT [LiveSubscription_isDemo_df] DEFAULT 0,
    [nightscoutHost] NVARCHAR(253),
    [tokenSecretRef] NVARCHAR(200),
    [apnsEnvironment] NVARCHAR(12) NOT NULL,
    [pushToStartToken] NVARCHAR(400),
    [activityPushToken] NVARCHAR(400),
    [activityStartedAt] DATETIME2,
    [deviceToken] NVARCHAR(400),
    [unit] NVARCHAR(8) NOT NULL,
    [language] NVARCHAR(8) NOT NULL,
    [urgentLowMgdl] INT NOT NULL,
    [lowMgdl] INT NOT NULL,
    [highMgdl] INT NOT NULL,
    [urgentHighMgdl] INT NOT NULL,
    [alertsOn] BIT NOT NULL CONSTRAINT [LiveSubscription_alertsOn_df] DEFAULT 0,
    [lastAlertKind] NVARCHAR(10),
    [lastAlertAt] DATETIME2,
    [lastReadingAt] DATETIME2,
    [lastPushAt] DATETIME2,
    [nextCheckAt] DATETIME2 NOT NULL CONSTRAINT [LiveSubscription_nextCheckAt_df] DEFAULT CURRENT_TIMESTAMP,
    [failures] INT NOT NULL CONSTRAINT [LiveSubscription_failures_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LiveSubscription_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [LiveSubscription_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LiveSubscription_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LiveSubscription_nextCheckAt_idx] ON [dbo].[LiveSubscription]([nextCheckAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LiveSubscription_lastSeenAt_idx] ON [dbo].[LiveSubscription]([lastSeenAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

