import {
  Checklist,
  ChecklistFile,
  ChecklistGroup,
  ChecklistGroup_Category,
  ChecklistItem,
  ChecklistItem_Type,
} from '../../../gen/ts/checklist';
import { AbstractChecklistFormat, ExportOptions } from './abstract-format';
import { FormatError } from './error';

/**
 * SkyDemon stores checklists inside its aircraft profiles (.aircraft XML files), so exporting
 * requires an existing profile whose checklists get replaced.
 */
export interface SkyDemonExportOptions extends ExportOptions {
  aircraftFile: File;
  // Settings of each checklist, indexed by group and then checklist. Detected when missing.
  checklists?: SkyDemonChecklistOptions[][];
}

export interface SkyDemonChecklistOptions {
  phase: SkyDemonPhaseChoice;
  // SkyDemon sets this per section; it's applied to all sections of the checklist.
  autoReset: boolean;
}

// A checklist as found in an existing aircraft profile.
export interface SkyDemonProfileChecklist {
  phase?: SkyDemonFlightPhase;
  autoReset: boolean;
}

export const SKYDEMON_AIRCRAFT_EXTENSION = '.aircraft';

export enum SkyDemonFlightPhase {
  PREFLIGHT = 'Preflight',
  DURING_FLIGHT = 'DuringFlight',
  POSTFLIGHT = 'Postflight',
  EMERGENCY = 'Emergency',
}

// Leaves a checklist out of the export. Not a SkyDemon flight phase, so it never appears in profiles.
export const SKYDEMON_SKIP = 'skip';
export type SkyDemonPhaseChoice = SkyDemonFlightPhase | typeof SKYDEMON_SKIP;

const FLIGHT_PHASES = new Map<string, SkyDemonFlightPhase>(Object.values(SkyDemonFlightPhase).map((p) => [p, p]));

// Matched against checklist and group titles, in this order.
const FLIGHT_PHASE_KEYWORDS: [SkyDemonFlightPhase, RegExp][] = [
  [SkyDemonFlightPhase.EMERGENCY, /\b(?:emergency|notfall|notverfahren)\b/i],
  [
    SkyDemonFlightPhase.POSTFLIGHT,
    /\b(?:post-?flight|after landing|shut ?down|securing|parking|nach der landung|abstellen)\b/i,
  ],
  [
    SkyDemonFlightPhase.PREFLIGHT,
    /\b(?:pre-?flight|before start(?:ing)?|engine start|start(?:ing)?(?: engine)?|taxi(?:ing)?|run-?up|before take-?off|vorflug|anlassen|rollen)\b/i,
  ],
];

interface SkyDemonCheckItem {
  challenge: string;
  response: string;
}

interface SkyDemonSection {
  name: string;
  header?: string;
  footer?: string;
  items: SkyDemonCheckItem[];
}

type SectionEntry = { text: string } | { item: SkyDemonCheckItem };

export class SkyDemonFormat extends AbstractChecklistFormat {
  private static readonly INDENT = '  ';

  public async toProto(file: File): Promise<ChecklistFile> {
    return Promise.reject(new FormatError(`Importing ${file.name} from SkyDemon is not supported.`));
  }

  public async fromProto(file: ChecklistFile, options?: ExportOptions): Promise<File> {
    const skyDemonOptions = options as SkyDemonExportOptions | undefined;
    const aircraftFile = skyDemonOptions?.aircraftFile;
    if (!aircraftFile) {
      throw new FormatError('A SkyDemon aircraft profile is required to export checklists.');
    }

    const [contents] = await SkyDemonFormat._parseProfile(aircraftFile);
    const newline = contents.includes('\r\n') ? '\r\n' : '\n';
    const bundle = SkyDemonFormat._bundleXml(file, skyDemonOptions.checklists ?? [], newline);

    let output: string;
    const existingBundle = /[ \t]*<ChecklistBundle\s*\/>|[ \t]*<ChecklistBundle>[\s\S]*?<\/ChecklistBundle>/.exec(
      contents,
    );
    if (existingBundle) {
      output =
        contents.slice(0, existingBundle.index) +
        bundle +
        contents.slice(existingBundle.index + existingBundle[0].length);
    } else {
      const aircraftEnd = contents.lastIndexOf('</Aircraft>');
      if (aircraftEnd === -1) {
        throw new FormatError(`${aircraftFile.name} has no checklists and can't have them added.`);
      }
      output = contents.slice(0, aircraftEnd) + bundle + newline + contents.slice(aircraftEnd);
    }

    return new File([output], aircraftFile.name, { type: 'application/xml' });
  }

