import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DeleteDialogComponent } from '../dialogs/delete-dialog/delete-dialog.component';
import { TitleDialogComponent } from '../dialogs/title-dialog/title-dialog.component';

import { FormatId } from '../../../model/formats/format-id';
import { FORMAT_REGISTRY } from '../../../model/formats/format-registry';
import { LocalFileStorage } from '../../../model/storage/local-file-storage';

@Component({
  selector: 'checklist-command-bar',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './command-bar.component.html',
  styleUrl: './command-bar.component.scss',
})
export class ChecklistCommandBarComponent {
  protected readonly _formatIdPdf = FormatId.PDF;
  readonly downloadFormats = FORMAT_REGISTRY.getSupportedOutputFormats();

  readonly hasFiles = input.required<boolean>();
  readonly fileIsOpen = input.required<boolean>();
  readonly newFile = output<string>(); // Emits filename
  readonly openFile = output<boolean>();
  readonly openLocalFile = output<boolean>();
  readonly saveLocalFile = output<boolean>(); // Emits true for "Save As", false for "Save"
  readonly uploadFile = output<boolean>();
  readonly downloadFile = output<FormatId>();
  readonly deleteFile = output<boolean>();
  readonly fileInfo = output<boolean>();

  protected readonly _hasFileSystemAccess: boolean;

  constructor(
    private readonly _dialog: MatDialog,
    private readonly _localFileStorage: LocalFileStorage,
  ) {
    this._hasFileSystemAccess = this._localFileStorage.isFileSystemAccessSupported();
  }

  async onNewFile() {
    const title = await TitleDialogComponent.promptForTitle({ promptType: 'file' }, this._dialog);
    if (title) {
      this.newFile.emit(title);
    }
  }

  async onDeleteFile() {
    const confirmed = await DeleteDialogComponent.confirmDeletion(
      { entityType: 'file', entityDescription: 'this file and all checklists within' },
      this._dialog,
    );

    if (confirmed) {
      this.deleteFile.emit(true);
    }
  }
}
