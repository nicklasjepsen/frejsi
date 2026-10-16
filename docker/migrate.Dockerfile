# The one-shot migrate service: `prisma migrate deploy` from shared/prisma/, then the photos
# container in Azurite (Azure creates it in Bicep). Nothing else is in this image.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Same versions as shared/package.json and the lockfile pins.
RUN npm install --no-audit --no-fund --omit=dev prisma@6.19.3 @azure/storage-blob@12.34.0 \
 && npx prisma --version >/dev/null
COPY shared/prisma ./shared/prisma
COPY docker/ensure-photos-container.cjs ./ensure-photos-container.cjs
RUN chown -R node:node /app
USER node
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
CMD ["sh", "-c", "npx prisma migrate deploy --schema shared/prisma/schema.prisma && node ensure-photos-container.cjs"]
