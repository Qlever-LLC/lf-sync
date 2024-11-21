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

/* eslint-disable no-console, no-process-exit, unicorn/no-process-exit, max-depth */

/*
 * This script will recursively move through the trading partners tree and move all
 * documents of the given types to trash.
 */

import { browse, getFolderContents } from '../../cws/folders.js';
import { argv } from 'node:process';

if (argv.length < 3) {
  console.error(
    'USAGE: node list-by-doc-types.js docType1 <docType2> ... <docTypeN>',
  );
  console.log('For example: node list-by-doc-types.js "W-9" "ACH Form"');
  process.exit(1);
}

const docTypes = new Set(argv.splice(2));

const partners = await browse(`/trellis/trading-partners`);
for await (const partner of partners) {
  try {
    if (partner.Type !== 'Folder') {
      console.error('Non-folder? Parent: /trellis/trading-partner path?');
      process.exit();
    }

    const shareDirections = await getFolderContents(partner);

    for await (const shareDirection of shareDirections) {
      if (shareDirection.Type !== 'Folder') {
        console.error(`Non-folder? Parent: ${partner.EntryId}`);
        process.exit();
      }

      const types = await getFolderContents(shareDirection);

      for await (const type of types) {
        if (type.Type !== 'Folder') {
          console.error(`Non-folder? Parent: ${shareDirection.EntryId}`);
          process.exit();
        }

        if (docTypes.has(type.Name)) {
          const dates = await getFolderContents(type);

          for await (const date of dates) {
            if (date.Type !== 'Folder') {
              console.error(`Non-folder? Parent: ${date.EntryId}`);
              process.exit();
            }

            const tickets = await getFolderContents(date);
            for await (const ticket of tickets) {
              if (ticket.Type !== 'Folder') {
                console.error(`Non-folder? Parent: ${ticket.EntryId}`);
                process.exit();
              }

              console.log(
                `Found ${ticket.Name} (${ticket.EntryId}) ${ticket.Path}`,
              );
            }
          }
        }
      }
    }
  } catch (error: unknown) {
    if (
      error &&
      (error as { code: string | undefined }).code !==
        'ERR_NON_2XX_3XX_RESPONSE'
    ) {
      console.log(error);
      process.exit();
    }
  }
}

console.log('DONE');
process.exit();
