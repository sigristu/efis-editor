import { Injectable } from '@angular/core';
import { ChecklistFile } from '../../../gen/ts/checklist';
import { FormatId } from '../formats/format-id';
import { FORMAT_REGISTRY } from '../formats/format-registry';

/**
 * Service for saving and loading checklist files directly to/from the local filesystem
 * using the File System Access API with fallback for unsupported browsers.
 */
@Injectable({ providedIn: 'root' })
export class LocalFileStorage {
  private readonly _jsonFormat = FORMAT_REGISTRY.getFormat(FormatId.JSON);
  private _currentFileHandle?: FileSystemFileHandle;

  /**
   * Returns true if the File System Access API is supported in this browser.
   */
  isFileSystemAccessSupported(): boolean {
    if (typeof window === 'undefined') {
      return false; // SSR context
    }
    return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
  }

  /**
   * Opens a file picker dialog to select a file from the local filesystem.
   * Returns the parsed ChecklistFile or null if canceled.
   * Uses File System Access API if available, otherwise falls back to input element.
   */
  async openFile(): Promise<ChecklistFile | null> {
    if (this.isFileSystemAccessSupported()) {
      return this._openFileWithFSA();
    } else {
      return this._openFileWithFallback();
    }
  }

  /**
   * Opens a file using the File System Access API.
   */
  private async _openFileWithFSA(): Promise<ChecklistFile | null> {

    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'Checklist Files',
            accept: {
              'application/json': ['.json'],
            },
          },
        ],
        multiple: false,
      });

      this._currentFileHandle = fileHandle;
      const file = await fileHandle.getFile();
      return await this._jsonFormat.toProto(file);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User canceled the dialog
        return null;
      }
      throw error;
    }
  }

  /**
   * Opens a file using traditional input element fallback.
   */
  private async _openFileWithFallback(): Promise<ChecklistFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          try {
            const checklistFile = await this._jsonFormat.toProto(file);
            resolve(checklistFile);
          } catch (error) {
            console.error('Failed to parse file:', error);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      input.oncancel = () => {
        resolve(null);
      };

      input.click();
    });
  }

  /**
   * Saves a checklist file to the local filesystem.
   * If a file handle exists from a previous open/save, it will save to that location.
   * Otherwise, it prompts the user to choose a save location.
   * Uses File System Access API if available, otherwise falls back to download.
   */
  async saveFile(checklistFile: ChecklistFile, saveAs: boolean = false): Promise<boolean> {
    if (this.isFileSystemAccessSupported()) {
      return this._saveFileWithFSA(checklistFile, saveAs);
    } else {
      return this._saveFileWithFallback(checklistFile);
    }
  }

  /**
   * Saves a file using the File System Access API.
   */
  private async _saveFileWithFSA(checklistFile: ChecklistFile, saveAs: boolean = false): Promise<boolean> {

    try {
      let fileHandle = this._currentFileHandle;

      // If saveAs is true or we don't have a file handle, prompt for location
      if (saveAs || !fileHandle) {
        fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: `${checklistFile.metadata?.name || 'checklist'}.json`,
          types: [
            {
              description: 'Checklist Files',
              accept: {
                'application/json': ['.json'],
              },
            },
          ],
        });
        this._currentFileHandle = fileHandle;
      }

      if (!fileHandle) {
        throw new Error('No file handle available');
      }

      const writable = await fileHandle.createWritable();
      const blob = await this._jsonFormat.fromProto(checklistFile);
      await writable.write(await blob.arrayBuffer());
      await writable.close();

      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User canceled the dialog
        return false;
      }
      throw error;
    }
  }

  /**
   * Saves a file using traditional download fallback.
   */
  private async _saveFileWithFallback(checklistFile: ChecklistFile): Promise<boolean> {
    try {
      const blob = await this._jsonFormat.fromProto(checklistFile);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = blob.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  }

  /**
   * Clears the current file handle, forcing the next save to prompt for a location.
   */
  clearFileHandle(): void {
    this._currentFileHandle = undefined;
  }

  /**
   * Returns true if there is a current file handle (i.e., a file has been opened or saved).
   */
  hasFileHandle(): boolean {
    return this._currentFileHandle !== undefined;
  }

  /**
   * Returns the name of the currently open file, or undefined if no file is open.
   */
  async getCurrentFileName(): Promise<string | undefined> {
    if (!this._currentFileHandle) {
      return undefined;
    }
    return this._currentFileHandle.name;
  }
}
