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

/* eslint-disable no-console, no-process-exit, unicorn/no-process-exit, unicorn/no-array-reduce, max-depth */
/*
 * This script recursively searches the trading partner docs looking for files that
 * are byte-for-byte identical and in the same folder. The newest copy of the
 * matching copies is kept, and then rest are trashed.
 */
import {
  type DocumentEntry,
  type FolderEntry,
  moveEntry,
} from '../../cws/entries.js';
import { browse, getFolderContents } from '../../cws/folders.js';
import { createHash } from 'node:crypto';
import { retrieveDocumentContent } from '../../cws/download.js';

interface HashedDoc {
  hash: string;
  doc: DocumentEntry;
}

const partners = await browse(`/trellis/trading-partners`);

for await (const partner of partners) {
  if (partner.Type === 'Folder') {
    await trashDuplicates(partner);
  }
}

async function trashDuplicates(root: FolderEntry) {
  console.info(`\t [TRACE] In ${root.Path}`);
  const items = await getFolderContents(root);

  const docs: DocumentEntry[] = [];
  for await (const item of items) {
    switch (item.Type) {
      case 'Folder': {
        await trashDuplicates(item);
        break;
      }

      case 'Document': {
        // There is currently a bug where we have zero sized docs. We need to fix that,
        // but for now skip them here beacuse they cause problems later in the script
        if (item.ElectronicDocumentSize === 0) {
          console.warn(
            `WARN: Found 0 sized document? ${item.EntryId}: ${item.Path}`,
          );
        } else {
          docs.push(item);
        }

        break;
      }
    }
  }

  // First, groupby file size and remove everything that doesn't have matches.
  // This is strictly not required, but considerably limits the number of document
  // buffers we need to download from LF-Sync to compute hash.

  // Group by the ElectronicDocumentSize
  let matches = groupByToMap(docs, (doc) => doc.ElectronicDocumentSize);
  // Only keep groups that have multiple docs
  matches = filterObject(matches, (key, data) => (data[key] ?? []).length > 1);

  // For all potential duplicates, download the file, compute their hashes
  const hashes: HashedDoc[] = [];
  for await (const key of Object.keys(matches)) {
    hashes.push(
      ...(await Promise.all(
        (matches[key] ?? []).map(async (doc) => ({
          hash: createHash('sha256')
            .update(await retrieveDocumentContent(doc))
            .digest('base64'),
          doc,
        })),
      )),
    );
  }

  // Re-group (by hash) and filter down to true duplicates
  let hashMatches = groupByToMap(hashes, (doc) => doc.hash);
  hashMatches = filterObject(
    hashMatches,
    (key, data) => (data[key] ?? []).length > 1,
  );

  // Loop through each duplicate and fix it
  for await (const hash of Object.keys(hashMatches)) {
    const hashMatch = hashMatches[hash];
    if (!hashMatch) {
      continue;
    }

    // Remove any "(N)" pattern that LF may have added to the filename, so we can group by intended file name
    const cleanNames = hashMatch.map((hashDoc) => {
      const { doc } = hashDoc;
      return {
        cleanName: doc.Name.replace(/\s\(\d\)$/, ''),
        doc,
      };
    });

    // Group by "clean" filename, to see if they were originally intended to be the same
    const cleanNameMatches = groupByToMap(
      cleanNames,
      (match) => match.cleanName,
    );

    for await (const cleanName of Object.keys(cleanNameMatches)) {
      const cleanNameMatch = cleanNameMatches[cleanName];
      if (!cleanNameMatch?.[0]) {
        continue;
      }

      // Find the most recently changed doc in the match of duplicates
      let newestDoc = cleanNameMatch[0].doc;
      for (const { doc } of cleanNameMatch) {
        const d1 = new Date(doc.LastModifiedTime).getTime();
        const d2 = new Date(newestDoc.LastModifiedTime).getTime();
        if (d1 - d2 > 0) {
          newestDoc = doc;
        }
      }

      // This is the same file as another file in the same folder, but with a different intended name. Keep.
      if (cleanNameMatch.length === 1) {
        console.log(
          `[DIFFERENT_NAME] (${newestDoc.EntryId}) ${cleanName} is the same as another file, but with a different name. Keeping.`,
        );
      } else {
        console.log(
          `[DUPLICATE] (${newestDoc.EntryId}) ${cleanName} is duplicates with ${cleanNameMatch.length} files. Keeping the newest one only.`,
        );

        for await (const { doc } of cleanNameMatch) {
          if (doc.EntryId === newestDoc.EntryId) {
            console.info(
              `\t [TRACE] Renamed (${newestDoc.EntryId}) ${newestDoc.Path} to ${cleanName}`,
            );
            // Await renameDocument(newestDoc, cleanName);
          } else {
            console.info(
              `\t [TRACE] Moved (${doc.EntryId}) ${doc.Path} to trash`,
            );
            await moveEntry(doc, trashPath(doc.Path));
          }
        }
      }
    }
  }
}

// Build a map of the array values, grouped by whatever is returned by getKey callback
type Key = string | number;
function groupByToMap<T>(o: T[], getKey: (item: T) => Key): Record<Key, T[]> {
  return o.reduce<Record<Key, T[]>>(
    (groups: Record<Key, T[]>, item: T): Record<Key, T[]> => {
      const key = getKey(item);
      groups[key] = [...(groups[key] ?? []), item];
      return groups;
    },
    {},
  );
}

function filterObject<T>(
  o: Record<Key, T[]>,
  predicate: (key: Key, o: Record<Key, T[]>) => boolean,
): Record<Key, T[]> {
  return Object.keys(o)
    .filter((key) => predicate(key, o))
    .reduce<Record<Key, T[]>>((oNew, key) => {
      if (o[key]) {
        oNew[key] = o[key];
      }

      return oNew;
    }, {});
}

function trashPath(path: string): `/${string}` {
  const parts = path.split('\\').slice(2, -1);
  parts[0] = 'trellis-trash';
  return `/${parts.join('/')}`;
}

process.exit();