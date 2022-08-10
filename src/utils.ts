import { join } from 'node:path';
import bs58 from 'bs58';
import debug from 'debug';
import { createHash } from 'node:crypto';
import {
  DocumentEntry,
  DocumentId,
  getEntryId,
  retrieveDocumentContent,
} from './cws/index.js';
import { BY_LF_PATH, MASTERID_LIST, tree } from './tree.js';

import type { OADAClient } from '@oada/client';
import type Resource from '@oada/types/oada/resource.js';
import type { Link } from '@oada/types/oada/link/v1';

export type VDocList = Record<string, Link>;
export type LfSyncMetaData = {
  lastSync?: string;
  LaserficheEntryID?: DocumentId;
  fields?: Record<string, string>;
};

const trace = debug('lf-sync:utils:trace');
const error = debug('lf-sync:utils:error');

export function has<T, K extends string>(
  value: T,
  key: K
): value is T & { [P in K]: unknown } {
  return value && key in value;
}

export async function pushToTrellis(oada: OADAClient, file: DocumentEntry) {
  let docBuffer = await retrieveDocumentContent(file);

  // Upload PDF from LF to Trellis
  let docKey = await oada
    .post({
      path: '/resources',
      data: docBuffer,
      contentType: file.MimeType,
    })
    .then((r) => r.headers['content-location']!.replace(/^\/resources\//, ''));
  trace(`Created Trellis file resource: /resources/${docKey}`);

  // Make Trellis document for the PDF
  const trellisDocKey = await oada
    .post({
      path: '/resources',
      data: {},
      contentType: 'application/vnd.trellisfw.unidentified.1+json',
    })
    .then((r) => r.headers['content-location']!.replace(/^\/resources\//, ''));
  trace(`Created unidentified Trellis document: /resources/${trellisDocKey}`);

  // Link PDF into Trellis document
  const fileHash = bs58.encode(createHash('sha256').update(docBuffer).digest());
  await oada.put({
    path: `resources/${trellisDocKey}/_meta`,
    data: {
      vdoc: { pdf: { [fileHash]: { _id: `resources/${docKey}`, _rev: 0 } } },
    },
  });
  trace(`Linked PDF resource into /resources/${trellisDocKey}'s vdocs`);

  // Put the existing metadata into Trellis
  let lfData = file.FieldDataList.reduce(
    (data, f) => ({ ...data, [f.Name]: f.Value }),
    {}
  );
  await oada.put({
    path: join('resources', trellisDocKey, '_meta/services/lf-sync'),
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
        _id: `resources/${trellisDocKey}`,
      },
    },
  });

  trace('Linking into Trellis documents tree.');
  // FIXME: Can't just do a tree put below becuase of the tree put bug
  await oada.ensure({
    path: '/bookmarks/trellisfw/documents/unidentified',
    tree,
    data: {},
  });

  // Link document as unidentified into documents list
  await oada.post({
    path: `/bookmarks/trellisfw/documents/unidentified`,
    // tree,
    data: {
      _id: `resources/${trellisDocKey}`,
      _rev: 0,
    },
  });
}

export async function getBuffer(
  oada: OADAClient,
  doc: Resource | Link
): Promise<Buffer> {
  trace('Fetching document from %s', doc._id);
  const { data: buffer } = await oada.get({ path: doc._id });
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError(`Expected binary Buffer but got ${typeof buffer}`);
  }

  return buffer;
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
    if (cError?.status !== 404) {
      trace(cError, `Error fetching ${id}'s sync metadata for vdoc ${key}!`);
      throw cError;
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
    let { data } = await oada.get({
      path: join(BY_LF_PATH, getEntryId(file).toString()),
    });

    // TODO: Proper assert?
    return data as Resource;
  } catch (cError: any) {
    if (cError?.status !== 404) {
      error(cError, 'Unexpected error with Trellis!');
      throw cError;
    }
  }

  return;
}

/**
 * Get the list of **PDF** vdocs associated with a Trellis document.
 */
export async function getPdfVdocs(
  oada: OADAClient,
  doc: Resource | Link
): Promise<VDocList> {
  // FIXME: r.data['pdf'] => r.data (and .../pdf/..) in the GET url after fixing extra put to vdoc/pdf rather than vdoc/pdf/<hash> in target-helper
  const r = await oada.get({ path: join(doc._id, '_meta/vdoc') });

  //@ts-expect-error
  // FIXME: Make proper format and assert the type
  return r.data['pdf'] as VDocList;
}

/**
 * Lookup the English name for a Trading partner by masterid
 */
export async function tradingPartnerNameByMasterId(
  oada: OADAClient,
  masterId: string
): Promise<string> {
  const { data: name } = await oada.get({
    path: join(MASTERID_LIST, masterId, 'name'),
  });

  return (name || '').toString();
}

/**
 * Update the LF sync metadata in a Trellis
 */
export async function updateSyncMetadata(
  oada: OADAClient,
  doc: Resource,
  key: string,
  syncMetadata: LfSyncMetaData
) {
  await oada.put({
    path: join(doc._id, '_meta/services/lf-sync/', key),
    data: {
      ...syncMetadata,
      lastSync: new Date().toISOString(),
    },
  });
}
