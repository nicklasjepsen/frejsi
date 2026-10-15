BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Food] (
    [id] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000),
    [name] NVARCHAR(200) NOT NULL,
    [nameSearch] NVARCHAR(200) NOT NULL,
    [carbsPer100g] DECIMAL(5,1),
    [portions] NVARCHAR(max) NOT NULL,
    [barcode] NVARCHAR(14),
    [photoKey] NVARCHAR(200),
    [origin] NVARCHAR(20) NOT NULL,
    [sourceRef] NVARCHAR(64) NOT NULL,
    [verified] BIT NOT NULL CONSTRAINT [Food_verified_df] DEFAULT 0,
    [verifiedBy] NVARCHAR(1000),
    [verifiedAt] DATETIME2,
    [favourite] BIT NOT NULL CONSTRAINT [Food_favourite_df] DEFAULT 0,
    [createdBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Food_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Food_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Food_spaceId_sourceRef_key] UNIQUE NONCLUSTERED ([spaceId],[sourceRef])
);

-- CreateTable
CREATE TABLE [dbo].[Meal] (
    [id] NVARCHAR(1000) NOT NULL,
    [spaceId] NVARCHAR(1000) NOT NULL,
    [ts] DATETIME2 NOT NULL,
    [byUserId] NVARCHAR(1000) NOT NULL,
    [totalCarbs] INT NOT NULL,
    [note] NVARCHAR(500),
    [bolusTs] DATETIME2,
    [photoKey] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Meal_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Meal_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MealItem] (
    [id] NVARCHAR(1000) NOT NULL,
    [mealId] NVARCHAR(1000) NOT NULL,
    [foodId] NVARCHAR(1000),
    [name] NVARCHAR(200) NOT NULL,
    [portionLabel] NVARCHAR(40),
    [grams] DECIMAL(7,2),
    [carbs] INT NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [MealItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Food_spaceId_nameSearch_idx] ON [dbo].[Food]([spaceId], [nameSearch]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Food_spaceId_barcode_idx] ON [dbo].[Food]([spaceId], [barcode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Food_barcode_idx] ON [dbo].[Food]([barcode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Meal_spaceId_ts_idx] ON [dbo].[Meal]([spaceId], [ts]);

-- AddForeignKey
ALTER TABLE [dbo].[Food] ADD CONSTRAINT [Food_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Food] ADD CONSTRAINT [Food_createdBy_fkey] FOREIGN KEY ([createdBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Food] ADD CONSTRAINT [Food_verifiedBy_fkey] FOREIGN KEY ([verifiedBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Meal] ADD CONSTRAINT [Meal_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Meal] ADD CONSTRAINT [Meal_byUserId_fkey] FOREIGN KEY ([byUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MealItem] ADD CONSTRAINT [MealItem_mealId_fkey] FOREIGN KEY ([mealId]) REFERENCES [dbo].[Meal]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MealItem] ADD CONSTRAINT [MealItem_foodId_fkey] FOREIGN KEY ([foodId]) REFERENCES [dbo].[Food]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

