import type { Metadata } from '../cws/metadata';

export function coiMetadata(doc: any): Metadata {
  // FIXME: Should this assert the CoI type with @oada/formats?

  let policies = Object.values<any>(doc.policies).reduce<Record<string, any>>(
    (v, p) => {
      v[p.type] = p;
      return v;
    },
    {}
  );

  let effective_date = new Date(
    Math.max.apply(
      Math,
      Object.values(policies).map((p) => +new Date(p.effective_date))
    )
  );

  let expiration_date = new Date(
    Math.min.apply(
      Math,
      Object.values(policies).map((p) => +new Date(p.min))
    )
  );

  return {
    'Document Type': 'Certificate of Insurance',
    'Document Date': effective_date.toISOString(),
    'Expiration Date': expiration_date.toISOString(),
    'Insurance Producer': doc.producer.name,
    'Insured Company': doc.insured.name,
    'General Liability': (
      policies['Commercial General Liability']?.general_aggregate || ''
    ).toString(),
    'Automotive Liability': (
      policies['Automobile Liability']?.combined_single_limit || ''
    ).toString(),
    'Workers Comp and Employers Liability': (
      policies["Employers' Liability"]?.el_each_accident || ''
    ).toString(),
    'Certificate Holder': doc.holder.name,
    // FIXME: Implement
    'Umbrella Liability': '-1',
    // FIXME: Implement
    'Description of Locations/Operations/Vehicles': 'NOT IMPLEMENTED',
    // FIXME: Implement
    'Signature': 'NOT IMPLEMENTED',
  };
}