  /**
   * Guesses the flight phase of each checklist, indexed by group and then checklist.
   */
  public static detectFlightPhases(file: ChecklistFile): SkyDemonFlightPhase[][] {
    return file.groups.map((group) => SkyDemonFormat._detectGroupFlightPhases(group));
  }

  /**
   * Returns the checklists already in an aircraft profile, by checklist name. A checklist counts as
   * auto-resetting if any of its sections is.
   */
  public static async readProfileChecklists(aircraftFile: File): Promise<Map<string, SkyDemonProfileChecklist>> {
    const [, doc] = await SkyDemonFormat._parseProfile(aircraftFile);
    const checklists = new Map<string, SkyDemonProfileChecklist>();
    for (const checklist of doc.querySelectorAll('Aircraft > ChecklistBundle > Checklist')) {
      const name = checklist.getAttribute('Name');
      if (!name || checklists.has(name)) continue;
      checklists.set(name, {
        phase: FLIGHT_PHASES.get(checklist.getAttribute('FlightPhase') ?? ''),
        autoReset: [...checklist.querySelectorAll(':scope > Section')].some(
          (section) => section.getAttribute('AutoReset')?.toLowerCase() === 'true',
        ),
      });
    }
    return checklists;
  }

  /**
   * Checklist titles are matched against keywords first. As normal checklists are usually in flight order,
   * the remaining ones take their phase from their position: before the last preflight checklist they are
   * preflight, after the first postflight checklist they are postflight. Anything else is during flight.
   */
  private static _detectGroupFlightPhases(group: ChecklistGroup): SkyDemonFlightPhase[] {
    if (group.category === ChecklistGroup_Category.emergency || group.category === ChecklistGroup_Category.abnormal) {
      return group.checklists.map(() => SkyDemonFlightPhase.EMERGENCY);
    }

    const groupPhase = SkyDemonFormat._keywordFlightPhase(group.title);
    const keywordPhases = group.checklists.map((checklist) => SkyDemonFormat._keywordFlightPhase(checklist.title));
    const lastPreflight = keywordPhases.lastIndexOf(SkyDemonFlightPhase.PREFLIGHT);
    const firstPostflight = keywordPhases.indexOf(SkyDemonFlightPhase.POSTFLIGHT);
    const ordered = lastPreflight === -1 || firstPostflight === -1 || lastPreflight < firstPostflight;

    return keywordPhases.map((phase, idx) => {
      if (phase) return phase;
      if (groupPhase) return groupPhase;
      if (ordered && idx < lastPreflight) return SkyDemonFlightPhase.PREFLIGHT;
      if (ordered && firstPostflight !== -1 && idx > firstPostflight) return SkyDemonFlightPhase.POSTFLIGHT;
      return SkyDemonFlightPhase.DURING_FLIGHT;
    });
  }

  private static _keywordFlightPhase(title: string): SkyDemonFlightPhase | undefined {
    return FLIGHT_PHASE_KEYWORDS.find(([, keywords]) => keywords.test(title))?.[0];
  }

  private static async _parseProfile(aircraftFile: File): Promise<[string, Document]> {
    // Keep any byte order mark, so the rest of the profile is written back unchanged.
    const contents = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await aircraftFile.arrayBuffer());
    const doc = new DOMParser().parseFromString(contents.replace(/^\uFEFF/, ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement.tagName !== 'Aircraft') {
      throw new FormatError(`${aircraftFile.name} is not a SkyDemon aircraft profile.`);
    }
    return [contents, doc];
  }

