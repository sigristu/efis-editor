import { ChecklistFile, ChecklistItem, ChecklistItem_Type } from '../../../gen/ts/checklist';
import { FormatId } from './format-id';
import { parseChecklistFile, serializeChecklistFile } from './format-registry';
import { GRT_EXPECTED_CONTENTS } from './test-data';
import { loadFile } from './test-utils';
import { TextWriter } from './text-writer';

describe('GrtFormat', () => {
  beforeAll(() => {
    TextWriter.testingTime = new Date(2024, 4, 3);
  });

  afterAll(() => {
    TextWriter.testingTime = undefined;
  });

  it('read then write back test file', async () => {
    // Read file and check the proto contents.
    const f = await loadFile('/src/model/formats/test-grt.txt', 'test.txt');
    const readFile = await parseChecklistFile(f);

    expect(readFile).toEqual(GRT_EXPECTED_CONTENTS);

    // Now write the file back.
    const decoder = new TextDecoder('UTF-8');
    const writtenFile = await serializeChecklistFile(readFile, FormatId.GRT);
    const writtenData = decoder.decode(await writtenFile.arrayBuffer());
    const writtenLines = writtenData.split('\r\n');
    const readData = decoder.decode(await f.arrayBuffer());
    const readLines = readData.split('\r\n');

    expect(writtenLines).toEqual(readLines);
  });

  it('aligns responses, ignoring overly long prompts', async () => {
    const challengeResponse = (prompt: string, expectation: string) =>
      ChecklistItem.create({ type: ChecklistItem_Type.ITEM_CHALLENGE_RESPONSE, prompt, expectation });
    const file = ChecklistFile.create({
      groups: [
        {
          title: 'Group',
          checklists: [
            {
              title: 'Checklist',
              items: [
                challengeResponse('Fuel', 'On'),
                challengeResponse('Mixture', 'Rich'),
                challengeResponse('A prompt that is much too long to be used for alignment', 'Done'),
              ],
            },
          ],
        },
      ],
      metadata: { name: 'Alignment' },
    });

    const writtenFile = await serializeChecklistFile(file, FormatId.GRT);
    const writtenData = new TextDecoder('UTF-8').decode(await writtenFile.arrayBuffer());
    const writtenLines = writtenData.split('\r\n');

    expect(writtenLines).toContain('ITEM Fuel    - On');
    expect(writtenLines).toContain('ITEM Mixture - Rich');
    expect(writtenLines).toContain('ITEM A prompt that is much too long to be used for alignment - Done');

    // Reading it back must not keep the alignment padding.
    const readFile = await parseChecklistFile(new File([writtenFile], 'test.txt'));

    expect(readFile.groups[0].checklists[0].items).toEqual(file.groups[0].checklists[0].items);
  });
});
