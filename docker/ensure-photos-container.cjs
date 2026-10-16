// Creates the private "photos" container in Azurite (the Azure deployment creates it in Bicep).
// Idempotent. Prints nothing but one status line: never the connection string or an SDK error.
const { BlobServiceClient } = require("@azure/storage-blob");

async function main() {
  const connection = process.env.BLOB_CONNECTION_STRING;
  if (!connection) {
    console.log("photos: BLOB_CONNECTION_STRING is empty, skipping the container");
    return;
  }
  const container = BlobServiceClient.fromConnectionString(connection, {
    retryOptions: { maxTries: 1 },
  }).getContainerClient("photos");
  for (let attempt = 1; ; attempt += 1) {
    try {
      await container.createIfNotExists();
      console.log("photos: container ready");
      return;
    } catch {
      if (attempt >= 30) throw new Error("photos: Azurite did not answer");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "photos: failed");
  process.exit(1);
});
