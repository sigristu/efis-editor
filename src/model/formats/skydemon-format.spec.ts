import { ChecklistFile, ChecklistGroup_Category, ChecklistItem, ChecklistItem_Type } from '../../../gen/ts/checklist';
import { FormatId } from './format-id';
import { serializeChecklistFile } from './format-registry';
import { SKYDEMON_SKIP, SkyDemonExportOptions, SkyDemonFlightPhase, SkyDemonFormat } from './skydemon-format';
import { loadFile } from './test-utils';

describe('SkyDemonFormat', () => {
  const bom = '\uFEFF';

  const checklistFile = ChecklistFile.create({
    groups: [
      {
        title: 'Normal procedures',
        category: ChecklistGroup_Category.normal,
        checklists: [
          {
            title: 'Before start',
            items: [
              ChecklistItem.create({
                type: ChecklistItem_Type.ITEM_CHALLENGE_RESPONSE,
                prompt: 'Brakes',
                expectation: 'SET',
              }),
              ChecklistItem.create({ type: ChecklistItem_Type.ITEM_TITLE, prompt: 'Engine start' }),
              ChecklistItem.create({ type: ChecklistItem_Type.ITEM_NOTE, prompt: 'Starter limits apply' }),
              ChecklistItem.create({ type: ChecklistItem_Type.ITEM_CHALLENGE, prompt: 'Propeller area' }),
              ChecklistItem.create({ type: ChecklistItem_Type.ITEM_SPACE }),
              ChecklistItem.create({ type: ChecklistItem_Type.ITEM_WARNING, prompt: 'Hot & "cold" <start>' }),
              ChecklistItem.create({
                type: ChecklistItem_Type.ITEM_CHALLENGE_RESPONSE,
                prompt: 'Starter',
                expectation: 'ENGAGE',
                indent: 1,
              }),
              ChecklistItem.create({ type: ChecklistItem_Type.ITEM_CAUTION, prompt: 'Release when running' }),
            ],
          },
          {
            title: 'Cruise',
            items: [ChecklistItem.create({ type: ChecklistItem_Type.ITEM_TITLE, prompt: 'Nothing here' })],
          },
        ],
      },
      {
        title: 'Emergency procedures',
        category: ChecklistGroup_Category.emergency,
        checklists: [
          {
            title: 'Engine fire',
            items: [
              ChecklistItem.create({
                type: ChecklistItem_Type.ITEM_CHALLENGE_RESPONSE,
                prompt: 'Mixture',
                expectation: 'CUT OFF',
              }),
            ],
          },
        ],
      },
    ],
    metadata: { name: 'Test' },
  });

  const expectedBundle = [
    '  <ChecklistBundle>',
    '    <Checklist Name="Before start" FlightPhase="Preflight">',
    '      <Section Name="Before start">',
    '        <CheckItem Challenge="Brakes" Response="SET" />',
    '      </Section>',
    '      <Section Name="Engine start" Header="Starter limits apply" Footer="CAUTION: Release when running">',
    '        <CheckItem Challenge="Propeller area" Response="" />',
    '        <CheckItem Challenge="WARNING: Hot &amp; &quot;cold&quot; &lt;start&gt;" Response="" />',
    '        <CheckItem Challenge="Starter" Response="ENGAGE" />',
    '      </Section>',
    '    </Checklist>',
    '    <Checklist Name="Cruise" FlightPhase="DuringFlight">',
    '    </Checklist>',
    // eslint-disable-next-line no-secrets/no-secrets
    '    <Checklist Name="Engine fire" FlightPhase="Emergency">',
    '      <Section Name="Engine fire">',
    '        <CheckItem Challenge="Mixture" Response="CUT OFF" />',
    '      </Section>',
    '    </Checklist>',
    '  </ChecklistBundle>',
  ].join('\r\n');

  async function exportTo(aircraftFile: File): Promise<string> {
    const options: SkyDemonExportOptions = { aircraftFile };
    const writtenFile = await serializeChecklistFile(checklistFile, FormatId.SKYDEMON, options);

    expect(writtenFile.name).toEqual(aircraftFile.name);

    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await writtenFile.arrayBuffer());
  }

  async function loadProfile(): Promise<string> {
    const f = await loadFile('/src/model/formats/test-skydemon.aircraft', 'test.aircraft');
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await f.arrayBuffer());
  }

  it('replaces the checklists and keeps the rest of the profile', async () => {
    const profile = await loadProfile();
    const written = await exportTo(new File([profile], 'RV-14A.aircraft'));

    const bundleStart = profile.indexOf('  <ChecklistBundle>');
    const bundleEnd = profile.indexOf('</ChecklistBundle>') + '</ChecklistBundle>'.length;

    expect(written.startsWith(bom)).toBe(true);
    expect(written).toEqual(profile.slice(0, bundleStart) + expectedBundle + profile.slice(bundleEnd));
  });

  it('adds checklists to a profile without any', async () => {
    const profile = (await loadProfile()).replace(/ *<ChecklistBundle>[\s\S]*<\/ChecklistBundle>\r\n/, '');

    expect(profile).not.toContain('ChecklistBundle');

    const written = await exportTo(new File([profile], 'RV-14A.aircraft'));

    expect(written).toEqual(profile.replace('</Aircraft>', `${expectedBundle}\r\n</Aircraft>`));
  });

  it('writes a well-formed profile', async () => {
    const written = await exportTo(new File([await loadProfile()], 'RV-14A.aircraft'));
    const doc = new DOMParser().parseFromString(written.replace(bom, ''), 'application/xml');

    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.getElementsByTagName('Checklist')).toHaveLength(3);
    expect(doc.getElementsByTagName('CheckItem')[2].getAttribute('Challenge')).toEqual('WARNING: Hot & "cold" <start>');
  });

  it('rejects files which are not aircraft profiles', async () => {
    await expect(exportTo(new File(['<Route />'], 'test.aircraft'))).rejects.toThrow(/not a SkyDemon aircraft profile/);
    await expect(exportTo(new File(['not xml'], 'test.aircraft'))).rejects.toThrow(/not a SkyDemon aircraft profile/);
  });

  it('requires an aircraft profile', async () => {
    await expect(serializeChecklistFile(checklistFile, FormatId.SKYDEMON)).rejects.toThrow(/profile is required/);
  });

  it('does not support importing', async () => {
    await expect(new SkyDemonFormat(FormatId.SKYDEMON, 'SkyDemon').toProto(new File([], 'a.aircraft'))).rejects.toThrow(
      /not supported/,
    );
  });

  it('uses the given checklist settings', async () => {
    const options: SkyDemonExportOptions = {
      aircraftFile: new File([await loadProfile()], 'RV-14A.aircraft'),
      checklists: [
        [
          { phase: SkyDemonFlightPhase.POSTFLIGHT, autoReset: true },
          { phase: SkyDemonFlightPhase.PREFLIGHT, autoReset: false },
        ],
        [{ phase: SkyDemonFlightPhase.DURING_FLIGHT, autoReset: false }],
      ],
    };
    const writtenFile = await serializeChecklistFile(checklistFile, FormatId.SKYDEMON, options);
    const written = await writtenFile.text();

    expect(written).toContain('<Checklist Name="Before start" FlightPhase="Postflight">');
    expect(written).toContain('<Section Name="Before start" AutoReset="True">');
    expect(written).toContain(
      '<Section Name="Engine start" AutoReset="True" Header="Starter limits apply" Footer="CAUTION: Release when running">',
    );
    expect(written).toContain('<Checklist Name="Cruise" FlightPhase="Preflight">');
    expect(written).toContain('<Checklist Name="Engine fire" FlightPhase="DuringFlight">');
    expect(written).toContain('<Section Name="Engine fire">');
  });

  it('leaves out checklists which should not be exported', async () => {
    const options: SkyDemonExportOptions = {
      aircraftFile: new File([await loadProfile()], 'RV-14A.aircraft'),
      checklists: [
        [
          { phase: SKYDEMON_SKIP, autoReset: false },
          { phase: SkyDemonFlightPhase.DURING_FLIGHT, autoReset: false },
        ],
        [{ phase: SKYDEMON_SKIP, autoReset: true }],
      ],
    };
    const writtenFile = await serializeChecklistFile(checklistFile, FormatId.SKYDEMON, options);
    const written = await writtenFile.text();

    expect(written).not.toContain('Before start');
    expect(written).toContain('<Checklist Name="Cruise" FlightPhase="DuringFlight">');
    expect(written).not.toContain('Engine fire');
  });

  it('reads the checklists from an aircraft profile', async () => {
    const checklists = await SkyDemonFormat.readProfileChecklists(new File([await loadProfile()], 'RV-14A.aircraft'));

    expect(checklists).toEqual(
      new Map([
        ['PREFLIGHT CHECK', { phase: SkyDemonFlightPhase.PREFLIGHT, autoReset: false }],
        ['BEFORE STARTING ENGINE', { phase: SkyDemonFlightPhase.PREFLIGHT, autoReset: false }],
        ['CRUISE', { phase: SkyDemonFlightPhase.DURING_FLIGHT, autoReset: true }],
        ['Postflight Checklist', { phase: SkyDemonFlightPhase.POSTFLIGHT, autoReset: false }],
        ['Emergency Checklist', { phase: SkyDemonFlightPhase.EMERGENCY, autoReset: false }],
      ]),
    );
  });

  it('reads no checklists from a profile without any', async () => {
    const checklists = await SkyDemonFormat.readProfileChecklists(new File(['<Aircraft />'], 'test.aircraft'));

    expect(checklists.size).toBe(0);
  });

  describe('flight phase detection', () => {
    function detect(checklistTitles: string[], groupTitle = '', category = ChecklistGroup_Category.normal) {
      const file = ChecklistFile.create({
        groups: [{ title: groupTitle, category, checklists: checklistTitles.map((title) => ({ title })) }],
      });
      return SkyDemonFormat.detectFlightPhases(file)[0];
    }

    it.each([
      ['Preflight inspection', SkyDemonFlightPhase.PREFLIGHT],
      ['BEFORE STARTING ENGINE', SkyDemonFlightPhase.PREFLIGHT],
      ['Taxi', SkyDemonFlightPhase.PREFLIGHT],
      ['Run-up', SkyDemonFlightPhase.PREFLIGHT],
      ['Before takeoff', SkyDemonFlightPhase.PREFLIGHT],
      ['Anlassen', SkyDemonFlightPhase.PREFLIGHT],
      ['Takeoff', SkyDemonFlightPhase.DURING_FLIGHT],
      ['Cruise', SkyDemonFlightPhase.DURING_FLIGHT],
      ['Engine restart', SkyDemonFlightPhase.DURING_FLIGHT],
      ['Before landing', SkyDemonFlightPhase.DURING_FLIGHT],
      ['After landing', SkyDemonFlightPhase.POSTFLIGHT],
      ['Shutdown', SkyDemonFlightPhase.POSTFLIGHT],
      ['Nach der Landung', SkyDemonFlightPhase.POSTFLIGHT],
      ['Emergency descent', SkyDemonFlightPhase.EMERGENCY],
    ])('detects "%s" as %s', (title, phase) => {
      expect(detect([title])).toEqual([phase]);
    });

    it('detects unknown checklists from their position', () => {
      expect(
        detect(['Walkaround', 'Cockpit', 'Before start', 'Takeoff', 'Cruise', 'After landing', 'Securing']),
      ).toEqual([
        SkyDemonFlightPhase.PREFLIGHT,
        SkyDemonFlightPhase.PREFLIGHT,
        SkyDemonFlightPhase.PREFLIGHT,
        SkyDemonFlightPhase.DURING_FLIGHT,
        SkyDemonFlightPhase.DURING_FLIGHT,
        SkyDemonFlightPhase.POSTFLIGHT,
        SkyDemonFlightPhase.POSTFLIGHT,
      ]);
    });

    it('ignores the position when the checklists are not in flight order', () => {
      expect(detect(['Shutdown', 'Walkaround', 'Before start'])).toEqual([
        SkyDemonFlightPhase.POSTFLIGHT,
        SkyDemonFlightPhase.DURING_FLIGHT,
        SkyDemonFlightPhase.PREFLIGHT,
      ]);
    });

    it('falls back to the group title', () => {
      expect(detect(['Walkaround'], 'Preflight')).toEqual([SkyDemonFlightPhase.PREFLIGHT]);
      expect(detect(['Walkaround'], 'Normal')).toEqual([SkyDemonFlightPhase.DURING_FLIGHT]);
    });

    it('uses the emergency phase for emergency and abnormal groups', () => {
      expect(detect(['Taxi'], '', ChecklistGroup_Category.emergency)).toEqual([SkyDemonFlightPhase.EMERGENCY]);
      expect(detect(['Taxi'], '', ChecklistGroup_Category.abnormal)).toEqual([SkyDemonFlightPhase.EMERGENCY]);
    });
  });
});
