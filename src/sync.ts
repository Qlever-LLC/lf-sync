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

import '@oada/pino-debug';

import equal from 'deep-equal';

import { type Job, type Json, type WorkerContext } from '@oada/jobs';

import type { LfSyncMetaData, Metadata } from './utils.js';
import {
  createDocument,
  getMetadata,
  moveEntry,
  renameEntry,
  retrieveEntry,
  setMetadata,
} from './cws/index.js';
import {
  fetchSyncMetadata,
  fetchTradingPartner,
  fetchVdocMeta,
  filingWorkflow,
  getBuffer,
  getPdfVdocs,
  has,
  updateSyncMetadata,
} from './utils.js';
import { HTTPError } from 'got';
import type Link from '@oada/types/oada/link/v1.js';
import type Resource from '@oada/types/oada/resource.js';
import { getTransformers } from './transformers/index.js';

export interface SyncConfig {
  doc: Link;
  tpKey: string;
  tradingPartner: string;
}

/**
 * Sync a trellis doc to LF
 */
// eslint-disable-next-line complexity, sonarjs/cognitive-complexity
export async function sync(
  job: Job,
  { oada, log }: WorkerContext,
): Promise<Json> {
  // Keeping deprecating tpKey
  const { doc, tpKey, tradingPartner } = job.config as unknown as SyncConfig;
  try {
    const { data: document } = (await oada.get({
      path: `/${doc._id}`,
    })) as unknown as { data: Resource };
    const transformers = getTransformers(document._type);

    if (!transformers) {
      throw new Error('Document type is unknown.');
    }

    const fieldList = await transformers.doc(document);

    if (!(tradingPartner || tpKey)) {
      throw new Error('No trading partner key or id provided');
    }

    const { name, externalIds } = await fetchTradingPartner(
      oada,
      tradingPartner || tpKey,
    );
    fieldList.Entity = name.toString() ?? '';
    const xIds = externalIds
      .filter((xid: string) => xid.startsWith('sap:'))
      .map((xid: string) => xid.replace(/^sap:/, ''))
      .join(',');
    fieldList['SAP Number'] = xIds;

    if (!fieldList['Share Mode']) {
      try {
        const { data: shareMode } = (await oada.get({
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

    log.trace('Fetching vdocs for %s', document._id);
    const vdocs = await getPdfVdocs(oada, document);

    // Each "vdoc" is a single LF Document (In trellis "documents" have multiple attachments)
    for await (const [key, value] of Object.entries(vdocs)) {
      // TODO: Remove when target-helper vdoc extra link bug is fixed
      if (key === '_id') continue;

      // Prep the fields list with
      const fields = {
        ...fieldList,
        ...(transformers.vdoc
          ? await transformers.vdoc(await fetchVdocMeta(oada, value._id))
          : {}),
      };

      const syncMetadata = await fetchSyncMetadata(
        oada,
        document._id,
        key,
        log,
      );
      const syncMetaCopy = { ...syncMetadata };
      let currentFields: LfSyncMetaData['fields'] = {};

      // Document is not new to LF
      if (syncMetadata.LaserficheEntryID) {
        // Fetch the current LF fields to compare for changes
        try {
          const metadata = await getMetadata(syncMetadata.LaserficheEntryID);
          // Only keep fields that have a value
          // eslint-disable-next-line unicorn/no-array-reduce
          currentFields = metadata.LaserficheFieldList.reduce(
            (o, f) =>
              has(f, 'Value') && f.Value !== ''
                ? { ...o, [f.Name]: f.Value }
                : o,
            {},
          );
        } catch (error) {
          if (
            error instanceof HTTPError &&
            error.response.rawBody.includes('Entry not found')
          ) {
            // Document was removed from Laserfiche, process it like it is new.
            syncMetadata.LaserficheEntryID = undefined;
          }
        }
      }

      syncMetadata.fields ||= {};

      currentFields = { ...syncMetadata.fields, ...currentFields };

      // Only take new automation values if not manually changed in the past
      for (const [k, v] of Object.entries(fields)) {
        if (syncMetadata.fields[k] === currentFields[k]) {
          currentFields[k] = v;
        }
      }

      syncMetadata.fields = currentFields;

      // Aka, an empty object
      if (Object.keys(syncMetadata.fields).length === 0) {
        log.trace(`Document vdoc ${key} has no data yet. Skipping.`);
        continue;
      }

      const { path, filename } = filingWorkflow(
        syncMetadata.fields as unknown as Metadata,
      );

      // Upsert into LF
      if (syncMetadata.LaserficheEntryID) {
        log.info(
          `LF Entry ${syncMetadata.LaserficheEntryID} (vdoc ${key}) already exists. Updating.`,
        );
        await setMetadata(
          syncMetadata.LaserficheEntryID,
          syncMetadata.fields || {},
          syncMetadata.fields['Document Type'],
        );

        log.trace(`Moving the LF document to ${path} with name ${filename}`);
        // Use our own filing workflow instead of incomingFolder
        await moveEntry(syncMetadata.LaserficheEntryID, path as `/{string}`);
        // Rename is different from Metadata, but should be part of upsert
        await renameEntry(syncMetadata.LaserficheEntryID, path as `/{string}`, filename);

        // New to LF
      } else {
        log.info(`Document (vdoc ${key}) is new to LF`);

        const { buffer, mimetype } = await getBuffer(log, oada, value);
        log.trace('Uploading document to Laserfiche');
        const lfDocument = await createDocument({
          // Name: `${document._id}-${key}.${extname(syncMetadata.fields['Original Filename'] ?? '').slice(1)}`,
          name: filename,
          path,
          mimetype,
          metadata: syncMetadata.fields || {},
          template: syncMetadata.fields['Document Type'],
          buffer,
        });

        log.info(
          `Created LF document ${lfDocument.LaserficheEntryID} (vdoc ${key})`,
        );
        syncMetadata.LaserficheEntryID = lfDocument.LaserficheEntryID;
      }

      syncMetadata.Name = filename;
      syncMetadata.Path = path;

      log.trace('Recording lf-sync metadata to Trellis document');

      // Update the sync metadata in Trellis only if it has actually changed
      if (!equal(syncMetaCopy, syncMetadata)) {
        await updateSyncMetadata(oada, document, key, syncMetadata);
      }

      const entry = await retrieveEntry({
        LaserficheEntryID: syncMetadata.LaserficheEntryID,
      });
      docsSyncMetadata[key] = entry;
    }

    return docsSyncMetadata as unknown as Json;
  } catch (error_: unknown) {
    log.error(error_, `Could not sync document ${doc._id}.`);
    throw error_;
  }
}
