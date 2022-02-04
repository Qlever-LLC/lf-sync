/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Import this first to setup the environment
import config from './config.js';

import { OADAClient, connect } from '@oada/client';

// Stuff from config
const { token: tokens, domain } = config.get('oada');

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

/**
 * Start-up for a given user (token)
 */
async function run(token: string) {
  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain: `https://${domain}` }));

  /**
   * Now do your service stuff...
   */
  await conn.head({ path: '/bookmarks' });
}

await Promise.all(tokens.map(async (token) => run(token)));
