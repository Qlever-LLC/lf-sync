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

import { extname, join } from 'node:path';

import equal from 'deep-equal';
import makeDebug from 'debug';

// TODO: Add custom prometheus metrics
import { Counter, Gauge /* Histogram, Summary*/ } from '@oada/lib-prom';
import { type Job, type Json, type WorkerFunction } from '@oada/jobs';
import { type OADAClient } from '@oada/client';

import {
  createDocument,
  getMetadata,
  moveEntry,
  setMetadata,
} from './cws/index.js';
import {
  fetchSyncMetadata,
  fetchVdocFilename,
  getBuffer,
  getPdfVdocs,
  has,
  tradingPartnerByTpKey,
  updateSyncMetadata,
} from './utils.js';
import type { LfSyncMetaData } from './utils.js';
import { transform } from './transformers/index.js';

const trace = makeDebug('lf-sync:trace');
const info = makeDebug('lf-sync:info');
// Const warn = makeDebug('lf-sync:warn');
const error = makeDebug('lf-sync:error');

// Stuff from config
const incomingFolder = join(
  '/',
  config.get('laserfiche.incomingFolder'),
) as unknown as `/${string}`;

// Prometheus Metrics
const incoming = new Counter({
  name: 'lf_sync_items_received',
  help: 'Number of items received',
});
const done = new Counter({
  name: 'lf_sync_items_done',
  help: 'Number of items completed',
});
const inTransit = new Gauge({
  name: 'lf_sync_in_transit',
  help: 'number of documents that have been received, but are not done or errored',
});
const errored = new Counter({
  name: 'lf_sync_lf_errored',
  help: 'Number of items that errored',
});

/**
 * Sync a trellis doc to LF
 */
// export async function sync(job: Job, { conn, jobId}): Promise<LfSyncMetaData> {
export const sync: WorkerFunction = async function (
  job: Job,
  {
    oada: conn,
  }: {
    oada: OADAClient;
  },
): Promise<Json> {
  const { doc, tpKey } = job.config as unknown as any;
  try {
    incoming.inc();
    inTransit.inc();
    const { data: document } = (await conn.get({
      path: `/${doc._id}`,
    })) as unknown as any;
    const fieldList = await transform(document);

    trace('Fetching vdocs for %s', document._id);
    const vdocs = await getPdfVdocs(conn, document);

    // TODO: Replace block with proper master data lookup
    // We should we probably just use the data from the PDF (target), but without a
    // proper master data lookup, we can't resolve trading partner aliases. So for now,
    // we just use the name as known in Trellis.
    if (tpKey) {
      const { name, externalIds } = await tradingPartnerByTpKey(conn, tpKey);
      fieldList.Entity = name.toString() ?? '';
      const xIds = externalIds
        .filter((xid: string) => xid.startsWith('sap:'))
        .map((xid: string) => xid.replace(/^sap:/, ''))
        .join(',');
      fieldList['SAP Number'] = xIds;
    }

    if (!fieldList['Share Mode']) {
      try {
        const { data: shareMode } = (await conn.get({
          path: `/${document._id}/_meta/shared`,
        })) as unknown as { data: string };
        fieldList['Share Mode'] =
          shareMode === 'incoming'
            ? 'Shared To Smithfield'
            : 'Shared From Smithfield';
      } catch (error_: unknown) {
        // @ts-expect-error error nonsense
        if (error_.status !== 404 || error_.code !== '404') throw error_;
        fieldList['Share Mode'] = 'incoming';
      }
    }

    const docsSyncMetadata: Record<string, LfSyncMetaData> = {};

    // Each "vdoc" is a single LF Document (In trellis "documents" have multiple attachments)
    for await (const [key, value] of Object.entries(vdocs)) {
      // TODO: Remove when target-helper vdoc extra link bug is fixed
      if (key === '_id') continue;

      fieldList['Original Filename'] = await fetchVdocFilename(conn, value._id);

      const syncMetadata = await fetchSyncMetadata(conn, document._id, key);
      const syncMetaCopy = { ...syncMetadata };
      let currentFields: LfSyncMetaData['fields'] = {};

      // Document is not new to LF
      if (syncMetadata.LaserficheEntryID) {
        // Fetch the current LF fields to compare for changes
        const metadata = await getMetadata(syncMetadata.LaserficheEntryID);
        // Only keep fields that have a value
        currentFields = metadata.LaserficheFieldList.reduce(
          (o, f) =>
            has(f, 'Value') && f.Value !== '' ? { ...o, [f.Name]: f.Value } : o,
          {},
        );
      }

      syncMetadata.fields ||= {};

      currentFields = { ...syncMetadata.fields, ...currentFields };

      // Only take new automation values if not manually changed in the past
      for (const [k, v] of Object.entries(fieldList)) {
        if (syncMetadata.fields[k] === currentFields[k]) {
          currentFields[k] = v;
        }
      }

      syncMetadata.fields = currentFields;

      // Aka, an empty object
      if (Object.keys(syncMetadata.fields).length === 0) {
        trace(`Document vdoc ${key} has no data yet. Skipping.`);
        continue;
      }

      // Let creationDate;

      // Upsert into LF
      if (syncMetadata.LaserficheEntryID) {
        info(
          `LF Entry ${syncMetadata.LaserficheEntryID} (vdoc ${key}) already exists. Updating.`,
        );
        await setMetadata(
          syncMetadata.LaserficheEntryID,
          syncMetadata.fields || {},
          syncMetadata.fields['Document Type'],
        );

        trace(`Moving the LF document back to _Incoming for filing`);
        await moveEntry(syncMetadata.LaserficheEntryID, incomingFolder);

        // CreationDate = syncMetadata.fields.CreationTime!;

        // New to LF
      } else {
        info(`Document (vdoc ${key}) is new to LF`);

        const { buffer, mimetype } = await getBuffer(conn, value);
        trace('Uploading document to Laserfiche');
        const lfDocument = await createDocument({
          name: `${document._id}-${key}.${extname(syncMetadata.fields['Original Filename'] ?? '').slice(1)}`,
          path: incomingFolder,
          mimetype,
          metadata: syncMetadata.fields || {},
          template: syncMetadata.fields['Document Type'],
          buffer,
        });

        info(
          `Created LF document ${lfDocument.LaserficheEntryID} (vdoc ${key})`,
        );
        syncMetadata.LaserficheEntryID = lfDocument.LaserficheEntryID;
        // CreationDate = new Date().toISOString();
      }
      /* Await reportItem(conn, {
        Entity: syncMetadata.fields.Entity!,
        'Document Type': syncMetadata.fields['Document Type']!,
        'Document Date': syncMetadata.fields['Document Date']!,
        'Share Mode': syncMetadata.fields['Share Mode']!,
        'LF Entry ID': syncMetadata.LaserficheEntryID,
        'LF Creation Date': creationDate,
        'Time Reported': new Date().toISOString(),
        'Trellis Trading Partner ID': tpKey!,
        'Trellis Document ID': document._id,
        'Trellis Document Type': docType!,
        'Trellis File ID': key,
      });
      */

      trace('Recording lf-sync metadata to Trellis document');

      // Update the sync metadata in Trellis only if it has actually changed
      if (!equal(syncMetaCopy, syncMetadata)) {
        await updateSyncMetadata(conn, document, key, syncMetadata);
      }

      docsSyncMetadata[key] = syncMetadata;
    }

    done.inc();
    inTransit.dec();
    return docsSyncMetadata as unknown as Json;
  } catch (error_: unknown) {
    error(error_, `Could not sync document ${doc._id}.`);
    errored.inc();
    inTransit.dec();
    throw error_;
  }
};
