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

import cws from "./api.js";
import { type DocumentEntry, type EntryIdLike, getEntryId } from "./entries.js";

export async function retrieveDocumentContent(
  document: EntryIdLike<DocumentEntry>,
) {
  const id = getEntryId(document);
  return cws
    .get("api/RetrieveDocumentContent", {
      searchParams: { LaserficheEntryId: id },
    })
    .buffer();
}
