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

import type Resource from '@oada/types/oada/resource';
import type { Metadata } from '../cws/index.js';
import { coiMetadata } from './coi.js';
import { generateGenericMetadata } from './generic.js';

type Transformer = (document: unknown) => Metadata;

export function getTransformer(contentType: string): Transformer {
  return transformers.get(contentType) || generateGenericMetadata('');
}

export function transform(document: Resource): Metadata {
  return getTransformer(document._type)(document);
}

const transformers = new Map<string, Transformer>([
  ['application/vnd.trellisfw.coi.accord.1+json', coiMetadata],

  [
    'application/vnd.trellisfw.ach-form.1+json',
    generateGenericMetadata('ACH Form'),
  ],

  [
    'application/vnd.trellisfw.pfgia.1+json',
    generateGenericMetadata(
      'Pure Food Guaranty and Indemnification Agreement (LOG)'
    ),
  ],

  [
    'application/vnd.trellisfw.letter-of-guarantee.1+json',
    generateGenericMetadata('Letter of Guarantee'),
  ],

  [
    'application/vnd.trellisfw.emergency-contact-information.1+json',
    generateGenericMetadata('Emergency Contact Information'),
  ],

  [
    'application.vnd.trellisfw.sars.1+json',
    generateGenericMetadata(
      'Specifications that indicate acceptable requirements'
    ),
  ],

  ['application/vnd.trellisfw.w-9.1+json', generateGenericMetadata('W-9')],

  [
    'application/vnd.trellisfw.nutritional-information.1+json',
    generateGenericMetadata('100g Nutritional Information'),
  ],

  [
    'application/vnd.trellisfw.allergen-statement.1+json',
    generateGenericMetadata('Allergen Statement'),
  ],

  [
    'application/vnd.trellisfw.be-ingredient-statement.1+json',
    generateGenericMetadata('Bioengineered (BE) Ingredient Statement'),
  ],

  [
    'application/vnd.trellisfw.ca-prop-65-statement.1+json',
    generateGenericMetadata('California Prop 65 Statement'),
  ],
  [
    'application/vnd.trellisfw.coo-statement.1+json',
    generateGenericMetadata('Country of Origin Statement'),
  ],
  [
    'application/vnd.trellisfw.gluten-statement.1+json',
    generateGenericMetadata('Gluten Statement'),
  ],
  [
    'application/vnd.trellisfw.ingredient-breakdown.1+json',
    generateGenericMetadata('Ingredient Breakdown Range %'),
  ],
  [
    'application/vnd.trellisfw.product-label.1+json',
    generateGenericMetadata('Product Label'),
  ],

  [
    'application/vnd.trellisfw.product-spec.1+json',
    generateGenericMetadata('Product Specification'),
  ],

  [
    'application/vnd.trellisfw.sds.1+json',
    generateGenericMetadata('Safety Data Sheet (SDS)'),
  ],

  [
    'application/vnd.trellisfw.gmo-statement.1+json',
    generateGenericMetadata('GMO Statement'),
  ],

  [
    'application/vnd.trellisfw.natural-statement.1+json',
    generateGenericMetadata('Natural Statement'),
  ],

  [
    'application/vnd.trellisfw.fsqa-certificates.1+json',
    generateGenericMetadata('GFSI Certificate'),
  ],

  [
    'application/vnd.trellisfw.animal-statement.1+json',
    generateGenericMetadata('Non-Ambulatory (3D/4D) Animal Statement'),
  ],

  [
    'application/vnd.trellisfw.srm-audit.1+json',
    generateGenericMetadata('Specified Risk Materials (SRM) Audit'),
  ],

  [
    'application/vnd.trellisfw.srm-statement.1+json',
    generateGenericMetadata('Specified Risk Materials (SRM) Statement'),
  ],

  [
    'application/vnd.trellisfw.srm-corrective-actions.1+json',
    generateGenericMetadata(
      'Specified Risk Materials (SRM) Corrective Actions'
    ),
  ],

  [
    'application/vnd.trellisfw.ecoli-audit.1+json',
    generateGenericMetadata('E.Coli 0157:H7 Intervention Audit'),
  ],

  [
    'application/vnd.trellisfw.foreign-material-control-plans.1+json',
    generateGenericMetadata('Foreign Material Control Plan'),
  ],

  [
    'application/vnd.trellisfw.animal-welfare-audit.1+json',
    generateGenericMetadata('Animal Welfare Audit'),
  ],

  [
    'application/vnd.trellisfw.humane-harvest-statement.1+json',
    generateGenericMetadata('Humane Harvest Statement'),
  ],

  [
    'application/vnd.trellisfw.nrp-statement.1+json',
    generateGenericMetadata('National Residue Program (NRP) Statement'),
  ],

  [
    'application/vnd.trellisfw.lot-code-explanation.1+json',
    generateGenericMetadata('Lot Code Explanation'),
  ],

  [
    'application/vnd.trellisfw.aphis-statement.1+json',
    generateGenericMetadata('APHIS Statement'),
  ],

  [
    'application/vnd.trellisfw.bpa-statement.1+json',
    generateGenericMetadata('Bisphenol A (BPA) Statement'),
  ],

  [
    'application/vnd.trellisfw.fsqa-audit.1+json',
    generateGenericMetadata('GFSI Audit'),
  ],

  [
    'application/vnd.trellisfw.haccp-plan.1+json',
    generateGenericMetadata('HACCP Plan / Flow Chart'),
  ],

  [
    'application/vnd.trellisfw.copacker-fsqa-questionnaire.1+json',
    generateGenericMetadata('Co-Packer FSQA Questionnaire (GFSI Certified)'),
  ],

  [
    'application/vnd.trellisfw.copack-confidentiality-agreement-form.1+json',
    generateGenericMetadata('Co-Pack Confidentiality Agreement Form'),
  ],

  [
    'application/vnd.trellisfw.tpa-corrective-actions.1+json',
    generateGenericMetadata(
      'Third Party Food Safety GMP Audit Corrective Actions'
    ),
  ],

  ['application/vnd.trellisfw.w-8.1+json', generateGenericMetadata('W-8')],

  [
    'application/vnd.trellisfw.fsqa-audit.1+json',
    generateGenericMetadata('Third Party Food Safety GMP Audit'),
  ],

  [
    'application/vnd.trellisfw.animal-welfare-corrective-actions.1+json',
    generateGenericMetadata('Animal Welfare Corrective Actions'),
  ],

  [
    'application/vnd.trellisfw.fsqa-certificate.1+json',
    generateGenericMetadata('Third Party Food Safety GMP Certificate'),
  ],

  [
    'application/vnd.trellisfw.sba-form.1+json',
    generateGenericMetadata('Small Business Administration (SBA) Form'),
  ],

  [
    'application/vnd.trellisfw.wire-form.1+json',
    generateGenericMetadata('WIRE Form'),
  ],

  [
    'application/vnd.trellisfw.ecoli-statement.1+json',
    generateGenericMetadata('E.Coli 0157:H7 Intervention Statement'),
  ],

  [
    'application/vnd.trellisfw.business-license.1+json',
    generateGenericMetadata('Business License'),
  ],

  [
    'application/vnd.trellisfw.rate-sheet.1+json',
    generateGenericMetadata('Rate Sheet'),
  ],

  [
    'application/vnd.trellisfw.msa.1+json',
    generateGenericMetadata('Master Service Agreement (MSA)'),
  ],
]);
