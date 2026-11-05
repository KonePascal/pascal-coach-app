import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { parseZwo, toZwo, zwoFileName, type Workout } from '@/domain/workout';

/** .zwo erzeugen und über das iOS-Teilen-Menü anbieten (Dateien, AirDrop, Mail …). */
export async function shareZwo(w: Workout, date: string): Promise<void> {
  const file = new File(Paths.cache, zwoFileName(w, date));
  if (file.exists) file.delete();
  file.create();
  file.write(toZwo(w));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen ist auf diesem Gerät nicht verfügbar.');
  await Sharing.shareAsync(file.uri, { UTI: 'public.xml', mimeType: 'application/xml', dialogTitle: 'Workout teilen' });
}

export interface PickedZwo {
  name: string;
  xml: string;
}

/** Eine oder mehrere .zwo aus „Dateien“ wählen und prüfen. */
export async function pickZwoFiles(): Promise<{ ok: PickedZwo[]; failed: string[] }> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
  if (res.canceled) return { ok: [], failed: [] };
  const ok: PickedZwo[] = [];
  const failed: string[] = [];
  for (const a of res.assets) {
    try {
      const xml = await new File(a.uri).text();
      const w = parseZwo(xml);
      if (!w) throw new Error('keine Workout-Struktur');
      const fileBase = a.name.replace(/\.zwo$/i, '');
      ok.push({ name: w.name && w.name !== 'Workout' ? w.name : fileBase, xml });
    } catch {
      failed.push(a.name);
    }
  }
  return { ok, failed };
}
