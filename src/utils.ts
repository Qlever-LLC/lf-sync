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

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import bs58 from 'bs58';
import debug from 'debug';

import type { Link } from '@oada/types/oada/link/v1.js';
import type { OADAClient } from '@oada/client';
import type Resource from '@oada/types/oada/resource.js';

import { BY_LF_PATH, tree } from './tree.js';
import type { DocumentEntry, DocumentId } from './cws/index.js';
import { getEntryId, retrieveDocumentContent } from './cws/index.js';

export type VDocList = Record<string, Link>;
export interface LfSyncMetaData {
  lastSync?: string;
  LaserficheEntryID?: DocumentId;
  fields?: Record<string, string>;
}

const trace = debug('lf-sync:utils:trace');
const error = debug('lf-sync:utils:error');

export function has<T, K extends string>(
  value: T,
  key: K
): value is T & { [P in K]: unknown } {
  return value && typeof value === 'object' && key in value;
}

export async function pushToTrellis(oada: OADAClient, file: DocumentEntry) {
  const documentBuffer = await retrieveDocumentContent(file);

  // Upload PDF from LF to Trellis
  const documentKey = await oada
    .post({
      path: '/resources',
      data: documentBuffer,
      contentType: file.MimeType,
    })
    .then((r) => r.headers['content-location']!.replace(/^\/resources\//, ''));
  trace(`Created Trellis file resource: /resources/${documentKey}`);

  // Make Trellis document for the PDF
  const trellisDocumentKey = await oada
    .post({
      path: '/resources',
      data: {},
      contentType: 'application/vnd.trellisfw.unidentified.1+json',
    })
    .then((r) => r.headers['content-location']!.replace(/^\/resources\//, ''));
  trace(
    `Created unidentified Trellis document: /resources/${trellisDocumentKey}`
  );

  // Link PDF into Trellis document
  const fileHash = bs58.encode(
    createHash('sha256').update(documentBuffer).digest()
  );
  await oada.put({
    path: `resources/${trellisDocumentKey}/_meta`,
    data: {
      vdoc: {
        pdf: { [fileHash]: { _id: `resources/${documentKey}`, _rev: 0 } },
      },
    },
  });
  trace(`Linked PDF resource into /resources/${trellisDocumentKey}'s vdocs`);

  // Put the existing metadata into Trellis
  const lfData = Object.fromEntries(
    file.FieldDataList.map((f) => [f.Name, f.Value])
  );
  await oada.put({
    path: join('resources', trellisDocumentKey, '_meta/services/lf-sync'),
    data: {
      [fileHash]: {
        LaserficheEntryID: file.EntryId,
        lastSync: new Date().toISOString(),
        data: lfData,
      },
    },
  });

  // Link complete Trellis document into the lf-sync's mirror list
  trace(`Updating lf-sync by-lf-id index`);
  await oada.put({
    path: `/bookmarks/services/lf-sync/by-lf-id`,
    tree,
    data: {
      [file.EntryId]: {
        _id: `resources/${trellisDocumentKey}`,
      },
    },
  });

  trace('Linking into Trellis documents tree.');
  // FIXME: Can't just do a tree put below because of the tree put bug
  await oada.ensure({
    path: '/bookmarks/trellisfw/documents/unidentified',
    tree,
    data: {},
  });

  // Link document as unidentified into documents list
  await oada.post({
    path: `/bookmarks/trellisfw/documents/unidentified`,
    // Tree,
    data: {
      _id: `resources/${trellisDocumentKey}`,
      _rev: 0,
    },
  });
}

export async function getBuffer(
  oada: OADAClient,
  document: Resource | Link
): Promise<Buffer> {
  trace('Fetching document from %s', document._id);
  let { data: buffer } = await oada.get({ path: document._id });
  if (!Buffer.isBuffer(buffer)) {
    if (buffer instanceof Uint8Array) {
      buffer = Buffer.from(buffer);
    }
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError(`Expected binary Buffer but got ${typeof buffer}`);
    }
  }

  return buffer;
}
/**
 * fetch the filename on a vdoc resource
 * @param oada
 */
export async function fetchVdocFilename(oada: OADAClient, vdocResourceId: string) {
  const { data: meta } = await oada.get({
    path: `/${vdocResourceId}/_meta/filename`
  })
  return meta as unknown as string;
}

/**
 * Fetch the sync metadata stored in Trellis from prior operations
 */
export async function fetchSyncMetadata(
  oada: OADAClient,
  id: string,
  key: string
): Promise<LfSyncMetaData> {
  try {
    const r = await oada.get({
      path: join(id, '_meta/services/lf-sync', key),
    });
    // FIXME: Make proper format and assert type
    return r.data as LfSyncMetaData;
  } catch (cError: any) {
    if (cError?.status !== 404 && cError?.code !== '404') {
      trace(cError, `Error fetching ${id}'s sync metadata for vdoc ${key}!`);
      throw cError as Error;
    }
  }

  return {};
}

/**
 * Query the Documents-By-LaserFicheID index managed by this service
 * for the related Trellis document
 */
export async function lookupByLf(
  oada: OADAClient,
  file: DocumentEntry
): Promise<Resource | undefined> {
  // Check if document is already in Trellis. If so, trigger a re-process. Otherwise, upload it to Trellis.
  try {
    const { data } = await oada.get({
      path: join(BY_LF_PATH, getEntryId(file).toString()),
    });

    // TODO: Proper assert?
    return data as Resource;
  } catch (cError: any) {
    if (cError?.status !== 404 && cError?.code !== 404) {
      error(cError, 'Unexpected error with Trellis!');
      throw cError as Error;
    }
  }

  return undefined;
}

/**
 * Get the list of **PDF** vdocs associated with a Trellis document.
 */
export async function getPdfVdocs(
  oada: OADAClient,
  document: Resource | Link
): Promise<VDocList> {
  // FIXME: r.data['pdf'] => r.data (and .../pdf/..) in the GET url after fixing extra put to vdoc/pdf rather than vdoc/pdf/<hash> in target-helper
  const r = await oada.get({ path: `/${join(document._id, '_meta/vdoc')}` });

  // @ts-expect-error FIXME: Make proper format and assert the type
  return r.data!.pdf as VDocList;
}

/**
 * Lookup the English name for a Trading partner by masterid
 */
export async function tradingPartnerByMasterId(
  oada: OADAClient,
  masterId: string
): Promise<{name: string; externalIds: string[]}> {
  const { data } = await oada.get({
    path: `/bookmarks/trellisfw/trading-partners${masterId}`,
  }) as unknown as { data: { name: string; externalIds: string[] } };

  return data;
}

/**
 * Update the LF sync metadata in a Trellis
 */
export async function updateSyncMetadata(
  oada: OADAClient,
  document: Resource,
  key: string,
  syncMetadata: LfSyncMetaData
) {
  await oada.put({
    path: join(document._id, '_meta/services/lf-sync/', key),
    data: {
      ...syncMetadata,
      lastSync: new Date().toISOString(),
    },
  });
}