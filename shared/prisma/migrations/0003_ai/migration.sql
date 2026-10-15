BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Food] ADD [embedding] vector(1024),
[embeddingModel] NVARCHAR(80),
[sourceName] NVARCHAR(200);

-- CreateTable
CREATE TABLE [dbo].[AiCall] (
    [id] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000),
    [userId] NVARCHAR(1000),
    [kind] NVARCHAR(20) NOT NULL,
    [use] NVARCHAR(20) NOT NULL,
    [provider] NVARCHAR(20) NOT NULL,
    [model] NVARCHAR(80) NOT NULL,
    [ok] BIT NOT NULL,
    [ms] INT NOT NULL,
    [ts] DATETIME2 NOT NULL CONSTRAINT [AiCall_ts_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AiCall_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Insight] (
    [id] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(10) NOT NULL,
    [subjectKey] NVARCHAR(40) NOT NULL,
    [statsHash] NVARCHAR(64) NOT NULL,
    [text] NVARCHAR(1000) NOT NULL,
    [questions] NVARCHAR(max),
    [questionsEdited] BIT NOT NULL CONSTRAINT [Insight_questionsEdited_df] DEFAULT 0,
    [rejectedCount] INT NOT NULL CONSTRAINT [Insight_rejectedCount_df] DEFAULT 0,
    [provider] NVARCHAR(20) NOT NULL,
    [model] NVARCHAR(80) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Insight_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Insight_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Insight_spaceId_kind_subjectKey_key] UNIQUE NONCLUSTERED ([spaceId],[kind],[subjectKey])
);

-- CreateTable
CREATE TABLE [dbo].[PushSubscription] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [sessionId] NVARCHAR(1000) NOT NULL,
    [endpoint] NVARCHAR(1000) NOT NULL,
    [p256dh] NVARCHAR(200) NOT NULL,
    [auth] NVARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PushSubscription_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastUsedAt] DATETIME2,
    [failures] INT NOT NULL CONSTRAINT [PushSubscription_failures_df] DEFAULT 0,
    CONSTRAINT [PushSubscription_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PushSubscription_userId_endpoint_key] UNIQUE NONCLUSTERED ([userId],[endpoint])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiCall_spaceId_ts_idx] ON [dbo].[AiCall]([spaceId], [ts]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PushSubscription_sessionId_idx] ON [dbo].[PushSubscription]([sessionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PushSubscription_spaceId_idx] ON [dbo].[PushSubscription]([spaceId]);

-- AddForeignKey
ALTER TABLE [dbo].[AiCall] ADD CONSTRAINT [AiCall_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AiCall] ADD CONSTRAINT [AiCall_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Insight] ADD CONSTRAINT [Insight_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PushSubscription] ADD CONSTRAINT [PushSubscription_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PushSubscription] ADD CONSTRAINT [PushSubscription_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PushSubscription] ADD CONSTRAINT [PushSubscription_sessionId_fkey] FOREIGN KEY ([sessionId]) REFERENCES [dbo].[Session]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

