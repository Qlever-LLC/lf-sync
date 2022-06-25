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

import type { Metadata } from '../cws/metadata.js';

export function genericMetadata(doc: any): Metadata {
  // FIXME: Should this assert the base type with @oada/formats?

  const documentDate = doc.document_date ? new Date(doc.document_date) : new Date();
  
  let metadata: Metadata = {
    'Document Date': documentDate.toISOString(),
  };

  if (doc.expire_date) {
    metadata['Expiration Date'] = new Date(doc.expire_date).toISOString();
  }

  if (doc.effective_date) {
    metadata['Effective Date'] = new Date(doc.effective_date).toISOString();
  }

  return metadata;
}
