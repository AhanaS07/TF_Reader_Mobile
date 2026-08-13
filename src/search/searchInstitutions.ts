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
  return getCatalogueSource().getInstitutions(params);
}
