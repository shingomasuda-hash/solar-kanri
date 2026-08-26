/**
 * Fetch a golden reference case from the live PVGIS API.
 *
 * Requires outbound access to re.jrc.ec.europa.eu. Writes a case file into
 * tests/fixtures/solar/golden/ ready for the golden comparison suite.
 *
 * Usage:
 *   npx tsx scripts/fetch-pvgis-golden.ts --lat 35.6812 --lon 139.7671 \
 *     --tilt 30 --azimuth 180 --kw 5 --id pvgis-tokyo-30s-5kw
 *
 * After writing at least one case, set `status` in
 * tests/fixtures/solar/golden/manifest.json to "ACTIVE" so the comparisons
 * become mandatory.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compassToPvgisAspect } from '../src/core/solar/providers/pvgis';

interface Args {
  lat: number;
  lon: number;
  tilt: number;
  azimuth: number;
  kw: number;
  id: string;
  loss: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string): string => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required argument --${name}`);
  };
  const lat = Number(get('lat'));
  const lon = Number(get('lon'));
  const tilt = Number(get('tilt', '30'));
  const azimuth = Number(get('azimuth', '180'));
  const kw = Number(get('kw', '5'));
  const loss = Number(get('loss', '14'));
  const id = get('id', `pvgis-${lat.toFixed(2)}-${lon.toFixed(2)}-t${tilt}-a${azimuth}-${kw}kw`);
  return { lat, lon, tilt, azimuth, kw, id, loss };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = 'https://re.jrc.ec.europa.eu/api/v5_3';
  const aspect = compassToPvgisAspect(args.azimuth);

  // PVcalc gives the reference annual yield; MRcalc gives the monthly
  // irradiance and temperature series our engine consumes. We need both: one
  // is the answer to check against, the other is the input to check with.
  const pvcalc = new URL(`${base}/PVcalc`);
  pvcalc.searchParams.set('lat', String(args.lat));
  pvcalc.searchParams.set('lon', String(args.lon));
  pvcalc.searchParams.set('peakpower', String(args.kw));
  pvcalc.searchParams.set('pvtechchoice', 'crystSi');
  pvcalc.searchParams.set('mountingplace', 'building');
  pvcalc.searchParams.set('loss', String(args.loss));
  pvcalc.searchParams.set('angle', String(args.tilt));
  pvcalc.searchParams.set('aspect', String(aspect));
  pvcalc.searchParams.set('outputformat', 'json');

  const mrcalc = new URL(`${base}/MRcalc`);
  mrcalc.searchParams.set('lat', String(args.lat));
  mrcalc.searchParams.set('lon', String(args.lon));
  mrcalc.searchParams.set('angle', String(args.tilt));
  mrcalc.searchParams.set('aspect', String(aspect));
  mrcalc.searchParams.set('selectrad', '1');
  mrcalc.searchParams.set('avtemp', '1');
  mrcalc.searchParams.set('outputformat', 'json');

  console.log(`Fetching PVcalc:  ${pvcalc}`);
  console.log(`Fetching MRcalc:  ${mrcalc}`);

  const [pv, mr] = await Promise.all([getJson(pvcalc), getJson(mrcalc)]);

  const annual = (pv as any)?.outputs?.totals?.fixed?.E_y;
  if (typeof annual !== 'number') {
    throw new Error('PVcalc response did not contain outputs.totals.fixed.E_y');
  }

  const days: Record<number, number> = {
    1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
  };
  const perDay: Record<string, number> = {};
  const temps: Record<string, number> = {};
  for (const row of ((mr as any)?.outputs?.monthly ?? []) as any[]) {
    const m = row.month as number;
    const total = row['H(i)_m'] ?? row['H(h)_m'];
    if (typeof total !== 'number' || typeof row.T2m !== 'number') continue;
    perDay[String(m)] = total / days[m]!;
    temps[String(m)] = row.T2m;
  }
  if (Object.keys(perDay).length !== 12) {
    throw new Error(
      `MRcalc returned ${Object.keys(perDay).length} usable months; expected 12. ` +
        'Check that the radiation database covers this location.',
    );
  }

  // Match PVGIS's single `loss` percentage with an equivalent split so the
  // comparison isolates the model rather than the derate bookkeeping.
  const systemFactor = 1 - args.loss / 100;
  const caseFile = {
    id: args.id,
    description: `PVGIS v5.3, ${args.kw} kW at ${args.tilt} deg tilt / ${args.azimuth} deg azimuth`,
    source: {
      kind: 'public-dataset',
      citation: 'PVGIS v5.3 PVcalc + MRcalc, EU Joint Research Centre',
      url: pvcalc.toString(),
      retrievedAt: new Date().toISOString(),
    },
    input: {
      installedKw: args.kw,
      mounting: 'roof-flush',
      latitude: args.lat,
      longitude: args.lon,
      tiltDeg: args.tilt,
      azimuthDeg: args.azimuth,
      module: { pmaxTempCoeffPerK: -0.0035, noctC: 44, annualDegradation: 0 },
      losses: {
        inverterEfficiency: systemFactor,
        wiringFactor: 1,
        soilingFactor: 1,
        shadingFactor: 1,
        otherApprovedFactor: 1,
      },
      temperatureRiseK: { 'roof-flush': 25, 'roof-raised': 20, 'ground-mounted': 15 },
      climate: { planeOfArrayKWhPerM2PerDay: perDay, ambientTempC: temps },
    },
    reference: { annualGenerationKWh: annual },
    reviewNote:
      'REVIEW BEFORE USE: the module thermal figures above are PVGIS defaults, not a real ' +
      'datasheet. Replace them with the datasheet values for the module this case is meant ' +
      'to represent, and record the tolerance agreed with the Product Owner.',
  };

  const out = join(process.cwd(), 'tests/fixtures/solar/golden', `${args.id}.json`);
  writeFileSync(out, `${JSON.stringify(caseFile, null, 2)}\n`);
  console.log(`\nWrote ${out}`);
  console.log(`PVGIS reference annual yield: ${annual} kWh`);
  console.log('\nNext: review the module thermal figures, then set manifest.json status=ACTIVE.');
}

async function getJson(url: URL): Promise<unknown> {
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`${url.pathname} responded ${res.status} ${res.statusText}`);
  return res.json();
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
