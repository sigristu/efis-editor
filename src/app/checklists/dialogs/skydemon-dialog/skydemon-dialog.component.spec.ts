/* eslint-disable @typescript-eslint/naming-convention -- stored settings are keyed by checklist titles */
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { inject } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { render, screen, within } from '@testing-library/angular';
import userEvent, { UserEvent } from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { ChecklistFile, ChecklistGroup_Category } from '../../../../../gen/ts/checklist';
import {
  SKYDEMON_SKIP,
  SkyDemonChecklistOptions,
  SkyDemonFlightPhase,
} from '../../../../model/formats/skydemon-format';
import { LazyBrowserStorage } from '../../../../model/storage/browser-storage';
import { PreferenceStorage } from '../../../../model/storage/preference-storage';
import { SkyDemonDialogComponent } from './skydemon-dialog.component';

type OutputType = SkyDemonChecklistOptions[][] | undefined;

@Component({
  selector: 'test-skydemon-dialog',
  imports: [MatDialogModule],
  standalone: true,
  template: '<button (click)="openDialog()">Open dialog</button>',
  changeDetection: ChangeDetectionStrategy.Eager,
})
class DialogTestComponent {
  public readonly file = input.required<ChecklistFile>();
  public readonly aircraftFile = input.required<File>();
  public readonly dataOut = output<OutputType>();

  constructor(
    private readonly _dialog: MatDialog,
    private readonly _prefs: PreferenceStorage,
  ) {}

  async openDialog() {
    return SkyDemonDialogComponent.show(this._dialog, this._prefs, this.file(), this.aircraftFile()).then((value) => {
      this.dataOut.emit(value);
      return void 0;
    });
  }
}

