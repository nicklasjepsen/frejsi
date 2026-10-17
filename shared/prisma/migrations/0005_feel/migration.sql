BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Space] ADD [symptomKinds] NVARCHAR(max) NOT NULL CONSTRAINT [Space_symptomKinds_df] DEFAULT '[]';

-- AlterTable
ALTER TABLE [dbo].[Food] ADD [category] NVARCHAR(20),
[recipe] NVARCHAR(max);

-- AlterTable
ALTER TABLE [dbo].[Meal] ADD [symbol] NVARCHAR(20);

-- CreateTable
CREATE TABLE [dbo].[Symptom] (
    [id] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [ts] DATETIME2 NOT NULL,
    [byUserId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(40) NOT NULL,
    [severity] NVARCHAR(10),
    [note] NVARCHAR(500),
    [resolvedTs] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Symptom_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Symptom_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Symptom_spaceId_ts_idx] ON [dbo].[Symptom]([spaceId], [ts]);

-- AddForeignKey
ALTER TABLE [dbo].[Symptom] ADD CONSTRAINT [Symptom_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Symptom] ADD CONSTRAINT [Symptom_byUserId_fkey] FOREIGN KEY ([byUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

