import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): 'ios' | 'android' | 'web' => Capacitor.getPlatform() as 'ios' | 'android' | 'web';

export async function tap(style: ImpactStyle = ImpactStyle.Light): Promise<void> {
  if (!isNative()) return;
  try {
    await Haptics.impact({ style });
  } catch {
    /* haptics unavailable */
  }
}

export async function notify(type: NotificationType = NotificationType.Success): Promise<void> {
  if (!isNative()) return;
  try {
    await Haptics.notification({ type });
  } catch {
    /* ignore */
  }
}

/**
 * Save a text file. On device: writes to the app's Documents dir and opens the
 * share sheet. On web: triggers a download.
 */
export async function saveTextFile(fileName: string, contents: string, mime: string): Promise<'shared' | 'downloaded'> {
  if (isNative()) {
    const res = await Filesystem.writeFile({ path: fileName, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: fileName, url: res.uri, dialogTitle: 'Save or send your export' });
    return 'shared';
  }
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
