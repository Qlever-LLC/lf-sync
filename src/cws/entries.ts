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

import type { Opaque } from 'type-fest';

import cws from './api.js';

export type EntryId<T = Entry> = Opaque<number, T>;
interface BaseEntry {
  LaserficheEntryID: EntryId<BaseEntry>;
  Name: string;
  Path: string;
  Type: string;
}

export type DocumentId = EntryId<DocumentEntry>;
export interface DocumentEntry extends BaseEntry {
  LaserficheEntryID: DocumentId;
  Type: 'Document';
}

export type FolderId = EntryId<FolderEntry>;
export interface FolderEntry extends BaseEntry {
  LaserficheEntryID: FolderId;
  Type: 'Folder';
}

export type Entry = FolderEntry | DocumentEntry;

export function getEntryId<T extends BaseEntry>(
  entry: T | EntryId<T>
): T['LaserficheEntryID'] {
  return typeof entry === 'number' ? entry : entry.LaserficheEntryID;
}

export async function retrieveEntry<E extends Entry>(
  entry: E | EntryId<E> | string
) {
  if (typeof entry === 'string') {
    return cws
      .get('api/Entry', {
        searchParams: { Path: entry },
      })
      .json<E>();
  }

  const entryId = getEntryId(entry);
  return cws.get(`api/Entry/${Number(entryId)}`).json<E>();
}

/**
 * Search Laserfiche entries based on a Laserfiche search phrase,
 * including an optional set of requested metadata.
 *
 * Returns an array of matching entries.
 *
 * @see https://www.laserfiche.com/support/webhelp/Laserfiche/10/en-US/userguide/#../Subsystems/client_wa/Content/Search/Search-Syntax.htm
 * @param phrase
 * @param metadata
 * @returns
 */
export async function searchEntries(
  phrase: string,
  metadata?: ReadonlyArray<string | { Name: string }>
) {
  return cws
    .post('api/SearchEntries', {
      json: {
        LaserficheSearchPhrase: phrase,
        MetaDataObjectList: metadata?.map((field) =>
          typeof field === 'string' ? { Name: field } : field
        ),
      },
    })
    .json<Array<{ EntryId: EntryId }>>();
}