describe('SkyDemonDialogComponent', () => {
  const { PREFLIGHT, DURING_FLIGHT, POSTFLIGHT, EMERGENCY } = SkyDemonFlightPhase;

  // Detected as Preflight, Preflight, DuringFlight, DuringFlight and Emergency.
  const file = ChecklistFile.create({
    groups: [
      {
        title: 'Normal',
        category: ChecklistGroup_Category.normal,
        checklists: [{ title: 'Walkaround' }, { title: 'Before start' }, { title: 'Cruise' }, { title: 'Landing' }],
      },
      { title: 'Emergency', category: ChecklistGroup_Category.emergency, checklists: [{ title: 'Engine fire' }] },
    ],
    metadata: { name: 'My checklists' },
  });
  const aircraftFile = new File(
    [
      // eslint-disable-next-line no-secrets/no-secrets
      '<Aircraft><ChecklistBundle>' +
        // eslint-disable-next-line no-secrets/no-secrets
        '<Checklist Name="Landing" FlightPhase="Postflight"><Section Name="S" AutoReset="True" /></Checklist>' +
        '<Checklist Name="Engine fire" FlightPhase="Unknown" />' +
        '</ChecklistBundle></Aircraft>',
    ],
    'RV.aircraft',
  );

  let user: UserEvent;
  let prefs: PreferenceStorage;
  let dataOut: Mock<(value: OutputType) => void>;

  beforeEach(async () => {
    user = userEvent.setup({ delay: null });
    dataOut = vi.fn();
    dataOut.mockName('SkyDemonDialogComponent.dataOut');

    await render(DialogTestComponent, { inputs: { file, aircraftFile }, on: { dataOut } });
  });

  beforeEach(inject(
    [LazyBrowserStorage, PreferenceStorage],
    async (browserStore: LazyBrowserStorage, prefsStore: PreferenceStorage) => {
      browserStore.forceBrowserStorage();
      (await browserStore.storage).clear();
      prefs = prefsStore;
    },
  ));

  async function openDialog() {
    await user.click(await screen.findByRole('button', { name: /open dialog/i }));

    await expect(screen.findByRole('dialog')).resolves.toBeInTheDocument();
  }

  function row(checklistTitle: string): HTMLElement {
    return screen.getByRole('group', { name: checklistTitle });
  }

  function autoReset(checklistTitle: string): HTMLElement {
    return screen.getByRole('checkbox', { name: `Auto reset ${checklistTitle}` });
  }

  async function selectPhase(checklistTitle: string, phaseLabel: string) {
    await user.click(screen.getByRole('combobox', { name: `Flight phase of ${checklistTitle}` }));
    await user.click(await screen.findByRole('option', { name: phaseLabel }));
  }

  it('suggests saved, profile and detected settings', async () => {
    await prefs.setSkyDemonOverrides('My checklists', { Normal: { Cruise: { phase: PREFLIGHT } } });

    await openDialog();

    expect(within(row('Walkaround')).getByText('Preflight')).toBeInTheDocument();
    expect(within(row('Walkaround')).getByText('detected')).toBeInTheDocument();
    expect(autoReset('Walkaround')).not.toBeChecked();
    expect(within(row('Cruise')).getByText('Preflight')).toBeInTheDocument();
    expect(within(row('Cruise')).getByText('saved')).toBeInTheDocument();
    expect(within(row('Landing')).getByText('Postflight')).toBeInTheDocument();
    expect(within(row('Landing')).getByText('from profile')).toBeInTheDocument();
    expect(autoReset('Landing')).toBeChecked();
    // Unknown phases in the profile are ignored.
    expect(within(row('Engine fire')).getByText('Emergency')).toBeInTheDocument();
    expect(within(row('Engine fire')).getByText('detected')).toBeInTheDocument();

    await user.click(autoReset('Walkaround'));

    expect(within(row('Walkaround')).getByText('changed')).toBeInTheDocument();
  });

  it('returns the settings and remembers what differs from detection or the profile', async () => {
    await prefs.setSkyDemonOverrides('My checklists', {
      Normal: { Cruise: { phase: PREFLIGHT }, Deleted: { phase: PREFLIGHT } },
    });

    await openDialog();
    await selectPhase('Cruise', 'During flight');
    await selectPhase('Before start', 'Postflight');
    await user.click(autoReset('Walkaround'));
    await user.click(autoReset('Landing'));
    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(dataOut).toHaveBeenCalledExactlyOnceWith([
      [
        { phase: PREFLIGHT, autoReset: true },
        { phase: POSTFLIGHT, autoReset: false },
        { phase: DURING_FLIGHT, autoReset: false },
        { phase: POSTFLIGHT, autoReset: false },
      ],
      [{ phase: EMERGENCY, autoReset: false }],
    ]);
    await expect(prefs.getSkyDemonOverrides('My checklists')).resolves.toEqual({
      Normal: {
        Walkaround: { autoReset: true },
        'Before start': { phase: POSTFLIGHT },
        Landing: { phase: POSTFLIGHT, autoReset: false },
      },
    });
  });

  it('returns and remembers checklists which should not be exported', async () => {
    await openDialog();
    await selectPhase('Engine fire', "Don't export");

    expect(autoReset('Engine fire')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(dataOut).toHaveBeenCalledExactlyOnceWith([
      [
        { phase: PREFLIGHT, autoReset: false },
        { phase: PREFLIGHT, autoReset: false },
        { phase: DURING_FLIGHT, autoReset: false },
        { phase: POSTFLIGHT, autoReset: true },
      ],
      [{ phase: SKYDEMON_SKIP, autoReset: false }],
    ]);
    await expect(prefs.getSkyDemonOverrides('My checklists')).resolves.toEqual({
      Normal: { Landing: { phase: POSTFLIGHT, autoReset: true } },
      Emergency: { 'Engine fire': { phase: SKYDEMON_SKIP } },
    });
  });

  it('keeps the stored settings when cancelled', async () => {
    const saved = { Normal: { Cruise: { phase: PREFLIGHT } } };
    await prefs.setSkyDemonOverrides('My checklists', saved);

    await openDialog();
    await selectPhase('Cruise', 'Emergency');
    await user.click(autoReset('Cruise'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(dataOut).toHaveBeenCalledExactlyOnceWith(undefined);
    await expect(prefs.getSkyDemonOverrides('My checklists')).resolves.toEqual(saved);
  });
});
