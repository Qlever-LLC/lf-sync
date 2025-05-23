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

import type Resource from "@oada/types/oada/resource.js";

import type { Metadata } from "../cws/metadata.js";
import { getFormattedDate } from "../utils.js";

export function generateGenericMetadata(type: string) {
  return (document: Resource): Metadata => {
    // FIXME: Should this assert the base type with @oada/formats?
    //

    const documentDate = document.document_date
      ? new Date(document.document_date as string)
      : new Date();

    const metadata: Metadata = {
      "Document Type": type,
      "Document Date": getFormattedDate(documentDate),
    };

    for (const [trellisKey, lfField] of Object.entries(metadataMappings)) {
      // Handle products and locations
      if (["locations", "products"].includes(trellisKey)) {
        const value = (document[trellisKey] || []) as Array<
          Record<string, unknown>
        >;

        metadata[lfField] = value.map(
          (index) => index.name,
        ) as unknown as string;
        //return metadata;
        continue;
      }

      const value = document[trellisKey] as string;
      if (value) {
        metadata[lfField] = lfField.includes("Date")
          ? getFormattedDate(new Date(value))
          : value;
      }
    }

    return metadata;
  };
}

export function genericVdocMetadata(meta: Record<string, unknown>): Metadata {
  const metadata: Metadata = {};

  if ("filename" in meta && typeof meta.filename === "string") {
    metadata["Original Filename"] = meta.filename;
  }

  return metadata;
}

const metadataMappings = {
  adjustment_date: "Adjustment Date",
  expire_date: "Expiration Date",
  audit_date: "Audit Date",
  certifying_body: "Certifying Body",

  // 'fsis_directive_108001_compliance',
  effective_date: "Effective Date", // 'certifying_body.name',
  score: "Grade Score", // 'score.value',
  initial_term_date: "Initial Term Date",
  is_paaco_certified: "PAACO Certified",
  document_date: "Document Date",
  // 'regulation_compliance',

  auditor: "Auditor Name",
  issue_date: "Issue Date",
  products: "Products",
  locations: "Locations",
  // 'failures':
  // 'reaudit_date':
  // 'scheme':
} as const;
