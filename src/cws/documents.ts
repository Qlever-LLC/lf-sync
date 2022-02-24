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

import { FormData } from 'formdata-node';

import { DocumentEntry, DocumentId, getEntryId } from './entries.js';
import { FieldList, Metadata, toFieldList } from './metadata.js';
import { Path, normalizePath } from './paths.js';
import cws from './api.js';

export async function createDocument({
  path,
  name,
  volume = 'Default',
  template,
  metadata,
  file,
}: {
  path: Path;
  name: string;
  volume?: string;
  template?: string;
  metadata?: Metadata | FieldList;
  file?: unknown;
}) {
  const form = new FormData();
  const parameters = {
    LaserficheFolderPath: normalizePath(path),
    LaserficheDocumentName: name,
    LaserficheVolumeName: volume,
    LaserficheTemplateName: template,
    LaserficheFieldList: metadata && toFieldList(metadata),
  };
  if (file !== undefined) {
    form.set('File', file);
  }

  form.set('Parameters', JSON.stringify(parameters));
  return cws
    .post('api/CreateDocument', {
      body: form,
    })
    .json<DocumentEntry>();
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
    .json<{ LaserficheEntryID: DocumentId }>();
}

export async function deleteDocument(document: DocumentEntry | DocumentId) {
  const id = getEntryId(document);
  return cws.delete('api/DeleteDocument', {
    json: {
      LaserficheEntryId: id,
    },
  });
}

/**
 * Search Laserfiche documents based on a Laserfiche search phrase,
 * including an optional set of requested metadata.
 *
 * Returns an array of matching documents results.
 *
 * @see https://www.laserfiche.com/support/webhelp/Laserfiche/10/en-US/userguide/#../Subsystems/client_wa/Content/Search/Search-Syntax.htm
 * @param phrase
 * @param metadata
 * @returns
 */
export async function searchDocument(
  phrase: string,
  metadata?: ReadonlyArray<string | { Name: string }>
) {
  return cws
    .post('api/SearchDocument', {
      json: {
        LaserficheSearchPhrase: phrase,
        MetaDataObjectList: metadata?.map((field) =>
          typeof field === 'string' ? { Name: field } : field
        ),
      },
    })
    .json<DocumentEntry[]>();
}

export async function retrieveDocument(document: DocumentEntry | DocumentId) {
  const documentId = getEntryId(document);
  return cws
    .get('api/RetrieveDocument', {
      searchParams: { LaserficheEntryId: documentId },
    })
    .json<DocumentEntry>();
}
