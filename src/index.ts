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

import { config } from './config.js';

import '@oada/pino-debug';

import { join } from 'node:path';

import { CronJob } from 'cron';
import { JsonPointer } from 'json-ptr';
import { backOff } from 'exponential-backoff';
import esMain from 'es-main';
import ksuid from 'ksuid';
import makeDebug from 'debug';
import pTimeout from 'p-timeout';

import {
  AssumeState,
  type Change,
  ChangeType,
  ListWatch,
} from '@oada/list-lib';
import { type Job, type Json, Service, type WorkerFunction } from '@oada/jobs';
import { type JsonObject, type OADAClient, connect } from '@oada/client';
import {
  type default as Resource,
  assert as assertResource,
} from '@oada/types/oada/resource.js';

import {
  DOCS_LIST,
  LF_AUTOMATION_FOLDER,
  TRADING_PARTNER_LIST,
  selfDocsTree,
  tpDocTypesTree,
  tpDocsTree,
  tpTree,
  tree,
} from './tree.js';
import type { DocumentEntry, EntryId, EntryIdLike } from './cws/index.js';
import { browse, getEntryId, moveEntry, retrieveEntry } from './cws/index.js';
import { sync } from './sync.js';

const selfChange = new JsonPointer('/body/_meta/services/lf-sync');

const trace = makeDebug('lf-sync:trace');
const info = makeDebug('lf-sync:info');
const warn = makeDebug('lf-sync:warn');

// Stuff from config
const { token, domain } = config.get('oada');
const CONCURRENCY = config.get('concurrency');
const LF_POLL_RATE = config.get('laserfiche.pollRate');
const SYNC_JOB_TIMEOUT = config.get('timeouts.sync');
const ENTRY_JOB_TIMEOUT = config.get('timeouts.getEntry');
const REPORT_PATH = '/bookmarks/services/lf-sync/jobs/reports/docs-synced';

// OADA is rate limited by @oada/client
// LF is *NOT* rate limited, but only has sparse calls per *pending document* at this time

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

async function startService() {
  info('Service: lf-sync');
  info(`Version: ${process.env.npm_package_version}`);

  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain }));

  const svc = new Service({
    name: 'lf-sync',
    oada: conn,
    concurrency: CONCURRENCY,
  });

  // Poll LF for customer docs that SF drops into the _TrellisAutomation folder
  // watchLaserfiche();

  // Handle syncing docs to lf
  svc.on('sync-doc', config.get('timeouts.sync'), sync);

  // Handle outside inquiries for the LF Entry ID on trellis docs
  svc.on('get-lf-entry', config.get('timeouts.getEntry'), getLfEntry);

  // Ensure the reporting endpoint is created
  //  await oada.ensure({ path: REPORT_PATH, data: {}, tree });
  // svc.addReport({});

  const serv = svc.start();

  //const sjc = startSyncJobCreator(conn);

  //await Promise.all([serv, sjc]);
  await serv;
}

/**
 *
 */
export function watchLaserfiche(
  task: (file: DocumentEntry) => void,
): (id: EntryIdLike) => void {
  const workQueue = new Map<number, number>();

  const job = new CronJob(`*/${LF_POLL_RATE} * * * * *`, async () => {
    const start = new Date();

    for await (const [id, startTime] of workQueue.entries()) {
      if (start.getTime() > startTime + SYNC_JOB_TIMEOUT) {
        warn(`LF ${id} work never completed. moved to _NeedsReview`);
        await moveEntry(id as EntryId, '/_NeedsReview');
        workQueue.delete(id);
      }
    }

    trace(`${start.toISOString()} Polling LaserFiche.`);

    const files = await backOff(async () => browse(LF_AUTOMATION_FOLDER));
    for await (const file of files) {
      if (!workQueue.has(file.EntryId)) {
        if (file.Type !== 'Document') {
          info(`LF ${file.EntryId} not a document. Moved to _NeedsReview.`);
          await moveEntry(file, '/_NeedsReview');

          continue;
        }

        workQueue.set(file.EntryId, Date.now());

        // Do work
        task(file);
      }
    }
  });

  job.start();

  return (id: EntryIdLike) => {
    workQueue.delete(getEntryId(id));
  };
}

interface LfMetaEntry {
  LaserficheEntryID: number;
  fields: Record<string, string>;
  lastSync: string;
}

// TODO: Should really be a OADAMetaResource & that crap, but idk what its called atm
interface MetaEntry {
  _rev: number;
  services: {
    'lf-sync'?: Record<string, LfMetaEntry>;
  };
  vdoc: {
    pdf: Record<
      string,
      {
        _id: string;
      }
    >;
  };
}

/**
 * Retrieve the LF Entry ID for a given trellis document or wait for it to be created
 */
