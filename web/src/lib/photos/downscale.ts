const inputTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** Browser decoding applies orientation, including HEIC on Safari. Canvas exports no source metadata. */
export async function downscale(file: File): Promise<Blob> {
  if (!inputTypes.has(file.type)) throw new Error("photo-type");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("photo-type");
    }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("photo-type");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("photo-unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob?.type === "image/jpeg") resolve(blob);
          else reject(new Error("photo-type"));
        },
        "image/jpeg",
        0.82,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
