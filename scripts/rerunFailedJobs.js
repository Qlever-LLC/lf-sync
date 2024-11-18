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

/* eslint-disable no-console */

import { config } from '../dist/config.js';

import { join } from 'node:path';

import { connect } from '@oada/client';

const { token, domain } = config.get('oada');

setInterval(() => console.log('TICK'), 1000);

async function rerunJobs() {
  const oada = await connect({ token, domain });
  const paths = [
    '/bookmarks/services/lf-sync/jobs/failure/unknown/day-index/2024-07-21',
    '/bookmarks/services/lf-sync/jobs/failure/unknown/day-index/2024-07-22'
  ];
  for await (const path of paths) {
    const { data: jobs } = await oada.get({ path });
    for await (const jobKey of Object.keys(jobs)) {
      const { data: job } = await oada.get({ path: join(path, jobKey) });
      if (job.result.name !== 'HTTPError') {
        console.log('This job was not an HTTPError', JSON.stringify(job, undefined, 2));
      } else {
        await repostJob(oada, job);
      }
    }
  }
}

async function repostJob(oada, job) {
  const { service, config, type } = job;
  const data = { service, config, type };

  console.log('POSTING THIS DATA', data)
  const response = await oada.post({
    path:`/bookmarks/services/lf-sync/jobs/pending`,
    data,
    contentType: 'application/json',
    headers: {
      'x-oada-ensure-link': 'unversioned',
    }
  });
  console.log('POSTED!', response.headers['content-location']);
}

async function deleteJobs() {
  const oada = await connect({ token, domain });
  const path = `/bookmarks/services/lf-sync/jobs/pending`;
  const { data: jobs } = await oada.get({ path });
  for await (const jobKey of Object.keys(jobs).filter(k => !k.startsWith('_'))) {
    await oada.delete({ path: join(path, jobKey) });
  }
}

rerunJobs();