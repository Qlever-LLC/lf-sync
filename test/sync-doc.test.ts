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

import {
  filingWorkflow,
  getFormattedDate
} from '../dist/utils.js';
import { config } from '../dist/config.js';
import { connect } from '@oada/client';
import { doJob } from '@oada/client/jobs';
import test from 'ava';
// @ts-ignore
const { domain, token } = config.get('oada');

let oada = await connect({ domain, token })

test('filing workflow', async (t) => {
  let result = await doJob(oada, {
    service: 'lf-sync',
    type: 'sync-doc',
    config: {
      //doc: { _id: 'resources/2jZ34SPf7qMPBiRFr4QebddgSnc'},
      //tradingPartner: 'resources/2TA8ikqFp44u7nfz2UYK7FQweF1',

      // dev
      doc: { _id: 'resources/2nYGl57bHxlklRcRqFRHhChicrn'},
      tradingPartner: 'resources/2fZ3qnoDID1fcNtBrsiKNKBezK4',
    }
  })

  console.log(result);
});