const getLfEntry: WorkerFunction = async function (
  job: Job,
  {
    oada: conn,
  }: {
    oada: OADAClient;
  },
): Promise<Json> {
  const { doc } = job.config as unknown as any;
  let data: Record<string, LfMetaEntry> = {};
  const { data: meta } = (await conn.get({
    path: join('/', doc, '/_meta'),
  })) as unknown as { data: MetaEntry };
  data = meta.services?.['lf-sync'] ?? {};

  if (Object.keys(meta.vdoc.pdf).every((key) => data[key])) {
    return entriesFromMeta(data);
  }

  info('Missing LF Entries for vdocs, waiting for remainder');
  return waitForLfEntries(conn, doc, meta);
};

async function waitForLfEntries(
  conn: OADAClient,
  path: string,
  meta: MetaEntry,
): Promise<Json> {
  let data = meta.services?.['lf-sync'] ?? {};
  const { changes } = await conn.watch({
    path: join('/', path),
    type: 'single',
    rev: meta._rev,
  });

  const unwatch = async () => {
    await changes.return?.();
  };

  async function watchChanges() {
    for await (const change of changes) {
      if (selfChange.has(change)) {
        info(
          `Got a change containing a meta entry for one of the vdocs: ${path}`,
          selfChange.get(change),
        );
        data = {
          ...data,
          ...(selfChange.get(change) as Record<string, LfMetaEntry>),
        };
        if (Object.keys(meta.vdoc.pdf).every((key) => data[key])) {
          info(
            `Got a meta entries for every vdoc of ${path}. Fetching entries`,
          );
          await unwatch();
          return entriesFromMeta(data);
        }
      }
    }
  }

  return pTimeout(watchChanges(), { milliseconds: ENTRY_JOB_TIMEOUT });
}

/**
 *
 * @param metadoc
 * @returns
 */
// TODO: If the Entry doesn't contain a Path, wait for for a bit
async function entriesFromMeta(metadoc: Record<string, LfMetaEntry>) {
  const entries = [];
  for await (const [key, value] of Object.entries(metadoc)) {
    const result = await backOff(async () => {
      const entry = await retrieveEntry(value.LaserficheEntryID as any);
      if (entry.Path.startsWith(String.raw`\FSQA\_Incoming`)) {
        throw new Error('Entry is still in _Incoming');
      } else {
        return entry;
      }
    });
    entries.push([
      key,
      {
        ...value,
        path: result.Path,
      },
    ]);
  }

  return Object.fromEntries(entries);
}

/**
 * Start-up for a given user (token)
 */
async function startSyncJobCreator(conn: OADAClient) {
  // Watch for new trading partner documents to process
  if (config.get('watch.partners')) {
    watchPartnerDocs(conn, async (item, tpKey) =>
      queueSyncJob(conn, { item, tpKey }),
    );
  }

  // Watch for new "self" documents to process
  if (config.get('watch.own')) {
    watchSelfDocs(conn, async (item) => queueSyncJob(conn, { item }));
  }
}

interface SyncJobConfig {
  item: any;
  docType?: string;
  tpKey?: string;
}

/**
 *
 * @param conn oada client connection
 * @param doc the
 */
