// Extracted verbatim from SDStudio BrushTool.tsx. See LICENSE-SDSTUDIO.txt.
export function base64ToDataUri(data: string) {
  return 'data:image/png;base64,' + data;
}

export function getImageDimensions(
  base64: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.width;
      const height = img.height;
      resolve({ width, height });
    };
    img.onerror = reject;
    img.src = base64ToDataUri(base64);
  });
}

export function maskToBase64(
  image: ImageData,
  width: number,
  height: number,
): string {
  const bitmap = new Uint8ClampedArray(image.data);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < bitmap.length; i += 4) {
    const r = bitmap[i];
    const g = bitmap[i + 1];
    const b = bitmap[i + 2];

    if (r !== 0 || g !== 0 || b !== 0) {
      bitmap[i] = 255;
      bitmap[i + 1] = 255;
      bitmap[i + 2] = 255;
      bitmap[i + 3] = 255;
    } else {
      bitmap[i] = 0;
      bitmap[i + 1] = 0;
      bitmap[i + 2] = 0;
      bitmap[i + 3] = 255;
    }
  }

  const imageData = new ImageData(bitmap, width, height);

  ctx.putImageData(imageData, 0, 0);

  const dataURL = canvas.toDataURL('image/png');

  const base64String = dataURL.split(',')[1];

  return base64String;
}

const CHUNK_SIZE = 8;

// Helper functions for chunk-based drawing
function getChunkCoordinates(x: number, y: number) {
  return {
    chunkX: Math.floor(x / CHUNK_SIZE),
    chunkY: Math.floor(y / CHUNK_SIZE),
  };
}

function drawChunk(
  ctx: CanvasRenderingContext2D,
  chunkX: number,
  chunkY: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(
    chunkX * CHUNK_SIZE,
    chunkY * CHUNK_SIZE,
    CHUNK_SIZE,
    CHUNK_SIZE,
  );
}

function getChunksInBrush(x: number, y: number, brushSize: number) {
  const chunks = new Set<string>();
  const centerChunk = getChunkCoordinates(x, y);
  const brushRadius = brushSize;
  const chunkRadius = Math.ceil(brushRadius / CHUNK_SIZE);

  for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
    for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
      const chunkX = centerChunk.chunkX + dx;
      const chunkY = centerChunk.chunkY + dy;

      // Calculate distance from brush center to chunk center
      const chunkCenterX = (chunkX + 0.5) * CHUNK_SIZE;
      const chunkCenterY = (chunkY + 0.5) * CHUNK_SIZE;
      const distance = Math.hypot(chunkCenterX - x, chunkCenterY - y);

      if (distance <= brushRadius) {
        chunks.add(`${chunkX},${chunkY}`);
      }
    }
  }

  return Array.from(chunks).map((key) => {
    const [chunkX, chunkY] = key.split(',').map(Number);
    return { chunkX, chunkY };
  });
}

function getChunksBetween(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  brushSize: number,
) {
  const chunks = new Set<string>();
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(dist / (CHUNK_SIZE / 2));

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;

    const brushChunks = getChunksInBrush(x, y, brushSize);
    brushChunks.forEach(({ chunkX, chunkY }) => {
      chunks.add(`${chunkX},${chunkY}`);
    });
  }

  return Array.from(chunks).map((key) => {
    const [chunkX, chunkY] = key.split(',').map(Number);
    return { chunkX, chunkY };
  });
}


export {getChunksInBrush,getChunksBetween};
