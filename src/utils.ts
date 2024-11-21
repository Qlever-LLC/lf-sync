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

import type { Link } from '@oada/types/oada/link/v1.js';
import { type Logger } from '@oada/pino-debug';
import type { OADAClient } from '@oada/client';
import type Resource from '@oada/types/oada/resource.js';
import bs58 from 'bs58';

import { BY_LF_PATH, tree } from './tree.js';
import type { DocumentEntry, DocumentId } from './cws/index.js';
import { getEntryId, retrieveDocumentContent } from './cws/index.js';
import { type Path } from './cws/paths.js';

export type VDocList = Record<string, Link>;
export interface LfSyncMetaData {
  lastSync?: string;
  LaserficheEntryID?: DocumentId;
  fields?: Record<string, string>;
  Path?: string;
  Name?: string;
}

export function has<T, K extends string>(
  value: T,
  key: K,
): value is T & { [P in K]: unknown } {
  return value && typeof value === 'object' && key in value;
}

export async function pushToTrellis(
  oada: OADAClient,
  file: DocumentEntry,
  log: Logger,
) {
  const documentBuffer = await retrieveDocumentContent(file);

  // Upload PDF from LF to Trellis
  let r = await oada.post({
    path: '/resources',
    data: documentBuffer,
    contentType: file.MimeType,
  });
  const documentKey = r.headers['content-location']!.replace(
    /^\/resources\//,
    '',
  );
  log.trace(`Created Trellis file resource: /resources/${documentKey}`);

  // Make Trellis document for the PDF
  r = await oada.post({
    path: '/resources',
    data: {},
    contentType: 'application/vnd.trellisfw.unidentified.1+json',
  });
  const trellisDocumentKey = r.headers['content-location']!.replace(
    /^\/resources\//,
    '',
  );
  log.trace(
    `Created unidentified Trellis document: /resources/${trellisDocumentKey}`,
  );

  // Link PDF into Trellis document
  const fileHash = bs58.encode(
    createHash('sha256').update(documentBuffer).digest(),
  );
  await oada.put({
    path: `resources/${trellisDocumentKey}/_meta`,
    data: {
      vdoc: {
        pdf: { [fileHash]: { _id: `resources/${documentKey}`, _rev: 0 } },
      },
    },
  });
  log.trace(
    `Linked PDF resource into /resources/${trellisDocumentKey}'s vdocs`,
  );

  // Put the existing metadata into Trellis
  const lfData = Object.fromEntries(
    file.FieldDataList.map((f) => [f.Name, f.Value]),
  );
  await oada.put({
    // Path: join('resources', trellisDocumentKey, 'vdocs/pdf', fileHash, '_meta/services/lf-sync'),
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
  log.trace(`Updating lf-sync by-lf-id index`);
  await oada.put({
    path: `/bookmarks/services/lf-sync/by-lf-id`,
    tree,
    data: {
      [file.EntryId]: {
        _id: `resources/${trellisDocumentKey}`,
      },
    },
  });

  log.trace('Linking into Trellis documents tree.');
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
  log: Logger,
  oada: OADAClient,
  document: Resource | Link,
): Promise<{ buffer: Uint8Array; mimetype: string }> {
  log.trace('Fetching document from %s', document._id);
  let { data: buffer, headers } = await oada.get({ path: document._id });
  if (!Buffer.isBuffer(buffer)) {
    if (buffer instanceof Uint8Array) {
      buffer = Buffer.from(buffer);
    }

    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError(`Expected binary Buffer but got ${typeof buffer}`);
    }
  }

  return {
    mimetype: headers['content-type'] ?? headers['Content-Type'] ?? '',
    buffer,
  };
}

/**
 * Fetch the filename on a vdoc resource
 * @param oada
 */
export async function fetchVdocMeta(oada: OADAClient, vdocResourceId: string) {
  const { data: meta } = await oada.get({
    path: `/${vdocResourceId}/_meta`,
  });
  return meta as Record<string, unknown>;
}

/**
 * Fetch the sync metadata stored in Trellis from prior operations
 */
export async function fetchSyncMetadata(
  oada: OADAClient,
  id: string,
  key: string,
  log: Logger,
): Promise<LfSyncMetaData> {
  try {
    const r = await oada.get({
      // Considered moving these into each of the vdocs to fix some change propagation issues
      // path: join(id, '_meta/vdocs/pdf', key, '_meta/services/lf-sync'),
      path: join(id, '_meta/services/lf-sync', key),
    });
    // FIXME: Make proper format and assert type
    return r.data as LfSyncMetaData;
  } catch (cError: unknown) {
    // @ts-expect-error error nonsense
    if (cError?.status !== 404 && cError?.code !== '404') {
      log.trace(
        cError,
        `Error fetching ${id}'s sync metadata for vdoc ${key}!`,
      );
      throw cError as Error;
    }

    // Try the old path where meta was previously stored
    /*
    try {
      const r = await oada.get({
        path: join(id, '_meta/services/lf-sync', key)
      });
      return r.data as LfSyncMetaData;
    } catch (cError: any) {
      if (cError?.status !== 404 && cError?.code !== '404') {
        trace(cError, `Error fetching ${id}'s sync metadata for vdoc ${key}!`);
        throw cError as Error;
      }
    }
    */
  }

  return {};
}

/**
 * Query the Documents-By-LaserFicheID index managed by this service
 * for the related Trellis document
 */
export async function lookupByLf(
  oada: OADAClient,
  file: DocumentEntry,
  log: Logger,
): Promise<Resource | undefined> {
  // Check if document is already in Trellis. If so, trigger a re-process. Otherwise, upload it to Trellis.
  try {
    const { data } = await oada.get({
      path: join(BY_LF_PATH, getEntryId(file).toString()),
    });

    // TODO: Proper assert?
    return data as Resource;
  } catch (cError: unknown) {
    // @ts-expect-error error nonsense
    if (cError?.status !== 404 && cError?.code !== 404) {
      log.error(cError, 'Unexpected error with Trellis!');
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
  document: Resource | Link,
): Promise<VDocList> {
  // FIXME: r.data['pdf'] => r.data (and .../pdf/..) in the GET url after fixing extra put to vdoc/pdf rather than vdoc/pdf/<hash> in target-helper
  const r = await oada.get({ path: `/${join(document._id, '_meta/vdoc')}` });

  // @ts-expect-error FIXME: Make proper format and assert the type
  return r.data!.pdf as VDocList;
}

/**
 * Lookup the English name for a Trading partner by masterid
 */
export async function fetchTradingPartner(
  oada: OADAClient,
  tradingPartner: string,
): Promise<{ name: string; externalIds: string[] }> {
  const path =
    tradingPartner.startsWith('resources') ||
    tradingPartner.startsWith('/resources')
      ? join('/', tradingPartner)
      : join(`/bookmarks/trellisfw/trading-partners`, tradingPartner);
  const { data } = (await oada.get({
    path,
  })) as unknown as { data: { name: string; externalIds: string[] } };

  return data;
}

/**
 * Update the LF sync metadata in a Trellis
 */
export async function updateSyncMetadata(
  oada: OADAClient,
  document: Resource,
  key: string,
  syncMetadata: LfSyncMetaData,
) {
  await oada.put({
    path: join(document._id, '_meta/services/lf-sync/', key),
    // Considered moving these into each of the vdocs to fix some change propagation issues
    // path: `${document._id}_meta/vdocs/pdf/${key.replaceAll('/', '')}/_meta/services/lf-sync`,
    data: {
      ...syncMetadata,
      lastSync: new Date().toISOString(),
    },
  });
}

export function getFormattedDate(date: Date): string {
  const year = date.getFullYear();
  const month = (1 + date.getMonth()).toString();
  const day = date.getDate().toString();

  return `${month}/${day}/${year} 12:00:00 AM`;
}

export function filingWorkflow(metadata: Metadata): {
  filename: string;
  path: Path;
} {
  const {
    Entity,
    'Document Type': documentType,
    'Document Date': documentDate,
    'Share Mode': shareMode,
    Products,
    Locations,
    'Expiration Date': expiration,
    'Zendesk Ticket ID': ticketId,
    'Original Filename': originalFilename,
    'Ticket Comment Number': commentNumber,
  } = metadata;
  const location =
    Locations && Locations.length === 1
      ? Locations[0]
      : Locations && Locations.length > 1
        ? 'Multi-Location'
        : '';

  const product =
    Products && Products.length === 1
      ? Products[0]
      : Products && Products.length > 1
        ? 'Multi-Product'
        : '';

  const expire = expiration
    ? `EXP_${new Date(expiration).toISOString().split('T')[0]}`
    : undefined;
  const ticket = ticketId ? `Ticket${ticketId}` : undefined;
  let ticketDate = '';
  if (documentType === 'Zendesk Ticket') {
    const docDate = new Date(documentDate);
    ticketDate = docDate.toISOString().split('T')[0]!.slice(0, 7);
  }

  const path: Path = join(
    ...([
      `/trellis/trading-partners`,
      Entity,
      shareMode,
      documentType,
      ticketDate,
      ticket,
    ].filter(Boolean) as unknown as string),
  ) as unknown as Path;

  let filename = '';
  switch (documentType) {
    case 'Zendesk Ticket': {
      filename = `[${ticket}]_${commentNumber ? `[Comment${commentNumber}]_` : ''}${originalFilename}`;

      break;
    }

    default: {
      filename = [documentType, Entity, expire, location, product]
        .filter(Boolean)
        .map((index) => `[${index}]`)
        .join('_');
    }
  }

  return { path, filename };
}

export interface Metadata {
  'Entity': string;
  'Document Type': string;
  'Document Date': string;
  'Share Mode': string;
  'Expiration Date'?: string;
  'Zendesk Ticket ID'?: string;
  'Products'?: string[];
  'Locations'?: string[];
  'Original Filename'?: string;
  'Ticket Comment Number'?: string;
}
