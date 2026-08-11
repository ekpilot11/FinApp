// Getting a phone screenshot into a shape worth sending.
//
// A raw iPhone screenshot is around 1290×2796 and a couple of megabytes; as
// base64 that is a several-megabyte upload over whatever signal you have in a
// shop doorway. Anthropic scales anything larger than 1568px on the long edge
// down before looking at it, so sending the full thing costs upload time and
// buys nothing.
//
// Browser-only by nature — canvas and ImageBitmap have no Node equivalent
// here — so this file stays small and everything it feeds is tested in
// `vision.js` instead.

/** Anthropic's long edge. Past this the service downsizes it anyway. */
const MAX_EDGE = 1568;

/**
 * JPEG rather than PNG, but not by much: screenshots are text on flat colour,
 * which is exactly what JPEG smears. 0.92 keeps the decimals in "R$ 12,90"
 * crisp and still lands well under a megabyte.
 */
const QUALITY = 0.92;

/** 25 MB. A "photo" past this is a screen recording or a burst, not a receipt. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * @param {File|Blob} file
 * @returns {Promise<{base64: string, mediaType: string, width: number, height: number}>}
 */
export async function prepareScreenshot(file) {
  if (!file) throw new Error('No image chosen.');
  if (file.size > MAX_BYTES) {
    throw new Error('That file is too large to send. Take a screenshot rather than a recording.');
  }

  const source = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  // Screenshots are usually shrunk, and the default nearest-ish path turns
  // small type into noise.
  context.imageSmoothingQuality = 'high';
  // JPEG has no transparency; without this, transparent pixels come out black
  // and dark-mode banners lose their text.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('This browser could not read that image.');

  return { base64: await toBase64(blob), mediaType: 'image/jpeg', width, height };
}

/**
 * `createImageBitmap` where it exists — it honours the EXIF rotation an iPhone
 * writes, which an `<img>` in a canvas does not, so a sideways screenshot
 * stays sideways rather than being read at right angles.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* HEIC on a browser that cannot decode it: fall through and let the
         <img> path produce the real error message. */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This browser could not open that image.'));
      image.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Base64 via FileReader rather than `btoa` over a byte string: a megabyte of
 * pixels pushed through `String.fromCharCode(...bytes)` blows the argument
 * limit, and doing it a byte at a time locks the main thread.
 */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('This browser could not read that image.'));
    reader.readAsDataURL(blob);
  });
}
