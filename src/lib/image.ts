// Photo preparation: decode with EXIF orientation applied, cap the long side and re-encode as JPEG.
// This bakes the phone's rotation into the pixels (servers often ignore EXIF) and turns HEIC (where the
// browser can decode it, e.g. iOS Safari) into JPEG.

export const PHOTO_MAX_LONG = 1920;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

function loadImg(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("this browser cannot decode the image (try JPEG or PNG)"));
    };
    img.src = url;
  });
}

export async function prepareImage(file: Blob, maxLong = PHOTO_MAX_LONG, quality = 0.88): Promise<PreparedImage> {
  let src: ImageBitmap | HTMLImageElement;
  let sw: number;
  let sh: number;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    src = bmp;
    sw = bmp.width;
    sh = bmp.height;
  } catch {
    const img = await loadImg(file); // <img> applies EXIF orientation by default
    src = img;
    sw = img.naturalWidth;
    sh = img.naturalHeight;
  }
  const s = Math.min(1, maxLong / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s));
  const h = Math.max(1, Math.round(sh * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D not available");
  ctx.drawImage(src, 0, 0, w, h);
  if ("close" in src) src.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode JPEG"))), "image/jpeg", quality),
  );
  if (blob.size > PHOTO_MAX_BYTES) throw new Error("photo is larger than 10 MB after compression");
  return { blob, url: URL.createObjectURL(blob), width: w, height: h, sourceWidth: sw, sourceHeight: sh };
}
