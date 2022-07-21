/**
 * @license
 * Copyright 2020 Qlever LLC
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

/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/consistent-type-assertions */

import { join } from 'node:path';

import 'dotenv/config';
import convict from 'convict';

const config = convict({
  oada: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'localhost',
      env: 'DOMAIN',
      arg: 'domain',
    },
    token: {
      doc: 'OADA API token',
      format: Array,
      default: ['god'],
      env: 'TOKEN',
      arg: 'token',
    },
  },
  laserfiche: {
    repository: {
      doc: 'Laserfiche repository',
      default: null as unknown as string,
      format: String,
      env: 'CWS_REPO',
      arg: 'cws-repo',
    },
    baseFolder: {
      doc: 'Top Laserfiche folder to use',
      default: '/FSQA' as `/${string}`,
      format: String,
      env: 'FOLDER',
      arg: 'folder',
    },
    pollRate: {
      doc: 'Rate to poll LaserFiche for documents to process. In milliseconds.',
      default: 10000,
      format: Number,
      env: 'LF_POLL_RATE_MS',
      arg: 'lf-poll-rate',
    },
    cws: {
      login: {
        username: {
          doc: 'CWS login user name',
          nullable: true,
          default: null,
          format: String,
          env: 'CWS_USER',
          arg: 'cws-user',
        } as convict.SchemaObj<string | null>,
        password: {
          doc: 'CWS login password',
          nullable: true,
          default: null,
          format: String,
          env: 'CWS_PASSWORD',
          arg: 'cws-password',
        } as convict.SchemaObj<string | null>,
        serverName: {
          doc: 'CWS server name',
          nullable: true,
          default: null,
          format: String,
          env: 'CWS_SERVER',
          arg: 'cws-server',
        } as convict.SchemaObj<string | null>,
      },
      token: {
        doc: 'CWS API token',
        nullable: true,
        default: null,
        format: String,
        env: 'CWS_TOKEN',
        arg: 'cws-token',
      } as convict.SchemaObj<string | null>,
      apiRoot: {
        doc: 'CWS API root URL',
        default: 'http://localhost/CWSAPI/',
        format: String,
        env: 'CWS_API',
        arg: 'cws-api',
      },
    },
  },
});

/**
 * Error if our options are invalid.
 * Warn if extra options found.
 */
config.validate({ allowed: 'warn' });

// Normalize the folder path
config.set(
  'laserfiche.baseFolder',
  join('/', config.get('laserfiche.baseFolder') ?? '') as `/${string}`
);

export default config;
