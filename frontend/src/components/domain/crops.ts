/**
 * Crop codes that have an illustration in `CropGlyph`, and resolution from the shapes the API
 * returns: a catalogue code ("TOM"), a crop name in any UI language ("Tomato", "टमाटर") or a lot code
 * ("MM-TOM-0007").
 */

export const CROP_CODES = ['TOM', 'ONI', 'CHI', 'POT', 'MNG', 'GNT', 'OKR', 'BRN', 'CAB', 'BAN'] as const;
export type CropCode = (typeof CROP_CODES)[number];

const CODE_SET = new Set<string>(CROP_CODES);

/** Lower-cased names and common synonyms (English, Hindi, Telugu) for each illustrated crop. */
const NAME_ALIASES: Record<CropCode, readonly string[]> = {
  TOM: ['tomato', 'tomatoes', 'टमाटर', 'టమాటా', 'టమోటా'],
  ONI: ['onion', 'onions', 'प्याज', 'प्याज़', 'ఉల్లిపాయ', 'ఉల్లి'],
  CHI: ['green chilli', 'green chillies', 'chilli', 'chillies', 'chili', 'green chili', 'हरी मिर्च', 'मिर्च', 'పచ్చి మిర్చి', 'మిర్చి', 'మిరపకాయ'],
  POT: ['potato', 'potatoes', 'आलू', 'బంగాళాదుంప', 'ఆలుగడ్డ'],
  MNG: ['mango', 'mangoes', 'mangos', 'आम', 'మామిడి', 'మామిడి పండు'],
  GNT: ['groundnut', 'groundnuts', 'peanut', 'peanuts', 'मूंगफली', 'मूँगफली', 'వేరుశనగ', 'వేరుశెనగ'],
  OKR: ['okra', 'lady finger', 'ladies finger', "lady's finger", 'bhindi', 'भिंडी', 'బెండకాయ', 'బెండ'],
  BRN: ['brinjal', 'brinjals', 'eggplant', 'aubergine', 'बैंगन', 'వంకాయ'],
  CAB: ['cabbage', 'cabbages', 'पत्ता गोभी', 'पत्तागोभी', 'बंद गोभी', 'క్యాబేజీ'],
  BAN: ['banana', 'bananas', 'केला', 'అరటి', 'అరటిపండు', 'అరటి పండు'],
};

const ALIAS_TO_CODE = new Map<string, CropCode>(
  CROP_CODES.flatMap((code) => NAME_ALIASES[code].map((alias) => [alias, code] as const)),
);

function normalise(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
}

export function isCropCode(value: unknown): value is CropCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Crop code embedded in a lot code: "MM-TOM-0007" → "TOM". */
export function cropCodeFromLotCode(lotCode: string | null | undefined): CropCode | null {
  const match = /^MM-([A-Z]{2,5})-\d+$/.exec(lotCode?.trim().toUpperCase() ?? '');
  const code = match?.[1];
  return isCropCode(code) ? code : null;
}

/** Crop code for a crop name in English, Hindi or Telugu, ignoring a trailing variety in brackets. */
export function cropCodeFromName(name: string | null | undefined): CropCode | null {
  if (!name) return null;
  const cleaned = normalise(name.replace(/\(.*\)$/, ''));
  return ALIAS_TO_CODE.get(cleaned) ?? null;
}

export interface CropReference {
  code?: string | null;
  name?: string | null;
  lotCode?: string | null;
}

/** First crop code that can be derived from a catalogue code, a lot code or a crop name. */
export function resolveCropCode({ code, name, lotCode }: CropReference): CropCode | null {
  const upper = code?.trim().toUpperCase();
  if (isCropCode(upper)) return upper;
  return cropCodeFromLotCode(lotCode) ?? cropCodeFromName(name);
}
