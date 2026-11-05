import { fromOpenFoodFacts, type Food } from '@/domain/food';

const FIELDS = 'code,product_name,product_name_de,generic_name,brands,nutriments,serving_quantity,serving_size';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'CoachApp/1.0 (persoenliche Nutzung)' };

/** Freie Lebensmitteldatenbank Open Food Facts – Suche (deutsche Produkte zuerst). */
export async function searchOff(query: string): Promise<Food[]> {
  const url =
    'https://de.openfoodfacts.org/cgi/search.pl?' +
    new URLSearchParams({ search_terms: query, search_simple: '1', action: 'process', json: '1', page_size: '30', fields: FIELDS }).toString();
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const json = (await res.json()) as { products?: Record<string, unknown>[] };
  return (json.products ?? []).map(fromOpenFoodFacts).filter((f): f is Food => f !== null);
}

export async function productByBarcode(code: string): Promise<Food | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const json = (await res.json()) as { status?: number; product?: Record<string, unknown> };
  if (!json.product || json.status === 0) return null;
  return fromOpenFoodFacts({ ...json.product, code });
}
