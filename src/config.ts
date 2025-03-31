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

/* eslint-disable unicorn/no-null */

import {
  DOCS_LIST,
  LF_AUTOMATION_FOLDER,
  TRADING_PARTNER_LIST,
} from './tree.js';
import libConfig from '@oada/lib-config';

import { join } from 'node:path';

export const { config } = await libConfig({
  'timeouts': {
    sync: {
      doc: 'OADA client timeout used on requests',
      format: Number,
      default: 10_000,
      env: 'SYNC_JOB_TIMEOUT',
      arg: 'sync-job-timeout',
    },
    getEntry: {
      doc: 'OADA client timeout used on requests',
      format: Number,
      default: 10_000,
      env: 'ENTRY_JOB_TIMEOUT',
      arg: 'entry-job-timeout',
    },
  },
  'watch': {
    partners: {
      doc: `Watch the ${TRADING_PARTNER_LIST} for documents`,
      format: Boolean,
      default: true,
      env: 'LF_SYNC_WATCH_PARTNERS',
      arg: 'watch-partners',
    },
    own: {
      doc: `Watch the ${DOCS_LIST} for documents`,
      format: Boolean,
      default: true,
      env: 'LF_SYNC_WATCH_OWN',
      arg: 'watch-own',
    },
    lf: {
      doc: `Watch the LF ${LF_AUTOMATION_FOLDER} for documents`,
      format: Boolean,
      default: true,
      env: 'LF_SYNC_WATCH_LF',
      arg: 'watch-lf',
    },
  },
  'concurrency': {
    doc: `The maximum number of documents to process at one time.`,
    format: 'int',
    default: 5,
    env: 'LF_SYNC_CONCURRENCY',
    arg: 'concurrency',
  },
  'oada': {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'localhost',
      env: 'DOMAIN',
      arg: 'domain',
    },
    timeout: {
      doc: 'OADA client timeout used on requests',
      format: Number,
      default: 10_000,
      env: 'OADA_TIMEOUT',
      arg: 'timeout',
    },
    token: {
      doc: 'OADA API token',
      format: String,
      default: 'god',
      env: 'TOKEN',
      arg: 'token',
    },
    concurrency: {
      doc: `The number of simultaneous requests allowed by the client connection.`,
      format: 'int',
      default: 5,
      env: 'CLIENT_CONCURRENCY',
      arg: 'client-concurrency',
    },
  },
  'laserfiche': {
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
      env: 'LF_FOLDER',
      arg: 'lf-folder',
    },
    incomingFolder: {
      doc: 'Laserfiche folder to drop documents into',
      default: '/_Incoming',
      format: String,
      env: 'LF_INCOMING',
      arg: 'lf-incoming',
    },

    pollRate: {
      doc: 'Rate to poll LaserFiche for documents to process. In seconds.',
      default: 5,
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
        },
        password: {
          doc: 'CWS login password',
          nullable: true,
          default: null,
          format: String,
          env: 'CWS_PASSWORD',
          arg: 'cws-password',
        },
        serverName: {
          doc: 'CWS server name',
          nullable: true,
          default: null,
          format: String,
          env: 'CWS_SERVER',
          arg: 'cws-server',
        },
      },
      token: {
        doc: 'CWS API token',
        nullable: true,
        default: null,
        format: String,
        env: 'CWS_TOKEN',
        arg: 'cws-token',
      },
      apiRoot: {
        doc: 'CWS API root URL',
        default: 'http://localhost/CWSAPI/',
        format: String,
        env: 'CWS_API',
        arg: 'cws-api',
      },
      timeout: {
        doc: 'CWS API timeout for individual requests',
        default: 60_000,
        format: Number,
        env: 'CWS_TIMEOUT',
        arg: 'cws-timeout',
      },
    },
  },
  'lfdynamic': {
    password: {
      doc: 'password for accessing LFDynamic MSSQL Table',
      format: String,
      default: '',
      env: 'LFDYNAMIC_PASS',
      arg: 'lfdynamic-pass',
    },
    port: {
      doc: 'port for accessing LFDynamic',
      format: Number,
      default: 0,
      env: 'LFDYNAMIC_PORT',
      arg: 'lfdynamic-DB',
    },
    database: {
      doc: 'Database for accessing LFDynamic',
      format: String,
      default: '',
      env: 'LFDYNAMIC_DB',
      arg: 'lfdynamic-db',
    },
    user: {
      doc: 'Username for accessing LFDynamic',
      format: String,
      default: '',
      env: 'LFDYNAMIC_USER',
      arg: 'lfdynamic-user',
    },
    server: {
      doc: 'Username for accessing LFDynamic',
      format: String,
      default: '',
      env: 'LFDYNAMIC_SERVER',
      arg: 'lfdynamic-server',
    },
  },
  'local-mysql': {
    database: {
      doc: 'db for accessing local mysql',
      format: String,
      default: '',
      env: 'LOCALDB_NAME',
      arg: 'localdb-name',
    },
    host: {
      doc: 'host for accessing local mysql',
      format: String,
      default: 'localhost',
      env: 'LOCALDB_HOST',
      arg: 'localdb-host',
    },
    password: {
      doc: 'password for accessing local mysql',
      format: String,
      default: '',
      env: 'LOCALDB_PASS',
      arg: 'localdb-pass',
    },
    user: {
      doc: 'user for accessing local mysql',
      format: String,
      default: 'root',
      env: 'LOCALDB_USER',
      arg: 'localdb-user',
    },
  },
});

// Normalize the folder path
config.set(
  'laserfiche.baseFolder',
  join('/', config.get('laserfiche.baseFolder') ?? '') as `/${string}`,
);
