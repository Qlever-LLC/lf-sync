/**
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

import config from './config.js';

import { join, sep } from 'node:path';

import { FormData } from 'formdata-node';
import type { Opaque } from 'type-fest';
import got from 'got';

const test = process.env.NODE_ENV === 'test';

const {
  repository,
  baseFolder,
  cws: { apiRoot, login, token },
} = config.get('laserfiche');

const client = got.extend({
  prefixUrl: apiRoot,
});

/**
 * Perform the username/password login with CWS to get a token
 */
async function getToken() {
  const auth = Buffer.from(
    JSON.stringify({ repositoryName: repository, ...login })
  ).toString('base64');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { access_token, token_type } = await client
    .post('api/ConnectionToLaserfiche', {
      headers: { Authorization: `basic ${auth}` },
      form: { grant_type: 'password' },
    })
    .json<{
      access_token: string;
      token_type: string;
      expires_in: number;
      api_version: string;
    }>();

  return `${token_type} ${access_token}`;
}

/**
 * Connection to the configured CWS API
 */
export const cws = client.extend({
  headers: { Authorization: token ?? (await getToken()) },
});

export default cws;

type EntryId<T = BaseEntry> = Opaque<number, T>;
export interface BaseEntry {
  EntryId: EntryId;
  Name: string;
  Path: string;
  Type: string;
}

type DocumentId = EntryId;
export interface DocumentEntry extends BaseEntry {
  EntryId: DocumentId;
  Type: 'Document';
}

type FolderId = EntryId;
export interface FolderEntry extends BaseEntry {
  EntryId: FolderId;
  Type: 'Folder';
}

type Entry = FolderEntry | DocumentEntry;

/**
 * Normalize to \\ path separators
 */
function normalizePath(path: `/${string}`) {
  // Check for config updates in tests?
  const base = test ? config.get('laserfiche.baseFolder') : baseFolder;
  return join(base, path).split(sep).join('\\') as `\\${string}`;
}

function getEntryId<T extends BaseEntry>(entry: T | EntryId<T>): T['EntryId'] {
  return typeof entry === 'number' ? entry : entry.EntryId;
}

/**
 * Get a list of folders and documents directly underneath the specified folder
 *
 * @param path the Laserfiche folder path
 * @returns a Promise of an array of entries
 */
export async function browse(path: `/${string}` = '/') {
  return cws
    .get('api/browse', {
      searchParams: {
        path: normalizePath(path),
      },
    })
    .json<Entry[]>();
}

export const ROOT_ID = 1 as FolderId;

export async function getFolderContents(folder: FolderEntry | FolderId) {
  const folderId = getEntryId(folder);
  return cws.get(`api/folders/${folderId}/contents`).json<Entry[]>();
}

export async function createDocument({
  path,
  name,
  volume = 'Default',
  template,
  fieldData,
  file,
}: {
  path: `/${string}`;
  name: string;
  volume?: string;
  template?: string;
  fieldData?: Record<string, unknown>;
  file?: unknown;
}) {
  const form = new FormData();
  const parameters = {
    LaserficheFolderPath: normalizePath(path).replace(/\\*$/, ''),
    LaserficheDocumentName: name,
    LaserficheVolumeName: volume,
    LaserficheTemplateName: template,
    LaserficheFieldList:
      fieldData &&
      Object.entries(fieldData).map(([key, value]) => ({
        Name: key,
        Value: value,
      })),
  };
  if (file !== undefined) {
    form.set('File', file);
  }

  form.set('Parameters', JSON.stringify(parameters));
  return cws
    .post('api/CreateDocument', {
      body: form,
    })
    .json<{ LaserficheEntryID: EntryId }>();
}

export async function createGenericDocument({
  name,
  metadata,
}: {
  name: string;
  type: string;
  metadata?: Record<string, unknown>;
}) {
  const form = new FormData();
  form.set('DocumentName', name);
  if (metadata !== undefined) {
    form.set('Metadata', metadata);
  }

  return cws
    .post('api/CreateGenericDocument', {
      body: form,
    })
    .json<{ LaserficheEntryID: EntryId }>();
}

export async function deleteDocument(entry: Entry | EntryId) {
  const id = getEntryId(entry);
  return cws.delete('api/DeleteDocument', {
    json: {
      LaserficheEntryId: id,
    },
  });
}

export async function searchDocument(
  laserficheSearchPhrase: string,
  metadata: readonly string[]
) {
  const metaDataObjectList = metadata.map((name) => ({ Name: name }));
  return cws
    .post('api/SearchDocument', {
      json: {
        LaserficheSearchPhrase: laserficheSearchPhrase,
        MetaDataObjectList: metaDataObjectList,
      },
    })
    .json<Array<{ DocumentId: DocumentId }>>();
}

export async function retrieveDocument(document: DocumentEntry | DocumentId) {
  const documentId = getEntryId(document);
  return cws
    .get('api/RetrieveDocument', {
      searchParams: { LaserficheEntryId: documentId },
    })
    .json<{
      LaserficheEntryId: DocumentId;
      CreationTime: string;
      LastModifiedTime: string;
      Extension: string;
      MimeType: string;
      Name: string;
      Path: string;
      Volume: string;
    }>();
}

export async function retrieveDocumentContent(
  document: DocumentEntry | DocumentId
) {
  const documentId = getEntryId(document);
  return cws.get('api/RetrieveDocumentContent', {
    searchParams: { LaserficheEntryId: documentId },
  });
}
