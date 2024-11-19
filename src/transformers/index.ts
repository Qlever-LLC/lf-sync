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

import type Resource from '@oada/types/oada/resource.js';

import { generateGenericMetadata, genericVdocMetadata } from './generic.js';
import { ticketMetadata, ticketVdocMetadata } from './ticket.js';
import type { Metadata } from '../cws/index.js';
import { coiMetadata } from './coi.js';

export interface Transformers {
  doc: (document: Resource) => Metadata | Promise<Metadata>;
  vdoc: (document: Record<string, unknown>) => Metadata | Promise<Metadata>;
}

export function getTransformers(contentType: string): Transformers | undefined {
  return transformers.get(contentType);
}

const transformers = new Map<string, Transformers>([
  [
    'application/vnd.trellisfw.coi.accord.1+json',
    { doc: coiMetadata, vdoc: genericVdocMetadata },
  ],

  [
    'application/vnd.trellisfw.ach-form.1+json',
    {
      doc: generateGenericMetadata('ACH Form'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.pfgia.1+json',
    {
      doc: generateGenericMetadata(
        'Pure Food Guaranty and Indemnification Agreement (LOG)',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.letter-of-guarantee.1+json',
    {
      doc: generateGenericMetadata('Letter of Guarantee'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.emergency-contact-information.1+json',
    {
      doc: generateGenericMetadata('Emergency Contact Information'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application.vnd.trellisfw.sars.1+json',
    {
      doc: generateGenericMetadata(
        'Specifications that indicate acceptable requirements',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.w-9.1+json',
    {
      doc: generateGenericMetadata('W-9'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.nutritional-information.1+json',
    {
      doc: generateGenericMetadata('100g Nutritional Information'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.allergen-statement.1+json',
    {
      doc: generateGenericMetadata('Allergen Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.ingredient-statement.1+json',
    {
      doc: generateGenericMetadata('Ingredient Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.be-ingredient-statement.1+json',
    {
      doc: generateGenericMetadata('Bioengineered (BE) Ingredient Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.ca-prop-65-statement.1+json',
    {
      doc: generateGenericMetadata('California Prop 65 Statement'),
      vdoc: genericVdocMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.coo-statement.1+json',
    {
      doc: generateGenericMetadata('Country of Origin Statement'),
      vdoc: genericVdocMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.gluten-statement.1+json',
    {
      doc: generateGenericMetadata('Gluten Statement'),
      vdoc: genericVdocMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.gluten-claim-statement.1+json',
    {
      doc: generateGenericMetadata('Gluten Statement'),
      vdoc: genericVdocMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.ingredient-breakdown.1+json',
    {
      doc: generateGenericMetadata('Ingredient Breakdown Range %'),
      vdoc: genericVdocMetadata,
    },
  ],
  [
    'application/vnd.trellisfw.product-label.1+json',
    {
      doc: generateGenericMetadata('Product Label'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.product-spec.1+json',
    {
      doc: generateGenericMetadata('Product Specification'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.sds.1+json',
    {
      doc: generateGenericMetadata('Safety Data Sheet (SDS)'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.gmo-statement.1+json',
    {
      doc: generateGenericMetadata('GMO Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.natural-statement.1+json',
    {
      doc: generateGenericMetadata('Natural Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-certificates.1+json',
    {
      doc: generateGenericMetadata('GFSI Certificate'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.animal-statement.1+json',
    {
      doc: generateGenericMetadata('Non-Ambulatory (3D/4D) Animal Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-audit.1+json',
    {
      doc: generateGenericMetadata('Specified Risk Materials (SRM) Audit'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-statement.1+json',
    {
      doc: generateGenericMetadata('Specified Risk Materials (SRM) Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-statement-audit.1+json',
    {
      doc: generateGenericMetadata(
        'Specified Risk Materials (SRM) Statement / Audit',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.srm-corrective-actions.1+json',
    {
      doc: generateGenericMetadata(
        'Specified Risk Materials (SRM) Corrective Actions',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.ecoli-audit.1+json',
    {
      doc: generateGenericMetadata('E.Coli 0157:H7 Intervention Audit'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.foreign-material-control-plan.1+json',
    {
      doc: generateGenericMetadata('Foreign Material Control Plan'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.animal-welfare-audit.1+json',
    {
      doc: generateGenericMetadata('Animal Welfare Audit'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.tpa-animal-welfare-audit.1+json',
    {
      doc: generateGenericMetadata('Third Party Animal Welfare Audit'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.humane-harvest-statement.1+json',
    {
      doc: generateGenericMetadata('Humane Harvest Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.nrp-statement.1+json',
    {
      doc: generateGenericMetadata('National Residue Program (NRP) Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.lot-code-explanation.1+json',
    {
      doc: generateGenericMetadata('Lot Code Explanation'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.aphis-statement.1+json',
    {
      doc: generateGenericMetadata('APHIS Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.bpa-statement.1+json',
    {
      doc: generateGenericMetadata('Bisphenol A (BPA) Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-audit.1+json',
    { doc: generateGenericMetadata('GFSI Audit'), vdoc: genericVdocMetadata },
  ],

  [
    'application/vnd.trellisfw.haccp-plan.1+json',
    {
      doc: generateGenericMetadata('HACCP Plan / Flow Chart'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.copacker-fsqa-questionnaire.1+json',
    {
      doc: generateGenericMetadata(
        'Co-Packer FSQA Questionnaire (GFSI Certified)',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.copack-confidentiality-agreement-form.1+json',
    {
      doc: generateGenericMetadata('Co-Pack Confidentiality Agreement Form'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.tpa-food-safety-audit.1+json',
    {
      doc: generateGenericMetadata('Third Party Food Safety GMP Audit'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.tpa-corrective-actions.1+json',
    {
      doc: generateGenericMetadata(
        'Third Party Food Safety GMP Audit Corrective Actions',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.w-8.1+json',
    { doc: generateGenericMetadata('W-8'), vdoc: genericVdocMetadata },
  ],

  [
    'application/vnd.trellisfw.fsqa-audit.1+json',
    {
      doc: generateGenericMetadata('Third Party Food Safety GMP Audit'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.animal-welfare-corrective-actions.1+json',
    {
      doc: generateGenericMetadata('Animal Welfare Corrective Actions'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.tpa-animal-welfare-corrective-actions.1+json',
    {
      doc: generateGenericMetadata(
        'Third Party Animal Welfare Corrective Actions',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.fsqa-certificate.1+json',
    {
      doc: generateGenericMetadata('Third Party Food Safety GMP Certificate'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.gfsi-certificate.1+json',
    {
      doc: generateGenericMetadata('GFSI Certificate'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.sba-form.1+json',
    {
      doc: generateGenericMetadata('Small Business Administration (SBA) Form'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.wire-form.1+json',
    { doc: generateGenericMetadata('WIRE Form'), vdoc: genericVdocMetadata },
  ],

  [
    'application/vnd.trellisfw.ecoli-statement.1+json',
    {
      doc: generateGenericMetadata('E.Coli 0157:H7 Intervention Statement'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.business-license.1+json',
    {
      doc: generateGenericMetadata('Business License'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.rate-sheet.1+json',
    { doc: generateGenericMetadata('Rate Sheet'), vdoc: genericVdocMetadata },
  ],

  [
    'application/vnd.trellisfw.msa.1+json',
    {
      doc: generateGenericMetadata('Master Service Agreement (MSA)'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.letter-of-guarantee.1+json',
    {
      doc: generateGenericMetadata(
        'Pure Food Guaranty and Indemnification Agreement (LOG)',
      ),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw.signed-vendor-acknowledgement-form.1+json',
    {
      doc: generateGenericMetadata('Signed Vendor Acknowledgement Form'),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.trellisfw..1+json',
    {
      doc: generateGenericMetadata(''),
      vdoc: genericVdocMetadata,
    },
  ],

  [
    'application/vnd.zendesk.ticket.1+json',
    { doc: ticketMetadata, vdoc: ticketVdocMetadata },
  ],
]);