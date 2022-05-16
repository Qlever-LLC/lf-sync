import type { Metadata } from '../cws/metadata';

/*
interface CoIDocument {
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

export function coiMetadata(doc: any): Metadata {
  // FIXME: Should this assert the CoI type with @oada/formats?

  let policies = Object.values<any>(doc.policies).reduce<Record<string, any>>(
    (v, p) => {
      v[p.type] = p;
      return v;
    },
    {}
  );

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
    'Document Date': new Date(doc.effective_date).toISOString(),
    'Expiration Date': new Date(doc.expire_date).toISOString(),
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
