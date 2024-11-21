/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-console, no-process-exit, unicorn/no-process-exit */
/*
 * This script recursively searches the trading partner docs looking for files that
 * are byte-for-byte identical and in the same folder. The newest copy of the
 * matching copies is kept, and then rest are trashed.
 */
import { browse, getFolderContents } from '../../cws/folders.js';
import { type FolderEntry } from '../../cws/entries.js';

// No good way to fetch the `Entry` of a specific path...
const partners = await browse(`/trellis/trading-partners`);

// So just loop over the top layer and then do recursion from there
for await (const partner of partners) {
  if (partner.Type === 'Folder') {
    await findZeroSized(partner);
  }
}

async function findZeroSized(root: FolderEntry) {
  console.info(`[TRACE] In ${root.Path}`);
  const items = await getFolderContents(root);

  for await (const item of items) {
    switch (item.Type) {
      case 'Folder': {
        await findZeroSized(item);
        break;
      }

      case 'Document': {
        // There is currently a bug where we have zero sized docs. We need to fix that,
        // but for now skip them here beacuse they cause problems later in the script
        if (item.ElectronicDocumentSize === 0) {
          console.info(`[FOUND] (${item.EntryId}): ${item.Path} is 0 sized.`);
        }

        break;
      }
    }
  }
}

process.exit();
