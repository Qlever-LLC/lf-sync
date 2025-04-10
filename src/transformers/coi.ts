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
import { getFormattedDate, has } from "../utils.js";

export interface Policy {
  type: string;
  effective_date: string;
  expire_date: string;
  general_aggregate: string;
  combined_single_limit: string;
  el_each_accident: string;
}

// eslint-disable-next-line complexity
export function coiMetadata(document: Resource): Metadata {
  let metadata: Metadata = {
    "Document Type": "Certificate of Insurance",
    "Document Date": getFormattedDate(
      new Date(
        Number(
          new Date(
            (document.document_date ||
              document.effective_date ||
              document.expire_date) as string,
          ),
        ),
      ),
    ),
  };

  // FIXME: Should this assert the CoI type with @oada/formats?
  if (
    has(document, "policies") &&
    typeof document.policies === "object" &&
    document.policies
  ) {
    // TODO: Is this the summary they want?
    const policies = Object.values(
      document.policies as Record<string, Policy>,
      // eslint-disable-next-line unicorn/no-array-reduce
    ).reduce<Record<string, Policy>>((v, p) => {
      v[p.type] = p;
      return v;
    }, {});

    // TODO: Is this the summary they want?
    const effectiveDate = new Date(
      Math.max(
        ...Object.values(policies).map((p) =>
          Number(new Date(p.effective_date)),
        ),
      ),
    );

    // TODO: Is this the summary they want?
    const expireDate = new Date(
      Math.max(
        ...Object.values(policies).map((p) => Number(new Date(p.expire_date))),
      ),
    );

    metadata = {
      ...metadata,
      "General Liability": (
        policies["Commercial General Liability"]?.general_aggregate ?? ""
      ).toString(),
      "Automotive Liability": (
        policies["Automobile Liability"]?.combined_single_limit ?? ""
      ).toString(),
      "Workers Comp and Employers Liability": (
        policies["Employers' Liability"]?.el_each_accident ?? ""
      ).toString(),
      "Document Date":
        getFormattedDate(effectiveDate) ?? metadata["Document Date"] ?? "",
      "Expiration Date": getFormattedDate(expireDate),
    };
  }

  if (
    has(document, "insured") &&
    has(document.insured, "name") &&
    typeof document.insured.name === "string" &&
    has(document, "holder") &&
    has(document.holder, "name") &&
    typeof document.holder.name === "string"
  ) {
    let entity: string;
    let shareMode: string;

    if (
      document.insured.name.trim().toLowerCase().startsWith("smithfield foods")
    ) {
      entity = document.holder.name;
      shareMode = "Shared From Smithfield";
    } else {
      entity = document.insured.name;
      shareMode = "Shared To Smithfield";
    }

    metadata = {
      ...metadata,
      Entity: entity,
      "Share Mode": shareMode,
      "Insured Company": document.insured.name,
      "Certificate Holder": document.holder.name,
    };
  }

  if (
    has(document, "producer") &&
    has(document.producer, "name") &&
    typeof document.producer.name === "string"
  ) {
    metadata = {
      ...metadata,
      "Insurance Producer": document.producer.name,
    };
  }

  // FIXME: Implement
  /*
  metadata = {
    ...metadata,
    'Umbrella Liability': '',
    'Description of Locations/Operations/Vehicles': '',
    'Signature': '',
  };
  */

  return metadata;
}
