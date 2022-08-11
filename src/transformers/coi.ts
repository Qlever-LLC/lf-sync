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
import { has } from '../utils.js';

export function coiMetadata(document: unknown): Metadata {
  let metadata: Metadata = {
    'Document Type': 'Certificate of Insurance',
  };

  // FIXME: Should this assert the CoI type with @oada/formats?
  if (
    has(document, 'policies') &&
    typeof document.policies === 'object' &&
    document.policies
  ) {
    // TODO: Is this the summary they want?
    const policies = Object.values<any>(document.policies).reduce<
      Record<string, any>
    >((v, p) => {
      v[p.type] = p;
      return v;
    }, {});

    // TODO: Is this the summary they want?
    const effectiveDate = new Date(
      Math.max(
        ...Object.values(policies).map((p) =>
          Number(new Date(p.effective_date))
        )
      )
    );

    // TODO: Is this the summary they want?
    const expireDate = new Date(
      Math.max(
        ...Object.values(policies).map((p) => Number(new Date(p.expire_date)))
      )
    );

    metadata = {
      ...metadata,
      'General Liability': (
        policies['Commercial General Liability']?.general_aggregate || ''
      ).toString(),
      'Automotive Liability': (
        policies['Automobile Liability']?.combined_single_limit || ''
      ).toString(),
      'Workers Comp and Employers Liability': (
        policies["Employers' Liability"]?.el_each_accident || ''
      ).toString(),
      'Document Date': effectiveDate.toISOString(),
      'Expiration Date': expireDate.toISOString(),
    };
  }

  if (
    has(document, 'insured') &&
    has(document.insured, 'name') &&
    typeof document.insured.name === 'string' &&
    has(document, 'holder') &&
    has(document.holder, 'name') &&
    typeof document.holder.name === 'string'
  ) {
    let entity: string;
    let shareMode: string;

    if (
      document.insured.name.trim().toLowerCase().startsWith('smithfield foods')
    ) {
      entity = document.holder.name;
      shareMode = 'Shared From Smithfield';
    } else {
      entity = document.insured.name;
      shareMode = 'Shared To Smithfield';
    }

    metadata = {
      ...metadata,
      'Entity': entity,
      'Share Mode': shareMode,
      'Insured Company': document.insured.name,
      'Certificate Holder': document.holder.name,
    };
  }

  if (
    has(document, 'producer') &&
    has(document.producer, 'name') &&
    typeof document.producer.name === 'string'
  ) {
    metadata = {
      ...metadata,
      'Insurance Producer': document.producer.name,
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
