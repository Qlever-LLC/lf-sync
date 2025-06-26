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

import type { Opaque } from "type-fest";

import cws from "./api.js";
import { normalizePath, type Path } from "./paths.js";

export type EntryId<T extends Partial<BaseEntry> = Entry> = Opaque<number, T>;
interface BaseEntry {
  EntryId: EntryId<BaseEntry>;
  LaserficheEntryID?: EntryId<BaseEntry>;
  Name: string;
  Path: string;
  Type: string;
  MimeType: string;
}

export type DocumentId = EntryId<DocumentEntry>;
export interface DocumentEntry extends BaseEntry {
  LaserficheEntryID: DocumentId;
  Type: "Document";
  FieldDataList: FieldData[];
  TemplateName: string;
  ElectronicDocumentSize: number;
  LastModifiedTime: string;
  ParentId: FolderId;
}

export interface FieldData {
  [x: string]: any;
  Name: string;
  Value: string;
}

export type FolderId = EntryId<FolderEntry>;
export interface FolderEntry extends BaseEntry {
  LaserficheEntryID: FolderId;
  Type: "Folder";
}

export type Entry = FolderEntry | DocumentEntry;
export type EntryIdLike<T extends BaseEntry = BaseEntry> =
  | Pick<Partial<T>, "LaserficheEntryID" | "EntryId">
  | EntryId<T>
  | number;

export function getEntryId<T extends BaseEntry>(entry: EntryIdLike<T>) {
  return typeof entry === "number"
    ? entry
    : entry.LaserficheEntryID
      ? (entry.LaserficheEntryID as EntryId<T>)
      : (entry.EntryId as EntryId<T>);
}

type EntryEntry<E extends Entry> = Omit<E, "LaserficheEntryID"> & {
  EntryId: EntryId<E>;
};

export async function retrieveEntry<E extends Entry>(
  entry: EntryIdLike<E> | Path,
): Promise<EntryEntry<E>> {
  if (typeof entry === "string") {
    return cws
      .get("api/RetrieveEntry", {
        searchParams: { Path: normalizePath(entry) },
      })
      .json();
  }

  const id = getEntryId(entry);
  return cws.get(`api/RetrieveEntry/${Number(id)}`).json();
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
  metadata?: ReadonlyArray<string | { Name: string }>,
) {
  return cws
    .post("api/SearchEntries", {
      json: {
        LaserficheSearchPhrase: phrase,
        MetaDataObjectList: metadata?.map((field) =>
          typeof field === "string" ? { Name: field } : field,
        ),
      },
    })
    .json<Array<{ EntryId: EntryId }>>();
}

export async function indexEntry(entry: EntryIdLike) {
  const id = getEntryId(entry);
  return cws.put<void>(`api/Entry/${id}/index`);
}

export async function migrateEntry(entry: EntryIdLike, volume: string) {
  const entryId = getEntryId(entry);
  return cws.put<void>("api/Entry/Migrate", {
    json: {
      LaserficheEntryID: entryId,
      DestinationVolumeName: volume,
    },
  });
}

export async function moveEntry(entry: EntryIdLike, path: Path) {
  const entryId = getEntryId(entry);
  return cws.put<void>("api/Entry/Move", {
    json: {
      LaserficheEntryID: entryId,
      DestinationParentPath: normalizePath(path),
    },
  });
}

export async function renameEntry(
  entry: EntryIdLike,
  path: Path,
  Name: string,
) {
  const entryId = getEntryId(entry);
  return cws.put<void>("api/Entry/Move", {
    json: {
      LaserficheEntryID: entryId,
      DestinationParentPath: normalizePath(path),
      Name,
    },
  });
}
