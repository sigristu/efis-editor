import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { lastValueFrom, Observable } from 'rxjs';
import { ChecklistFile } from '../../../../../gen/ts/checklist';
import {
  SKYDEMON_SKIP,
  SkyDemonChecklistOptions,
  SkyDemonFlightPhase,
  SkyDemonFormat,
  SkyDemonPhaseChoice,
  SkyDemonProfileChecklist,
} from '../../../../model/formats/skydemon-format';
import { PreferenceStorage, SkyDemonChecklistOverrides } from '../../../../model/storage/preference-storage';

export type SuggestionSource = 'saved' | 'profile' | 'detected';

export interface ChecklistRow {
  checklistTitle: string;
  defaults: SkyDemonChecklistOptions;
  profile?: SkyDemonProfileChecklist;
  suggested: SkyDemonChecklistOptions;
  source: SuggestionSource;
  phase: SkyDemonPhaseChoice;
  autoReset: boolean;
}

export interface ChecklistRowGroup {
  title: string;
  rows: ChecklistRow[];
}

@Component({
  selector: 'checklist-skydemon-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatSelectModule,
  ],
  templateUrl: './skydemon-dialog.component.html',
  styleUrl: './skydemon-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SkyDemonDialogComponent {
  public groups = inject(MAT_DIALOG_DATA) as ChecklistRowGroup[];

  protected readonly _phaseOptions = [
    { value: SkyDemonFlightPhase.PREFLIGHT, label: 'Preflight' },
    { value: SkyDemonFlightPhase.DURING_FLIGHT, label: 'During flight' },
    { value: SkyDemonFlightPhase.POSTFLIGHT, label: 'Postflight' },
    { value: SkyDemonFlightPhase.EMERGENCY, label: 'Emergency' },
    { value: SKYDEMON_SKIP, label: "Don't export" },
  ];

  protected readonly _skip = SKYDEMON_SKIP;

  private static readonly SOURCE_LABELS: Record<SuggestionSource, string> = {
    saved: 'saved',
    profile: 'from profile',
    detected: 'detected',
  };

  protected _sourceLabel(row: ChecklistRow): string {
    const unchanged = row.phase === row.suggested.phase && row.autoReset === row.suggested.autoReset;
    return unchanged ? SkyDemonDialogComponent.SOURCE_LABELS[row.source] : 'changed';
  }

  /**
   * Lets the user confirm the flight phase and auto reset of each checklist. Each setting is suggested from
   * what was chosen in earlier exports, then what's already in the aircraft profile, then detection
   * (auto reset defaults to off). Settings which differ from those defaults, or from the profile, are
   * remembered for the next export.
   *
   * @returns the settings, indexed by group and then checklist, or undefined if cancelled.
   */
  public static async show(
    dialog: MatDialog,
    prefs: PreferenceStorage,
    file: ChecklistFile,
    aircraftFile: File,
  ): Promise<SkyDemonChecklistOptions[][] | undefined> {
    const fileName = file.metadata?.name ?? '';
    const [profileChecklists, savedOverrides] = await Promise.all([
      SkyDemonFormat.readProfileChecklists(aircraftFile),
      prefs.getSkyDemonOverrides(fileName),
    ]);
    const detectedPhases = SkyDemonFormat.detectFlightPhases(file);

    const groups = file.groups.map((group, groupIdx): ChecklistRowGroup => ({
      title: group.title,
      rows: group.checklists.map((checklist, checklistIdx): ChecklistRow => {
        const defaults = { phase: detectedPhases[groupIdx][checklistIdx], autoReset: false };
        const saved = savedOverrides[group.title]?.[checklist.title];
        const profile = profileChecklists.get(checklist.title);
        const suggested = {
          phase: saved?.phase ?? profile?.phase ?? defaults.phase,
          autoReset: saved?.autoReset ?? profile?.autoReset ?? defaults.autoReset,
        };
        let source: SuggestionSource = 'detected';
        if (saved) {
          source = 'saved';
        } else if (profile?.phase ?? profile?.autoReset) {
          source = 'profile';
        }
        return { checklistTitle: checklist.title, defaults, profile, suggested, source, ...suggested };
      }),
    }));

    const settingsDialog = dialog.open(SkyDemonDialogComponent, {
      data: groups,
      hasBackdrop: true,
      closeOnNavigation: true,
      enterAnimationDuration: 200,
      exitAnimationDuration: 200,
      maxWidth: '1000px',
      role: 'dialog',
      ariaModal: true,
    });
    const afterClosed$ = settingsDialog.afterClosed() as Observable<ChecklistRowGroup[] | undefined>;
    const result = await lastValueFrom(afterClosed$, { defaultValue: undefined });
    if (!result) {
      return undefined;
    }

    // Only remember what neither detection nor the profile would suggest, and forget checklists which no
    // longer exist.
    const overrides: SkyDemonChecklistOverrides = {};
    for (const group of result) {
      for (const row of group.rows) {
        const override: Partial<SkyDemonChecklistOptions> = {};
        if (SkyDemonDialogComponent._differs(row.phase, row.defaults.phase, row.profile?.phase)) {
          override.phase = row.phase;
        }
        if (SkyDemonDialogComponent._differs(row.autoReset, row.defaults.autoReset, row.profile?.autoReset)) {
          override.autoReset = row.autoReset;
        }
        if (Object.keys(override).length) {
          overrides[group.title] = { ...overrides[group.title], [row.checklistTitle]: override };
        }
      }
    }
    await prefs.setSkyDemonOverrides(fileName, overrides);

    return result.map((group) => group.rows.map((row) => ({ phase: row.phase, autoReset: row.autoReset })));
  }

  private static _differs<T>(value: T, defaultValue: T, profileValue?: T): boolean {
    return value !== defaultValue || (profileValue !== undefined && value !== profileValue);
  }
}
