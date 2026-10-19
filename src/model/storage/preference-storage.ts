import { Service, inject } from '@angular/core';
import { DEFAULT_OPTIONS, PdfWriterOptions } from '../formats/pdf-writer';
import { SkyDemonChecklistOptions } from '../formats/skydemon-format';
import { LazyBrowserStorage } from './browser-storage';

// Group title -> checklist title -> the settings the user chose.
export type SkyDemonChecklistOverrides = Partial<
  Record<string, Partial<Record<string, Partial<SkyDemonChecklistOptions>>>>
>;

@Service()
export class PreferenceStorage {
  private static readonly PREFERENCES_PREFIX = 'prefs:';
  private static readonly PRINT_OPTIONS_KEY = PreferenceStorage.PREFERENCES_PREFIX + 'print';
  private static readonly SKYDEMON_KEY_PREFIX = PreferenceStorage.PREFERENCES_PREFIX + 'skydemon-checklists:';

  private readonly _browserStorage = inject(LazyBrowserStorage).storage;

  public async getPrintOptions(): Promise<PdfWriterOptions> {
    const store = await this._browserStorage;

    const optsStr = store.getItem(PreferenceStorage.PRINT_OPTIONS_KEY);
    if (!optsStr) {
      return { ...DEFAULT_OPTIONS };
    }

    const opts = JSON.parse(optsStr) as PdfWriterOptions;

    // If any fields are missing (because they were added later), add them from the defaults.
    const finalOpts = {
      ...DEFAULT_OPTIONS,
      ...opts,
    };

    // Backward compatibility for checklistNewPage.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if ((finalOpts as any).checklistNewPage !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      finalOpts.checklistStart = (finalOpts as any).checklistNewPage ? 'page' : 'below';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      delete (finalOpts as any).checklistNewPage;
    }

    return finalOpts;
  }

  public async setPrintOptions(opts: PdfWriterOptions) {
    const store = await this._browserStorage;
    const optsStr = JSON.stringify(opts);
    store.setItem(PreferenceStorage.PRINT_OPTIONS_KEY, optsStr);
  }

  /**
   * Returns the SkyDemon checklist settings the user chose for a checklist file, by group and checklist title.
   */
  public async getSkyDemonOverrides(fileName: string): Promise<SkyDemonChecklistOverrides> {
    const store = await this._browserStorage;
    const overridesStr = store.getItem(PreferenceStorage.SKYDEMON_KEY_PREFIX + fileName);
    return overridesStr ? (JSON.parse(overridesStr) as SkyDemonChecklistOverrides) : {};
  }

  public async setSkyDemonOverrides(fileName: string, overrides: SkyDemonChecklistOverrides) {
    const store = await this._browserStorage;
    const key = PreferenceStorage.SKYDEMON_KEY_PREFIX + fileName;
    if (Object.keys(overrides).length) {
      store.setItem(key, JSON.stringify(overrides));
    } else {
      store.removeItem(key);
    }
  }
}
