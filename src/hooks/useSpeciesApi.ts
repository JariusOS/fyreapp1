import { useState, useEffect, useCallback } from 'react';
import { Species, ConservationStatus, getStatusLabel } from '@/data/species';
export type { Species } from '@/data/species';

interface ApiSpecies {
  id?: string;
  name: string;
  symbol?: string;
  code?: string;
  status?: string;
  iucnStatus?: string;
  rarity?: string;
  image?: string;
  scientificName?: string;
  population?: string;
  region?: string;
  description?: string;
  tokenId?: string;
  slug?: string;
  tokenAddress?: string;
  poolCurrencyToken?: {
    address: string;
    name: string;
    decimals: number;
  };
  chainId?: number | string;
  tradable?: boolean | string;
  marketCap?: number | string;
  marketCapFormatted?: string;
  holders?: number | string;
  circulatingSupply?: number | string;
  totalSupply?: number | string;
}

interface ApiResponse {
  data: ApiSpecies[];
}

const IUCN_CODES: ConservationStatus[] = ['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE', 'EW', 'EX'];

// Map API status to an IUCN code. The text label is checked first because the
// API's iucnStatus code is wrong for some species (e.g. "LE" for Least Concern,
// "NE" for Near Threatened, "EX" for Extinct in the Wild).
const mapStatusToCode = (status?: string, iucnStatus?: string): ConservationStatus => {
  if (status) {
    const statusLower = status.toLowerCase();
    // "Near Extinct" isn't an IUCN category; it's used for Vaquita and Hawksbill, both CR
    if (statusLower.includes('critically') || statusLower.includes('near extinct')) return 'CR';
    if (statusLower.includes('endangered')) return 'EN';
    if (statusLower.includes('vulnerable')) return 'VU';
    if (statusLower.includes('near')) return 'NT';
    if (statusLower.includes('least')) return 'LC';
    if (statusLower.includes('data')) return 'DD';
    if (statusLower.includes('extinct') && statusLower.includes('wild')) return 'EW';
    if (statusLower.includes('extinct')) return 'EX';
    if (statusLower.includes('not evaluated')) return 'NE';
  }
  const code = iucnStatus?.toUpperCase();
  if (code === 'LE') return 'LC';
  if (code === 'DA') return 'DD';
  if (code && (IUCN_CODES as string[]).includes(code)) return code as ConservationStatus;
  return 'NE';
};

const toNumber = (v?: number | string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const mapApiSpecies = (apiSpecies: ApiSpecies[]): Species[] =>
  apiSpecies.map((s, index) => {
    // Numeric ID from "FCBC #190" / "FCBC 190", else from symbol "FCBC190"
    const fcbcId =
      s.id?.match(/(\d+)/)?.[1] ||
      s.symbol?.match(/(\d+)/)?.[1] ||
      String(index + 1);

    const symbol = s.symbol || `FCBC${fcbcId}`;
    const iucnCode = mapStatusToCode(s.status, s.iucnStatus);

    return {
      // Identity & Token
      id: `FCBC #${fcbcId}`,
      name: s.name,
      symbol,
      code: s.code || symbol,

      // Conservation
      status: iucnCode,
      statusLabel: s.status || getStatusLabel(iucnCode),
      rarity: s.rarity || 'Unknown',

      // Media
      image: s.image || '',

      // Display fields
      scientificName: s.scientificName || '',
      ticker: `$${symbol}`,
      population: s.population || 'Unknown',
      region: s.region || 'Unknown',
      votes: 0, // real counts come from useSpeciesStats
      description: s.description || '',

      // Zora/Onchain data
      tokenAddress: s.tokenAddress,
      poolCurrencyToken: s.poolCurrencyToken,
      chainId: toNumber(s.chainId),
      // If tokenAddress exists, it's tradable (API tradable field may be outdated)
      tradable: !!s.tokenAddress,
      marketCap: toNumber(s.marketCap),
      marketCapFormatted: s.marketCapFormatted,
      holders: toNumber(s.holders),
      circulatingSupply: toNumber(s.circulatingSupply),
      totalSupply: toNumber(s.totalSupply),
    };
  });

const SPECIES_API_URL = 'https://server.fcbc.fun/api/v1/zora/species?count=1234';
const FETCH_TIMEOUT_MS = 15000;

// Fetch the species list, failing with a readable reason instead of hanging
// or throwing on a non-JSON error page.
const fetchSpeciesJson = async (): Promise<ApiSpecies[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(SPECIES_API_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Species API returned HTTP ${response.status}`);
    }
    const json: ApiResponse = await response.json();
    if (!json || !Array.isArray(json.data) || json.data.length === 0) {
      throw new Error('Species API returned no species');
    }
    return json.data;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Species API timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    if (err instanceof TypeError) {
      // fetch() rejects with TypeError on DNS, CORS and connection failures
      throw new Error('Could not reach the species API (network or CORS error)');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// Saved copy of the real species list (no market data), used when the API is down.
// Loaded on demand so it isn't in the main bundle.
// Regenerate with: node scripts/build_species_snapshot.mjs <api-response.json>
const loadSnapshot = async (): Promise<{ snapshotDate: string; species: Species[] }> => {
  const mod = await import('@/data/purebreedsSnapshot.json');
  const snapshot = mod.default as { snapshotDate: string; data: ApiSpecies[] };
  return { snapshotDate: snapshot.snapshotDate, species: mapApiSpecies(snapshot.data) };
};

export const useSpeciesApi = () => {
  const [species, setSpecies] = useState<Species[]>([]);
  const [total, setTotal] = useState(0);
  const [onchain, setOnchain] = useState(0);
  const [loading, setLoading] = useState(true);
  // Why the live fetch failed (null when live data loaded)
  const [error, setError] = useState<string | null>(null);
  // Set when showing the saved snapshot instead of live data
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const refetch = useCallback(() => setAttempt(a => a + 1), []);

  useEffect(() => {
    let cancelled = false;

    const fetchSpecies = async () => {
      setLoading(true);
      setError(null);
      try {
        let apiSpecies: ApiSpecies[];
        try {
          apiSpecies = await fetchSpeciesJson();
        } catch (firstErr) {
          console.warn('Species fetch failed, retrying once:', firstErr);
          apiSpecies = await fetchSpeciesJson();
        }
        if (cancelled) return;
        const mapped = mapApiSpecies(apiSpecies);
        setSpecies(mapped);
        setSnapshotDate(null);
        setTotal(1234);
        setOnchain(mapped.length);
      } catch (err) {
        console.error('Failed to fetch species, using saved snapshot:', err);
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load species data');
        try {
          const snapshot = await loadSnapshot();
          if (cancelled) return;
          setSpecies(snapshot.species);
          setSnapshotDate(snapshot.snapshotDate);
          setTotal(1234);
          setOnchain(snapshot.species.length);
        } catch (snapshotErr) {
          console.error('Failed to load species snapshot:', snapshotErr);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSpecies();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { species, total, onchain, loading, error, snapshotDate, refetch };
};