async function queueSyncJob(conn: OADAClient, config: SyncJobConfig) {
  const result = await conn.post({
    path: `/resources`,
    data: {
      service: 'lf-sync',
      type: 'sync-doc',
      config: {
        doc: { _id: config.item._id },
        ...(config.tpKey ? { tpKey: config.tpKey } : undefined),
      },
    } as unknown as JsonObject,
    contentType: 'application/json',
  });

  const _id = result.headers['content-location']!.slice(1);
  const key = result?.headers['content-location']!.replace(/\/resources\//, '');

  await conn.put({
    path: `/bookmarks/services/lf-sync/jobs/pending/${key}`,
    data: {
      _id,
    },
    contentType: 'application/json',
  });
}

function watchPartnerDocs(
  conn: OADAClient,
  callback: (item: Resource, tpKey: string) => void | PromiseLike<void>,
) {
  info('Monitoring %s for new/current partners', TRADING_PARTNER_LIST);
  // TODO: Update these to new ListWatch v4 API
  const watch = new ListWatch({
    conn,
    resume: false, // No oada-list-lib entry in the _meta doc! May have previously, but is no more!
    path: TRADING_PARTNER_LIST,
    onNewList: AssumeState.New,
    tree: tpTree,
  });
  watch.on(
    ChangeType.ItemAdded,
    async ({ pointer: tpKey }: { pointer: string }) => {
      const documentPath = join(TRADING_PARTNER_LIST, tpKey, DOCS_LIST);
      info('Monitoring %s for new/current document types', documentPath);
      const docTypeWatch = new ListWatch({
        conn,
        resume: false, // No oada-list-lib entry in the _meta doc! May have previously, but is no more!
        path: documentPath,
        onNewList: AssumeState.New,
        tree: tpDocsTree,
      });
      docTypeWatch.on(
        ChangeType.ItemAdded,
        async ({ pointer: type }: { pointer: string }) => {
          // Watch for new documents of type `type`
          const path = join(documentPath, type);

          // If (!type.toLowerCase().includes('tickets')) return;
          // FIXME: Remove this before production
          info('Monitoring %s for new documents of type %s', path, type);
          const docWatch = new ListWatch({
            conn,
            name: `lf-sync:to-lf:${tpKey.replace('/', '')}:${type.replace('/', '')}`,
            resume: true,
            path,
            assertItem: assertResource,
            onNewList: AssumeState.Handled,
            tree: tpDocTypesTree,
          });
          docWatch.on(
            ChangeType.ItemAdded,
            async ({ item }: { item: Promise<Resource> }) => {
              await callback(await item, tpKey);
            },
          );
          docWatch.on(
            ChangeType.ItemChanged,
            async ({
              change,
              pointer: documentKey,
            }: {
              change: Change;
              pointer: string;
            }) => {
              if (selfChange.has(change)) {
                trace('Ignoring self made change to resource.');
                return;
              }

              trace(`Got work (change): ${join(path, documentKey)}`);

              // Fetch resource
              const data = await oada.get({
                path: change.resource_id,
              });
              const item = data.data as Resource;

              await callback(item, tpKey);
            },
          );
          process.on('beforeExit', async () => docWatch.stop());
        },
      );
      process.on('beforeExit', async () => docTypeWatch.stop());
      // }
    },
  );
  process.on('beforeExit', async () => watch.stop());
}

function watchSelfDocs(
  conn: OADAClient,
  callback: (item: Resource) => Promise<void>,
) {
  // Watching "self" documents are /bookmarks/trellisfw/documents
  // TODO: Update these to new ListWatch v4 API
  const docTypeWatch = new ListWatch({
    conn,
    name: 'lf-sync:to-lf-own',
    resume: false,
    path: DOCS_LIST,
    tree: selfDocsTree,
  });
  trace(`Monitoring ${DOCS_LIST} for new/current document types`);
  docTypeWatch.on(
    ChangeType.ItemAdded,
    async ({ pointer: type }: { pointer: string }) => {
      // Watch documents at /bookmarks/trellisfw/documents/<type=key>
      const path = join(DOCS_LIST, type);

      const docWatch = new ListWatch({
        conn,
        name: `lf-sync:to-lf-own`,
        resume: true,
        path,
        assertItem: assertResource,
        tree,
      });
      trace(`Monitoring ${path} for new documents`);
      docWatch.on(
        ChangeType.ItemAdded,
        async ({
          item,
          pointer: documentKey,
        }: {
          item: Promise<Resource>;
          pointer: string;
        }) => {
          trace(`Got work (new): ${join(path, documentKey)}`);
          await callback(await item);
        },
      );
      docWatch.on(
        ChangeType.ItemChanged,
        async ({
          change,
          pointer: documentKey,
        }: {
          change: Change;
          pointer: string;
        }) => {
          if (selfChange.has(change)) {
            trace('Ignoring self made change to resource.');
            return;
          }

          trace(`Got work (change): ${join(path, documentKey)}`);

          // Fetch resource
          const data = await oada.get({
            path: change.resource_id,
          });
          const item = data.data as Resource;

          await callback(item);
        },
      );
      process.on('beforeExit', async () => docWatch.stop());
    },
  );
  process.on('beforeExit', async () => docTypeWatch.stop());
}

/**
 *  Report on each item synced
 */
export async function reportItem(conn: OADAClient, item: ReportEntry) {
  const key = ksuid.randomSync().string;
  const date = new Date().toISOString().split('T')[0];
  const path = `${REPORT_PATH}/day-index/${date}`;
  await conn.put({
    path,
    data: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      [key]: item as any,
    },
    tree,
  });
  info(`Reported item to ${path}/${key}`);
}

interface ReportEntry {
  'Entity': string; // SyncMetadata.fields.Entity,
  'Document Type': string; // SyncMetadata.fields['Document Type'],
  'Document Date': string; // SyncMetadata.fields['Document Date'],
  'Share Mode': string; // SyncMetadata.fields['Share Mode'],
  'LF Entry ID': number; // SyncMetadata.LaserficheEntryID,
  'LF Creation Date': string; // Date the LF Entry was created; tells us whether it was an update/create operation
  'Time Reported': string; // ISOString date when the item was processed,
  'Trellis Trading Partner ID': string; // `/bookmarks/trellisfw/trading-partners/${tpKey}`,
  'Trellis Document ID': string; // `/bookmarks/trellisfw/trading-partners/${tpKey}`,
  'Trellis Document Type': string;
  'Trellis File ID': string; // The actual binary doc synced,
}

if (esMain(import.meta)) {
  await startService();
}
