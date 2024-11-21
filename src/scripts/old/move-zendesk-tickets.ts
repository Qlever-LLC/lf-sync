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

import { browse, createFolder } from '../../cws/folders.js';
import { moveEntry } from '../../cws/entries.js';

/*
 * This script was written to "reset" LaserFiche after some early zendesk-sync operations.
 * All tickets archived into LaserFiche are moved out of the trading-partner folder structure
 * and into a temporary holding location. After the new sync is complete and correct, the temporary
 * resources can be removed.
 */
const partners = await browse(`/trellis/trading-partners`);

for await (const partner of partners) {
  try {
    console.log(`=== ${partner.Name}`);
    const tickets = await browse(
      `/trellis/trading-partners/${partner.Name}/Shared From Smithfield/Zendesk Ticket`,
    );

    // Ensure the backup folder for the trading partner
    const backupPath =
      `/trellis/_TrellisBackup/trading-partners/${partner.Name}` as `/${string}`;
    await createFolder({
      path: backupPath,
    });

    for await (const ticket of tickets) {
      // Move the ticket folder to the backup location
      console.log(`- ${ticket.Name}`);

      await moveEntry(ticket, backupPath);
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

process.exit();
