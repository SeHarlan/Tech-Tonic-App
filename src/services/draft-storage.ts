import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { SerializedState } from '../engine/state';
import type { ShaderParams } from '../engine/types';

// --- Types ---

export interface DraftMeta {
  draftKey: string;
  nftId: string;
  seed: number;
  time: number;
  totalFrameCount: number;
  params: ShaderParams;
  defaultWaterfallMode: boolean;
  savedAt: number;
}

export interface DraftData {
  meta: DraftMeta;
  imageBlob: Blob;
  movementBlob: Blob;
  paintBlob: Blob;
}

// --- Helpers ---

function getDraftKey(nftId: string): string {
  return `nft-${nftId}`;
}

function draftDir(nftId: string): string {
  return `drafts/${getDraftKey(nftId)}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip data URL prefix (e.g. "data:image/png;base64,")
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

// --- API ---

export async function saveDraft(
  nftId: string,
  state: SerializedState,
  defaultWaterfallMode: boolean,
): Promise<void> {
  const dir = draftDir(nftId);

  const meta: DraftMeta = {
    draftKey: getDraftKey(nftId),
    nftId,
    seed: state.seed,
    time: state.time,
    totalFrameCount: state.totalFrameCount,
    params: state.params,
    defaultWaterfallMode,
    savedAt: Date.now(),
  };

  const [imageB64, movementB64, paintB64] = await Promise.all([
    blobToBase64(state.imageBuffer),
    blobToBase64(state.movementBuffer),
    blobToBase64(state.paintBuffer),
  ]);

  await Filesystem.writeFile({
    path: `${dir}/meta.json`,
    data: JSON.stringify(meta),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  await Promise.all([
    Filesystem.writeFile({
      path: `${dir}/image.png`,
      data: imageB64,
      directory: Directory.Data,
      recursive: true,
    }),
    Filesystem.writeFile({
      path: `${dir}/movement.png`,
      data: movementB64,
      directory: Directory.Data,
      recursive: true,
    }),
    Filesystem.writeFile({
      path: `${dir}/paint.png`,
      data: paintB64,
      directory: Directory.Data,
      recursive: true,
    }),
  ]);
}

export async function loadDraft(nftId: string): Promise<DraftData | null> {
  const exists = await hasDraft(nftId);
  if (!exists) {
    console.log(`[draft] No draft found for nftId: ${nftId}`);
    return null;
  }

  const dir = draftDir(nftId);

  try {
    const metaFile = await Filesystem.readFile({
      path: `${dir}/meta.json`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const meta: DraftMeta = JSON.parse(metaFile.data as string);

    const [imageFile, movementFile, paintFile] = await Promise.all([
      Filesystem.readFile({ path: `${dir}/image.png`, directory: Directory.Data }),
      Filesystem.readFile({ path: `${dir}/movement.png`, directory: Directory.Data }),
      Filesystem.readFile({ path: `${dir}/paint.png`, directory: Directory.Data }),
    ]);

    return {
      meta,
      imageBlob: base64ToBlob(imageFile.data as string, 'image/png'),
      movementBlob: base64ToBlob(movementFile.data as string, 'image/png'),
      paintBlob: base64ToBlob(paintFile.data as string, 'image/png'),
    };
  } catch {
    return null;
  }
}

export async function hasDraft(nftId: string): Promise<boolean> {
  try {
    await Filesystem.stat({
      path: `${draftDir(nftId)}/meta.json`,
      directory: Directory.Data,
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteDraft(nftId: string): Promise<void> {
  try {
    await Filesystem.rmdir({
      path: draftDir(nftId),
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // Already deleted or never existed
  }
}
