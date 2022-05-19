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

import type { Metadata } from '../cws/metadata';

/*
Interface CoIDocument {
  effective_date: string;
  expire_date: string;
  producer: {
    name: string;
  };
  insured: {
    name: string;
  };
  holder: {
    name: string;
  };
  policies: {
    [key: string]: CommercialGeneralLiability | AutomotiveLiability;
  };
  signatures: Array<string>;
}

type CommercialGeneralLiability = {
  type: 'Commercial General Liability';
  general_aggregate: string;
};

type AutomotiveLiability = {
  type: 'Automobile Liability';
  combined_single_limit: string;
};
*/

export function coiMetadata(document: any): Metadata {
  // FIXME: Should this assert the CoI type with @oada/formats?

  const policies = Object.values<any>(document.policies).reduce<
    Record<string, any>
  >((v, p) => {
    v[p.type] = p;
    return v;
  }, {});

  // // TODO: Should we be summing?
  // let policyLimits = Object.values(doc.policies).reduce(
  //   (values, p) => {
  //     switch (p.type) {
  //       case 'Commercial General Liability':
  //         values.general = +p.general_aggregate;
  //         break;
  //
  //       case 'Automobile Liability':
  //         values.automobile = +p.combined_single_limit;
  //         break;
  //     }
  //     return values;
  //   },
  //   { general: 0, automobile: 0 }
  // );

  return {
    'Document Type': 'Certificate of Insurance',
    'Document Date': new Date(document.effective_date).toISOString(),
    'Expiration Date': new Date(document.expire_date).toISOString(),
    'Insurance Producer': document.producer.name,
    'Insured Company': document.insured.name,
    'General Liability': (
      policies['Commercial General Liability']?.general_aggregate || ''
    ).toString(),
    'Automotive Liability': (
      policies['Automobile Liability']?.combined_single_limit || ''
    ).toString(),
    'Workers Comp and Employers Liability': (
      policies["Employers' Liability"]?.el_each_accident || ''
    ).toString(),
    'Certificate Holder': document.holder.name,
    // FIXME: Implement
    'Umbrella Liability': '-1',
    // FIXME: Implement
    'Description of Locations/Operations/Vehicles': 'NOT IMPLEMENTED',
    // FIXME: Implement
    'Signature': 'NOT IMPLEMENTED',
  };
}
