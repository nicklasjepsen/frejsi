BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Space] ADD [lastPumpAt] DATETIME2,
[pumpFailures] INT NOT NULL CONSTRAINT [Space_pumpFailures_df] DEFAULT 0,
[pumpSource] NVARCHAR(max),
[pumpStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [Space_pumpStatus_df] DEFAULT 'not-configured';

-- AlterTable
ALTER TABLE [dbo].[Meal] ADD [pumpBolusId] NVARCHAR(1000),
[source] NVARCHAR(20);

-- CreateTable
CREATE TABLE [dbo].[PumpBolus] (
    [id] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [sourceId] NVARCHAR(100) NOT NULL,
    [ts] DATETIME2 NOT NULL,
    [units] DECIMAL(5,2) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [carbs] INT,
    [mealDismissed] BIT NOT NULL CONSTRAINT [PumpBolus_mealDismissed_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PumpBolus_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PumpBolus_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PumpBolus_spaceId_sourceId_key] UNIQUE NONCLUSTERED ([spaceId],[sourceId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PumpBolus_spaceId_ts_idx] ON [dbo].[PumpBolus]([spaceId], [ts]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Meal_pumpBolusId_idx] ON [dbo].[Meal]([pumpBolusId]);

-- AddForeignKey
ALTER TABLE [dbo].[Meal] ADD CONSTRAINT [Meal_pumpBolusId_fkey] FOREIGN KEY ([pumpBolusId]) REFERENCES [dbo].[PumpBolus]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PumpBolus] ADD CONSTRAINT [PumpBolus_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

