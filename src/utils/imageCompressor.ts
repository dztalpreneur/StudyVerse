/**
 * Client-side high-fidelity image compression utility.
 * Optimizes high-resolution student calculations, sheets, and textbook images (e.g. from smartphones)
 * down to standard dimensions to bypass API gateway payload limits, speed up upload times,
 * and maintain high accuracy for scientific & equation detection.
 */

export function compressImageIfPossible(
  file: File,
  maxDimension = 1600,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve) => {
    // Fall back to original file reading if it's not a compressable image
    const isImage = file.type && file.type.startsWith("image/");
    if (!isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve((e.target?.result as string) || "");
      };
      reader.onerror = () => {
        resolve("");
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Scale down dimension keeping aspect ratio
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            // No context fallback
            resolve(e.target?.result as string || "");
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // Standardize on image/jpeg for excellent compression ratios on student papers
          const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedDataUrl);
        } catch (canvasErr) {
          console.error("Canvas compression failed, falling back to raw data:", canvasErr);
          resolve(e.target?.result as string || "");
        }
      };
      img.onerror = () => {
        // Fallback on image load error
        resolve(e.target?.result as string || "");
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      resolve("");
    };
    reader.readAsDataURL(file);
  });
}
