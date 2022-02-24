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

import { Entry, FolderEntry, FolderId, getEntryId } from './entries.js';
import { FieldList, Metadata, toFieldList } from './metadata.js';
import { Path, normalizePath } from './paths.js';
import cws from './api.js';

export const ROOT_ID = 1 as FolderId;

/**
 * Get a list of folders and documents directly underneath the specified folder
 *
 * @param path the Laserfiche folder path
 * @returns a Promise of an array of entries
 */
export async function browse(path: Path = '/') {
  return cws
    .get('api/browse', {
      searchParams: {
        path: normalizePath(path),
      },
    })
    .json<Entry[]>();
}

export async function retrieveFolder(document: FolderEntry | FolderId) {
  const documentId = getEntryId(document);
  return cws
    .get('api/RetrieveFolder', {
      searchParams: { LaserficheEntryId: documentId },
    })
    .json<FolderEntry>();
}

export async function createFolder({
  path,
  volume,
  template,
  metadata,
}: {
  path: Path;
  volume?: string;
  template?: string;
  metadata?: Metadata | FieldList;
  file?: unknown;
}) {
  const parameters = {
    LaserficheFolderPath: normalizePath(path),
    LaserficheVolumeName: volume,
    LaserficheTemplateName: template,
    LaserficheFieldList: metadata && toFieldList(metadata),
  };
  return cws
    .post('api/CreateFolder', {
      json: parameters,
    })
    .json<{ LaserficheEntryID: FolderId }>();
}

export async function getFolderContents(folder: FolderEntry | FolderId) {
  const folderId = getEntryId(folder);
  return cws.get(`api/folders/${folderId}/contents`).json<Entry[]>();
}

export async function deleteFolder(folder: FolderEntry | FolderId) {
  const id = getEntryId(folder);
  return cws.delete('api/DeleteFolder', {
    json: {
      LaserficheEntryId: id,
    },
  });
}
