import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getIndiaPincode } from 'india-pincode';
import { RedisService } from '../../common/redis/redis.service';

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
// v3 — invalidates earlier cache entries that used different label rules.
const CACHE_KEY = (pin: string) => `pincode:v3:${pin}`;
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
  /** "B.O." / "S.O." / "H.O." / "G.P.O." — used to pick the main office. */
  BranchType?: string;
  /** "Delivery" / "Non-Delivery" — only deliverable offices are user-visible. */
  DeliveryStatus?: string;
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

/**
 * Post-office type priority — lower = more "main".
 *
 * Each Indian pincode covers multiple post offices. We want the canonical
 * one the user thinks of when they hear the pincode:
 *   - GPO / HO : the Head office of a metro / city
 *   - SO / PO  : the main sub office (typical for towns like Addanki, 523201)
 *   - BO       : Branch offices in surrounding villages — almost never the
 *                label a user types in the locality box
 *
 * Combined with a `delivery=true` preference, this picks "Addanki" for
 * 523201 (not "Kotikalapudi") and "New Delhi" for 110001 (not "Baroda House").
 */
const OFFICE_TYPE_PRIORITY: Record<string, number> = {
  GPO: 0,
  HO: 1,
  SO: 2,
  PO: 3,
  BO: 4,
};

interface PostOfficeLike {
  area?: string | null;
  district?: string | null;
  state?: string | null;
  officeType?: string | null;
  delivery?: boolean | null;
}

function pickMainOffice<T extends PostOfficeLike>(offices: readonly T[]): T | null {
  if (!offices?.length) return null;
  const sorted = [...offices].sort((a, b) => {
    // Delivery-enabled offices first — these are the ones the postal service
    // actually delivers to and are the canonical "main" office of the pin.
    const da = a.delivery ? 0 : 1;
    const db = b.delivery ? 0 : 1;
    if (da !== db) return da - db;
    const pa = OFFICE_TYPE_PRIORITY[a.officeType ?? ''] ?? 9;
    const pb = OFFICE_TYPE_PRIORITY[b.officeType ?? ''] ?? 9;
    return pa - pb;
  });
  return sorted[0] ?? null;
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
   * A single pincode covers many post offices (typically 5-25). We pick the
   * canonical "main" office for the pincode using office-type and delivery
   * heuristics — see `pickMainOffice` for the ordering rationale.
   */
  private lookupLocal(pincode: string): PincodeLookupResult {
    try {
      const res = pincodeDb().getByPincode(pincode, { limit: 200 });
      if (!res.success || !res.data?.data?.length) {
        return this.emptyResult(pincode, 'none');
      }
      const main = pickMainOffice(res.data.data);
      if (!main) {
        return this.emptyResult(pincode, 'none');
      }
      const locality = main.area?.trim() || null;
      const district = toTitleCase(main.district);
      const state = toTitleCase(main.state);
      const formatted =
        [locality, state].filter(Boolean).join(', ') || null;
      return { pincode, locality, district, state, formatted, source: 'local' };
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
      const main =
        pickMainOffice(
          envelope.PostOffice.map((po) => ({
            area: po.Name ?? null,
            district: po.District ?? null,
            state: po.State ?? null,
            officeType: po.BranchType ?? null,
            delivery: po.DeliveryStatus
              ? /delivery/i.test(po.DeliveryStatus) && !/non/i.test(po.DeliveryStatus)
              : null,
          })),
        ) ?? null;
      const locality = main?.area?.trim() || null;
      const district = toTitleCase(main?.district ?? null);
      const state = toTitleCase(main?.state ?? null);
      const formatted = [locality, state].filter(Boolean).join(', ') || null;
      return { pincode, locality, district, state, formatted, source: 'upstream' };
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
