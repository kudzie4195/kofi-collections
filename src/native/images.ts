/**
 * Image intake. Every image is re-encoded through a canvas, which drops EXIF,
 * GPS and other embedded metadata (the guide flags ineffective EXIF removal as
 * a known hazard in the original scaffold). Oversized and unsupported files are
 * rejected before decoding.
 */

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_EDGE_PX = 1800;

export class ImageIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageIntakeError';
  }
}

export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
  metadataStripped: true;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new ImageIntakeError('Use a JPG, PNG, WebP or HEIC image.');
  }
  if (file.size > MAX_IMAGE_INPUT_BYTES) throw new ImageIntakeError('Images must be under 20 MB.');

  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageIntakeError('Could not process the image on this device.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ('close' in bitmap) (bitmap as ImageBitmap).close();
  // JPEG re-encode: no EXIF/GPS/ICC chunks are written by the canvas encoder.
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  return { dataUrl, width: w, height: h, metadataStripped: true };
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through to <img> decoding (older WebViews) */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageIntakeError('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file.'));
    r.readAsDataURL(file);
  });
}
