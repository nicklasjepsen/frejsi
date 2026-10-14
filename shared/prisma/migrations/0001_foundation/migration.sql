BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [avatar] NVARCHAR(1000),
    [simpleMode] BIT NOT NULL CONSTRAINT [User_simpleMode_df] DEFAULT 0,
    [accent] NVARCHAR(1000) NOT NULL CONSTRAINT [User_accent_df] DEFAULT 'olive',
    [locale] NVARCHAR(1000) NOT NULL CONSTRAINT [User_locale_df] DEFAULT 'da',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeen] DATETIME2,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Space] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [subjectUserId] NVARCHAR(1000),
    [timezone] NVARCHAR(1000) NOT NULL,
    [glucoseUnit] NVARCHAR(1000) NOT NULL CONSTRAINT [Space_glucoseUnit_df] DEFAULT 'mmol',
    [targetLow] DECIMAL(4,1) NOT NULL CONSTRAINT [Space_targetLow_df] DEFAULT 4.0,
    [targetHigh] DECIMAL(4,1) NOT NULL CONSTRAINT [Space_targetHigh_df] DEFAULT 10.0,
    [glucoseSource] NVARCHAR(max),
    [sourceStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [Space_sourceStatus_df] DEFAULT 'not-configured',
    [sourceFailures] INT NOT NULL CONSTRAINT [Space_sourceFailures_df] DEFAULT 0,
    [lastReadingAt] DATETIME2,
    [lastSeq] INT NOT NULL CONSTRAINT [Space_lastSeq_df] DEFAULT 0,
    [aiEnabled] BIT NOT NULL CONSTRAINT [Space_aiEnabled_df] DEFAULT 0,
    [aiProvider] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Space_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Space_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Membership] (
    [userId] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Membership_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Membership_pkey] PRIMARY KEY CLUSTERED ([userId],[spaceId])
);

-- CreateTable
CREATE TABLE [dbo].[Invite] (
    [token] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [forUserId] NVARCHAR(1000),
    [createdBy] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Invite_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [usedAt] DATETIME2,
    [revokedAt] DATETIME2,
    CONSTRAINT [Invite_pkey] PRIMARY KEY CLUSTERED ([token])
);

-- CreateTable
CREATE TABLE [dbo].[Passkey] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [credentialId] NVARCHAR(512) NOT NULL,
    [publicKey] VARBINARY(max) NOT NULL,
    [counter] INT NOT NULL,
    [transports] NVARCHAR(1000),
    [deviceName] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Passkey_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastUsedAt] DATETIME2,
    CONSTRAINT [Passkey_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Passkey_credentialId_key] UNIQUE NONCLUSTERED ([credentialId])
);

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [passkeyId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [Session_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AuthChallenge] (
    [id] NVARCHAR(1000) NOT NULL,
    [challenge] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [inviteToken] NVARCHAR(1000),
    [userId] NVARCHAR(1000),
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [AuthChallenge_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Reading] (
    [spaceId] NVARCHAR(1000) NOT NULL,
    [ts] DATETIME2 NOT NULL,
    [mmol] DECIMAL(4,1) NOT NULL,
    [trend] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Reading_pkey] PRIMARY KEY CLUSTERED ([spaceId],[ts])
);

-- CreateTable
CREATE TABLE [dbo].[Event] (
    [spaceId] NVARCHAR(1000) NOT NULL,
    [seq] INT NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL,
    [ts] DATETIME2 NOT NULL CONSTRAINT [Event_ts_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Event_pkey] PRIMARY KEY CLUSTERED ([spaceId],[seq])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Membership_spaceId_idx] ON [dbo].[Membership]([spaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Invite_spaceId_idx] ON [dbo].[Invite]([spaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Passkey_userId_idx] ON [dbo].[Passkey]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_passkeyId_idx] ON [dbo].[Session]([passkeyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Event_spaceId_ts_idx] ON [dbo].[Event]([spaceId], [ts]);

-- AddForeignKey
ALTER TABLE [dbo].[Space] ADD CONSTRAINT [Space_subjectUserId_fkey] FOREIGN KEY ([subjectUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Invite] ADD CONSTRAINT [Invite_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Invite] ADD CONSTRAINT [Invite_createdBy_fkey] FOREIGN KEY ([createdBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Invite] ADD CONSTRAINT [Invite_forUserId_fkey] FOREIGN KEY ([forUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Passkey] ADD CONSTRAINT [Passkey_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Session] ADD CONSTRAINT [Session_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Session] ADD CONSTRAINT [Session_passkeyId_fkey] FOREIGN KEY ([passkeyId]) REFERENCES [dbo].[Passkey]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Reading] ADD CONSTRAINT [Reading_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

