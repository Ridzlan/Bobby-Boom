/**
 * Prepare a SMALL copy for /api/process. Never mutates the original File.
 * Server infers MIME from file.name, so converted PNG/JPEG must be sent with
 * a .jpg extension; sourceFile is restored to the ORIGINAL name in App.jsx.
 */
const MAX_AI_BYTES = 2_350_000; // ~3.14 MB base64, with headroom below Vercel's 4.5MB body limit
const IMAGE_EXT = /\.(?:png|jpe?g)$/i;

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Cannot read optimized receipt'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Cannot encode optimized receipt')),
      'image/jpeg', quality
    );
  });
}

async function openImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = resolve;
      img.onerror = () => reject(new Error('Cannot open receipt image'));
    });
    return img;
  } finally {
    // Safe to revoke after the load event because the decoded image remains in memory.
    URL.revokeObjectURL(url);
  }
}

/** Output: {name,base64}. Original 'file' remains unchanged for storage. */
export async function prepareReceiptForAI(file) {
  if (!IMAGE_EXT.test(file.name)) {
    // PDFs cannot be resized using the browser image canvas.
    if (!/\.pdf$/i.test(file.name)) throw new Error(`Unsupported file type: ${file.name}`);
    if (file.size > MAX_AI_BYTES) {
      throw new Error(`PDF ${file.name} is too large for the AI request. Reduce the PDF size first.`);
    }
    return { name: file.name, base64: await toBase64(file) };
  }

  const image = await openImage(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new Error(`Invalid receipt image: ${file.name}`);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Image optimization is unavailable in this browser');

  // 2000px preserves reasonably legible receipt text; progressively try smaller
  // copies when needed rather than sending an oversized request to Vercel.
  const passes = [
    [2000, 0.86], [1800, 0.82], [1600, 0.77],
    [1400, 0.72], [1200, 0.67], [1000, 0.60]
  ];
  for (const [longEdge, quality] of passes) {
    const scale = Math.min(1, longEdge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvasBlob(canvas, quality);
    if (jpeg.size <= MAX_AI_BYTES) {
      return {
        name: file.name.replace(IMAGE_EXT, '.jpg'),
        base64: await toBase64(jpeg)
      };
    }
  }
  throw new Error(`Receipt ${file.name} could not be reduced below the AI upload limit.`);
}
