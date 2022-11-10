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

import {
  type Entry,
  type EntryId,
  type EntryIdLike,
  getEntryId,
} from './entries.js';
import cws from './api.js';

export type MetadataFieldSingle = {
  Name: string;
  IsMulti: false;
  Value: string;
};
export type MetadataFieldMulti = {
  Name: string;
  IsMulti: true;
  Values: readonly string[];
};
export type FieldList = Array<MetadataFieldMulti | MetadataFieldSingle>;
export type Metadata = Record<string, string>; /* | readonly string[]>;*/

export function toFieldList(
  metadata: Metadata | FieldList
): Array<Omit<MetadataFieldSingle | MetadataFieldMulti, 'IsMulti'>> {
  return Array.isArray(metadata)
    ? metadata
    : Object.entries(metadata).map(([name, value]) =>
        Array.isArray(value)
          ? { Name: name, Values: value }
          : { Name: name, Value: value }
      );
}

export async function getMetadata<E extends Entry = Entry>(
  entry: EntryIdLike<E>
) {
  const id = getEntryId(entry);
  return cws
    .get('api/GetMetadata', { searchParams: { LaserficheEntryId: id } })
    .json<{
      ID: EntryId<E>;
      TemplateName: string;
      LaserficheFieldList: FieldList;
    }>();
}

export async function setMetadata(
  entry: EntryIdLike,
  metadata: Metadata | FieldList,
  template?: string
) {
  const id = getEntryId(entry);
  return cws.post<void>('api/SetMetadata', {
    json: {
      LaserficheEntryId: id,
      LaserficheTemplateName: template,
      LaserficheFieldList: toFieldList(metadata),
    },
  });
}

export async function setTemplate(entry: EntryIdLike, template: string) {
  const id = getEntryId(entry);
  return cws.post<void>('api/SetTemplate', {
    json: {
      LaserficheEntryId: id,
      LaserficheTemplateName: template,
    },
  });
}
