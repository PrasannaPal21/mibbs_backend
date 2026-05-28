import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getIndiaPincode } from 'india-pincode';
import { RedisService } from '../../common/redis/redis.service';

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
// v2 key so we invalidate any cache entries from the previous lookup format
// that surfaced individual post-office names instead of the district label.
const CACHE_KEY = (pin: string) => `pincode:v2:${pin}`;
const UPSTREAM = 'https://api.postalpincode.in/pincode';
/** Hard upper bound so a slow upstream never blocks the questionnaire UI. */
const UPSTREAM_TIMEOUT_MS = 4000;

export interface PincodeLookupResult {
  pincode: string;
  /** Best-guess locality / Post Office name. May be empty if not found. */
  locality: string | null;
  district: string | null;
  state: string | null;
  /** Human-friendly summary (e.g. "Addanki, Andhra Pradesh"). */
  formatted: string | null;
  /** Where the result came from — useful for debugging only. */
  source?: 'local' | 'upstream' | 'none';
}

interface PostOfficeRow {
  Name?: string;
  District?: string;
  State?: string;
}

interface UpstreamResponse {
  Status?: string;
  Message?: string;
  PostOffice?: PostOfficeRow[] | null;
}

/**
 * Lazy singleton — the india-pincode dataset is ~3MB gzipped and takes
 * ~180ms to decompress on first call. We only pay that cost once, and
 * only if a lookup actually happens.
 */
let _pin: ReturnType<typeof getIndiaPincode> | null = null;
function pincodeDb() {
  if (!_pin) _pin = getIndiaPincode();
  return _pin;
}

/** Convert "NEW DELHI" → "New Delhi" so the UI shows nice casing. */
function toTitleCase(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

@Injectable()
export class LocationsService {
  private readonly log = new Logger(LocationsService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Lookup the locality / district / state for an Indian pincode.
   *
   * Strategy (offline-first):
   *   1. Local dataset (`india-pincode`, ~165K post offices, all 19.5K+ Indian
   *      pincodes from India Post / data.gov.in) — instant, no network.
   *   2. Redis cache — for upstream results we've fetched before.
   *   3. api.postalpincode.in upstream — only if the local dataset doesn't
   *      know this pincode (e.g. very recently allocated codes).
   *   4. Empty result — never throw on lookup misses; the UI still works.
   */
  async lookupPincode(pincodeRaw: string): Promise<PincodeLookupResult> {
    const pincode = pincodeRaw?.trim() ?? '';
    if (!PINCODE_REGEX.test(pincode)) {
      throw new BadRequestException('Pincode must be a 6-digit number that does not start with 0');
    }

    // 1) Offline dataset — covers every Indian pincode in the India Post directory.
    const local = this.lookupLocal(pincode);
    if (local.locality) return local;

    // 2) Redis cache of previous upstream lookups
    const cached = await this.redis.client.get(CACHE_KEY(pincode)).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as PincodeLookupResult;
      } catch {
        // fall through to fresh upstream fetch on cache corruption
      }
    }

    // 3) Upstream as a last resort
    const upstream = await this.fetchFromUpstream(pincode);

    // Cache positive results aggressively, negatives for only a day so a
    // transient upstream outage doesn't poison the cache for a month.
    const ttl = upstream.locality ? CACHE_TTL_SECONDS : 60 * 60 * 24;
    await this.redis.client
      .set(CACHE_KEY(pincode), JSON.stringify(upstream), 'EX', ttl)
      .catch((err) => this.log.warn({ err }, 'pincode cache write failed'));

    return upstream;
  }

  /**
   * Synchronous lookup against the bundled India Post directory.
   * Returns an empty result when the pincode is unknown — never throws.
   *
   * A single pincode in India typically covers 5-25 post offices spread
   * across a district. We deliberately surface the **district** as the
   * "locality" because it's the only label that uniquely identifies the
   * area covered by the pincode — picking one post office name (e.g.
   * "Baroda House" for 110001 / Connaught Place) confuses users.
   */
  private lookupLocal(pincode: string): PincodeLookupResult {
    try {
      const res = pincodeDb().getPincodeSummary(pincode);
      if (!res.success || !res.data) {
        return this.emptyResult(pincode, 'none');
      }
      const data = res.data;
      const district = toTitleCase(data.district);
      const state = toTitleCase(data.state);
      const formatted = [district, state].filter(Boolean).join(', ') || null;
      return {
        pincode,
        locality: district,
        district,
        state,
        formatted,
        source: 'local',
      };
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, 'local pincode lookup failed');
      return this.emptyResult(pincode, 'none');
    }
  }

  private async fetchFromUpstream(pincode: string): Promise<PincodeLookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const resp = await fetch(`${UPSTREAM}/${pincode}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        this.log.warn(`pincode upstream returned status=${resp.status}`);
        return this.emptyResult(pincode, 'none');
      }
      const body = (await resp.json()) as UpstreamResponse[] | UpstreamResponse;
      // Upstream returns either an array with a single envelope, or an envelope
      // — we defensively normalise both shapes.
      const envelope = Array.isArray(body) ? body[0] : body;
      if (!envelope || envelope.Status !== 'Success' || !envelope.PostOffice?.length) {
        return this.emptyResult(pincode, 'none');
      }
      const po = envelope.PostOffice[0];
      const district = toTitleCase(po.District ?? null);
      const state = toTitleCase(po.State ?? null);
      // We deliberately surface the district as the locality (see
      // `lookupLocal` for the rationale). Post-office names returned by the
      // upstream are not stable enough to use as the user-facing label.
      const formatted = [district, state].filter(Boolean).join(', ') || null;
      return {
        pincode,
        locality: district,
        district,
        state,
        formatted,
        source: 'upstream',
      };
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, 'pincode upstream lookup failed');
      return this.emptyResult(pincode, 'none');
    } finally {
      clearTimeout(timer);
    }
  }

  private emptyResult(pincode: string, source: PincodeLookupResult['source']): PincodeLookupResult {
    return { pincode, locality: null, district: null, state: null, formatted: null, source };
  }
}
