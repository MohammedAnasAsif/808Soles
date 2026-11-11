import { NativeCadence, isNativeApp, platform } from './index';

export interface DownloadJob {
  id: string;
  url: string;
  headers: Record<string, string>;
  /** File extension without the dot. */
  ext: string;
  /** Expected size in bytes, when known. */
  size?: number;
}

export interface DownloadedFile {
  /** Where the file is on disk (for deleting it). */
  path: string;
  /** A URL the audio engine can play. */
  url: string;
  size: number;
}

export type Progress = (received: number, total: number) => void;

const progressCallbacks = new Map<string, Progress>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  const on = (e: { id: string; received: number; total: number }) => progressCallbacks.get(e.id)?.(e.received, e.total);
  if (platform === 'electron') window.cadence!.onDownloadProgress(on);
  else if (isNativeApp) void NativeCadence.addListener('downloadProgress', on);
}

export const downloadsSupported = platform === 'electron' || isNativeApp;

/** Saves a stream to the app's private downloads folder, in chunks, natively. */
export async function downloadFile(job: DownloadJob, onProgress: Progress): Promise<DownloadedFile> {
  if (!downloadsSupported) throw new Error('Downloads work in the Windows, Android and iPhone apps.');
  listen();
  progressCallbacks.set(job.id, onProgress);
  try {
    if (platform === 'electron') return await window.cadence!.download(job);
    return await NativeCadence.download(job);
  } finally {
    progressCallbacks.delete(job.id);
  }
}

export async function deleteFile(path: string): Promise<void> {
  if (platform === 'electron') await window.cadence!.deleteDownload(path);
  else if (isNativeApp) await NativeCadence.deleteDownload({ path });
}
