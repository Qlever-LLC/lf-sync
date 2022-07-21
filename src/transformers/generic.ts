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

export function generateGenericMetadata(type: string) {
  return function genericMetadata(doc: any): Metadata {
    // FIXME: Should this assert the base type with @oada/formats?

    const documentDate = doc.document_date
      ? new Date(doc.document_date)
      : new Date();

    let metadata: Metadata = {
      'Document Type': type,
      'Document Date': documentDate.toISOString(),
    };

    Object.entries(metadataMappings).forEach(([trellisKey, lfField]) => {
      if (doc[trellisKey]) {
        if (lfField.includes('Date')) {
          metadata[lfField] = new Date(doc[trellisKey]).toISOString();
        } else {
          metadata[lfField] = doc[trellisKey];
        }
      }
    });

    return metadata;
  };
}

let metadataMappings = {
  adjustment_date: 'Adjustment Date',
  expire_date: 'Expiration Date',
  audit_date: 'Audit Date',
  certifying_body: 'Certifying Body',
  //'fsis_directive_108001_compliance',
  effective_date: 'Effective Date', // 'certifying_body.name',
  score: 'Grade Score', //'score.value',
  initial_term_date: 'Initial Term Date',
  is_paaco_certified: 'PAACO Certified',
  document_date: 'Document Date',
  //'regulation_compliance',

  auditor: 'Auditor Name',
  issue_date: 'Issue Date',
  //'failures':
  //'reaudit_date':
  //'scheme':
};
