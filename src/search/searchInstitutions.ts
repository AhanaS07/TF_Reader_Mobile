import type { Institution } from '@model/institution';
import { getCatalogueSource } from '../config/catalogue';

export interface InstitutionQueryParams {
  q?: string;
  country?: string;
  page?: number;
  size?: number;
}

export async function searchInstitutions(
  params?: InstitutionQueryParams,
): Promise<Institution[]> {
  const results = await getCatalogueSource().getInstitutions(params);
  console.log('searchInstitutions: query', params?.q, 'results count', results.length);
  return results;
}
