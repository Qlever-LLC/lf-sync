import { join } from 'node:path';
import type { OADAClient } from '@oada/client';
import bs58 from 'bs58';
import debug from 'debug';
import { createHash } from 'node:crypto';
import { DocumentEntry, retrieveDocumentContent } from '../cws/index.js';
import { tree } from '../tree.js';

const trace = debug('lf-sync:utils:trellis:trace');

export async function pushToTrellis(oada: OADAClient, file: DocumentEntry) {
  let docBuffer = await retrieveDocumentContent(file);

  // TODO: THIS SHOULD ONLY BE DONE FOR NOT-YET-IN-TRELLIS-DOCUMENTS

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