  private static _bundleXml(
    file: ChecklistFile,
    checklistOptions: SkyDemonChecklistOptions[][],
    newline: string,
  ): string {
    const detectedPhases = SkyDemonFormat.detectFlightPhases(file);
    const indent = (level: number) => SkyDemonFormat.INDENT.repeat(level);
    const lines = [`${indent(1)}<ChecklistBundle>`];
    for (const [groupIdx, group] of file.groups.entries()) {
      for (const [checklistIdx, checklist] of group.checklists.entries()) {
        const options = checklistOptions[groupIdx]?.[checklistIdx] ?? {
          phase: detectedPhases[groupIdx][checklistIdx],
          autoReset: false,
        };
        if (options.phase === SKYDEMON_SKIP) continue;
        lines.push(`${indent(2)}<Checklist Name="${escapeXml(checklist.title)}" FlightPhase="${options.phase}">`);
        for (const section of SkyDemonFormat._sections(checklist)) {
          let sectionAttrs = `Name="${escapeXml(section.name)}"`;
          if (options.autoReset) sectionAttrs += ' AutoReset="True"';
          if (section.header) sectionAttrs += ` Header="${escapeXml(section.header)}"`;
          if (section.footer) sectionAttrs += ` Footer="${escapeXml(section.footer)}"`;
          lines.push(`${indent(3)}<Section ${sectionAttrs}>`);
          for (const item of section.items) {
            lines.push(
              `${indent(4)}<CheckItem Challenge="${escapeXml(item.challenge)}" Response="${escapeXml(item.response)}" />`,
            );
          }
          lines.push(`${indent(3)}</Section>`);
        }
        lines.push(`${indent(2)}</Checklist>`);
      }
    }
    lines.push(`${indent(1)}</ChecklistBundle>`);
    return lines.join(newline);
  }

  /**
   * Splits a checklist into sections at title items. Text at the start or end of a section becomes
   * its header or footer, other text becomes check items without a response.
   */
  private static _sections(checklist: Checklist): SkyDemonSection[] {
    const sections: SkyDemonSection[] = [];
    let name = checklist.title;
    let entries: SectionEntry[] = [];

    const finishSection = () => {
      if (!entries.length) return;
      const section: SkyDemonSection = { name, items: [] };
      const first = entries[0];
      if ('text' in first) {
        section.header = first.text;
        entries.shift();
      }
      const last = entries.at(-1);
      if (last && 'text' in last) {
        section.footer = last.text;
        entries.pop();
      }
      section.items = entries.map((e) => ('item' in e ? e.item : { challenge: e.text, response: '' }));
      sections.push(section);
    };

    for (const item of checklist.items) {
      if (!item.prompt && !item.expectation) {
        // SkyDemon has no blank rows.
        continue;
      }
      switch (item.type) {
        case ChecklistItem_Type.ITEM_TITLE:
          finishSection();
          name = item.prompt;
          entries = [];
          break;
        case ChecklistItem_Type.ITEM_CHALLENGE:
        case ChecklistItem_Type.ITEM_CHALLENGE_RESPONSE:
          entries.push({ item: { challenge: item.prompt, response: item.expectation } });
          break;
        case ChecklistItem_Type.ITEM_PLAINTEXT:
        case ChecklistItem_Type.ITEM_NOTE:
        case ChecklistItem_Type.ITEM_WARNING:
        case ChecklistItem_Type.ITEM_CAUTION:
          entries.push({ text: textWithPrefix(item) });
          break;
        case ChecklistItem_Type.ITEM_SPACE:
          break;
        default:
          throw new FormatError(`Unexpected item type: ${item.type.valueOf()}`);
      }
    }
    finishSection();
    return sections;
  }
}

function textWithPrefix(item: ChecklistItem): string {
  switch (item.type) {
    case ChecklistItem_Type.ITEM_WARNING:
      return `WARNING: ${item.prompt}`;
    case ChecklistItem_Type.ITEM_CAUTION:
      return `CAUTION: ${item.prompt}`;
    default:
      return item.prompt;
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
