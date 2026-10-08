export type VistaLayer = "sky" | "far" | "mid" | "near";
export type VistaArt = Partial<Record<VistaLayer, HTMLImageElement>>;

const LAYERS: VistaLayer[] = ["sky", "far", "mid", "near"];
let cached: Promise<VistaArt> | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

async function load(): Promise<VistaArt> {
  const art: VistaArt = {};
  try {
    const res = await fetch("art/manifest.json");
    if (!res.ok) return art;
    const manifest = (await res.json()) as { layers?: Record<string, string> };
    const layers = manifest.layers ?? {};
    await Promise.all(
      LAYERS.map(async (layer) => {
        const file = layers[layer];
        if (typeof file !== "string") return;
        try {
          art[layer] = await loadImage(`art/${file}`);
        } catch {
          /* skip this layer */
        }
      }),
    );
  } catch {
    return {};
  }
  return art;
}

/** Loads public/art/manifest.json and its images. Resolves to {} when there is no art or anything fails (never rejects). */
export function loadVistaArt(): Promise<VistaArt> {
  cached ??= load().catch(() => ({}));
  return cached;
}
