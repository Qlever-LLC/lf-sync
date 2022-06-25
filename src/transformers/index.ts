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

import type { Metadata } from '../cws/index.js';
import { coiMetadata } from './coi.js';
import { genericMetadata } from './generic.js';

type Transformer = {
  lfTemplate: string;
  metadata: (document: unknown) => Metadata;
};

export default new Map<string, Transformer>([
  [
    'application/vnd.trellisfw.coi.accord.1+json',
    {
      lfTemplate: 'Certificate of Insurance',
      metadata: coiMetadata,
    },
  ],

  // Generic from (fl-sync conversions.ts)
  [
    'application/vnd.trellisfw.ach-form.1+json',
    {
      lfTemplate: 'ACH Form',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.pfgia.1+json',
    {
      lfTemplate: 'Pure Food Guaranty and Indemnification Agreement (LOG)',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.letter-of-guarantee.1+json',
    {
      lfTemplate: 'Letter of Guarantee',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.emergency-contact-information.1+json',
    {
      lfTemplate: 'Emergency Contact Information',
      metadata: genericMetadata,
    },
  ],

  [
    'application.vnd.trellisfw.sars.1+json',
    {
      lfTemplate: 'Specifications that indicate acceptable requirements',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.w-9.1+json',
    {
      lfTemplate: 'W-9',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.nutritional-information.1+json',
    {
      lfTemplate: '100g Nutritional Information',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.allergen-statement.1+json',
    {
      lfTemplate: 'Allergen Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.be-ingredient-statement.1+json',
    {
      lfTemplate: 'Bioengineered (BE) Ingredient Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.ca-prop-65-statement.1+json',
    {
      lfTemplate: 'California Prop 65 Statement',
      metadata: genericMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.coo-statement.1+json',
    {
      lfTemplate: 'Country of Origin Statement',
      metadata: genericMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.gluten-statement.1+json',
    {
      lfTemplate: 'Gluten Statement',
      metadata: genericMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.ingredient-breakdown.1+json',
    {
      lfTemplate: 'Ingredient Breakdown Range %',
      metadata: genericMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.product-label.1+json',
    {
      lfTemplate: 'Product Label',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.product-spec.1+json',
    {
      lfTemplate: 'Product Specification',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.sds.1+json',
    {
      lfTemplate: 'Safety Data Sheet (SDS)',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.gmo-statement.1+json',
    {
      lfTemplate: 'GMO Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.natural-statement.1+json',
    {
      lfTemplate: 'Natural Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-certificates.1+json',
    {
      lfTemplate: 'GFSI Certificate',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.animal-statement.1+json',
    {
      lfTemplate: 'Non-Ambulatory (3D/4D) Animal Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-audit.1+json',
    {
      lfTemplate: 'Specified Risk Materials (SRM) Audit',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-statement.1+json',
    {
      lfTemplate: 'Specified Risk Materials (SRM) Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-corrective-actions.1+json',
    {
      lfTemplate: 'Specified Risk Materials (SRM) Corrective Actions',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.ecoli-audit.1+json',
    {
      lfTemplate: 'E.Coli 0157:H7 Intervention Audit',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.foreign-material-control-plans.1+json',
    {
      lfTemplate: 'Foreign Material Control Plan',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.animal-welfare-audit.1+json',
    {
      lfTemplate: 'Animal Welfare Audit',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.humane-harvest-statement.1+json',
    {
      lfTemplate: 'Humane Harvest Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.nrp-statement.1+json',
    {
      lfTemplate: 'National Residue Program (NRP) Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.lot-code-explanation.1+json',
    {
      lfTemplate: 'Lot Code Explanation',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.aphis-statement.1+json',
    {
      lfTemplate: 'APHIS Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.bpa-statement.1+json',
    {
      lfTemplate: 'Bisphenol A (BPA) Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-audit.1+json',
    {
      lfTemplate: 'GFSI Audit',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.haccp-plan.1+json',
    {
      lfTemplate: 'HACCP Plan / Flow Chart',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.copacker-fsqa-questionnaire.1+json',
    {
      lfTemplate: 'Co-Packer FSQA Questionnaire (GFSI Certified)',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.copack-confidentiality-agreement-form.1+json',
    {
      lfTemplate: 'Co-Pack Confidentiality Agreement Form',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.tpa-corrective-actions.1+json',
    {
      lfTemplate: 'Third Party Food Safety GMP Audit Corrective Actions',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.w-8.1+json',
    {
      lfTemplate: 'W-8',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-audit.1+json',
    {
      lfTemplate: 'Third Party Food Safety GMP Audit',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.animal-welfare-corrective-actions.1+json',
    {
      lfTemplate: 'Animal Welfare Corrective Actions',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-certificate.1+json',
    {
      lfTemplate: 'Third Party Food Safety GMP Certificate',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.sba-form.1+json',
    {
      lfTemplate: 'Small Business Administration (SBA) Form',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.wire-form.1+json',
    {
      lfTemplate: 'WIRE Form',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.ecoli-statement.1+json',
    {
      lfTemplate: 'E.Coli 0157:H7 Intervention Statement',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.business-license.1+json',
    {
      lfTemplate: 'Business License',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.rate-sheet.1+json',
    {
      lfTemplate: 'Rate Sheet',
      metadata: genericMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.msa.1+json',
    {
      lfTemplate: 'Master Service Agreement (MSA)',
      metadata: genericMetadata,
    },
  ],
]);
