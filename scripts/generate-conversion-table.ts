// generate-conversion-table.ts
// Derives a unit conversion factor table from CLDR units.xml data.
// Outputs ecmarkup-formatted table rows and a human-readable verification table.
//
// Usage: npx tsx scripts/generate-conversion-table.ts

// --- Rational arithmetic on BigInts ---

interface Rational {
  num: bigint;
  den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function reduce(r: Rational): Rational {
  if (r.num === 0n) return { num: 0n, den: 1n };
  const g = gcd(r.num, r.den);
  let num = r.num / g;
  let den = r.den / g;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  return { num, den };
}

function mulRat(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.num, den: a.den * b.den });
}

function divRat(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.den, den: a.den * b.num });
}

function addRat(a: Rational, b: Rational): Rational {
  return reduce({
    num: a.num * b.den + b.num * a.den,
    den: a.den * b.den,
  });
}

// --- Parse a decimal/scientific string to a Rational ---

function parseDecimalToRational(s: string): Rational {
  s = s.trim();

  // Handle scientific notation: e.g., "5.9722E+24" or "6.67408E-11"
  const sciMatch = s.match(/^(-?\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const base = parseDecimalToRational(sciMatch[1]);
    const exp = parseInt(sciMatch[2], 10);
    if (exp >= 0) {
      return mulRat(base, { num: 10n ** BigInt(exp), den: 1n });
    } else {
      return mulRat(base, { num: 1n, den: 10n ** BigInt(-exp) });
    }
  }

  // Handle rational notation: e.g., "2401/1331*1000" — but we handle / in expression parsing
  // Here we just handle simple "a/b" if present
  if (s.includes("/")) {
    const parts = s.split("/");
    if (parts.length === 2) {
      const num = parseDecimalToRational(parts[0]);
      const den = parseDecimalToRational(parts[1]);
      return divRat(num, den);
    }
  }

  // Handle negative
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  // Handle decimal: e.g., "0.3048"
  const dotIndex = s.indexOf(".");
  if (dotIndex >= 0) {
    const intPart = s.slice(0, dotIndex) || "0";
    const fracPart = s.slice(dotIndex + 1);
    const den = 10n ** BigInt(fracPart.length);
    const num = BigInt(intPart) * den + BigInt(fracPart);
    return reduce({ num: negative ? -num : num, den });
  }

  // Integer
  const num = BigInt(s);
  return { num: negative ? -num : num, den: 1n };
}

// --- CLDR Constants ---

const constants: Record<string, Rational> = {};

function defineConstant(name: string, value: string) {
  constants[name] = evaluateExpression(value);
}

// Evaluate a CLDR factor expression.
// CLDR syntax: terms separated by * are multiplied.
// A single / separates numerator terms from denominator terms.
// So "a*b/c*d" means (a*b) / (c*d).
function evaluateExpression(expr: string): Rational {
  expr = expr.trim();

  // Split on / to get numerator and denominator parts
  const slashIndex = expr.indexOf("/");
  let numTerms: string[];
  let denTerms: string[];

  if (slashIndex >= 0) {
    numTerms = expr.slice(0, slashIndex).split("*").map((s) => s.trim());
    denTerms = expr.slice(slashIndex + 1).split("*").map((s) => s.trim());
  } else {
    numTerms = expr.split("*").map((s) => s.trim());
    denTerms = [];
  }

  let result: Rational = { num: 1n, den: 1n };

  for (const term of numTerms) {
    if (term === "") continue;
    result = mulRat(result, resolveTerm(term));
  }

  for (const term of denTerms) {
    if (term === "") continue;
    result = divRat(result, resolveTerm(term));
  }

  return reduce(result);
}

function resolveTerm(term: string): Rational {
  term = term.trim();
  // Is it a named constant?
  if (constants[term] !== undefined) {
    return constants[term];
  }
  // Otherwise parse as a number
  return parseDecimalToRational(term);
}

// Define CLDR constants in dependency order
defineConstant("lb_to_kg", "0.45359237");
defineConstant("ft_to_m", "0.3048");
defineConstant("ft2_to_m2", "ft_to_m*ft_to_m");
defineConstant("ft3_to_m3", "ft_to_m*ft_to_m*ft_to_m");
defineConstant("in3_to_m3", "ft3_to_m3/12*12*12");
defineConstant("gal_to_m3", "231*in3_to_m3");
defineConstant("gal_imp_to_m3", "0.00454609");
defineConstant("speed_of_light_meters_per_second", "299792458");
defineConstant("sec_per_julian_year", "31557600");
defineConstant("meters_per_AU", "149597870700");
defineConstant("sho_to_m3", "2401/1331*1000");
defineConstant("tsubo_to_m2", "400/121");
defineConstant("shaku_to_m", "4/121");
defineConstant("gravity", "9.80665");
defineConstant("PI", "411557987/131002976");
defineConstant("AMU", "1.66053878283E-27");

// --- Unit definitions ---

interface UnitDef {
  source: string;
  baseUnit: string;
  factor?: string; // expression; if absent, factor = 1
  offset?: string; // expression; if absent, offset = 0
  category: string; // derived from unitQuantity mapping
  intl?: boolean; // true for locale-specific units (goes in intl.emu / ECMA-402)
}

// Map base units to their quantity (category) names
const baseUnitToCategory: Record<string, string> = {
  kilogram: "mass",
  "cubic-meter": "volume",
  "square-meter": "area",
  meter: "length",
  "meter-per-second": "speed",
  second: "duration",
  kelvin: "temperature",
  revolution: "angle",
  "revolution-per-second": "frequency",
  bit: "digital",
  part: "portion",
  "kilogram-meter-per-square-second": "force",
  "kilogram-per-meter-square-second": "pressure",
  "kilogram-square-meter-per-square-second": "energy",
  "kilogram-square-meter-per-cubic-second": "power",
  year: "year-duration",
};

// All CLDR convertUnit entries
const allUnits: UnitDef[] = [
  // Length (base unit: meter)
  { source: "meter", baseUnit: "meter", category: "length" },
  {
    source: "point",
    baseUnit: "meter",
    factor: "ft_to_m/864",
    category: "length",
  },
  {
    source: "inch",
    baseUnit: "meter",
    factor: "ft_to_m/12",
    category: "length",
  },
  {
    source: "foot",
    baseUnit: "meter",
    factor: "ft_to_m",
    category: "length",
  },
  {
    source: "yard",
    baseUnit: "meter",
    factor: "ft_to_m*3",
    category: "length",
  },
  {
    source: "fathom",
    baseUnit: "meter",
    factor: "ft_to_m*6",
    category: "length",
  },
  {
    source: "rod",
    baseUnit: "meter",
    factor: "ft_to_m*16.5",
    category: "length",
  },
  {
    source: "chain",
    baseUnit: "meter",
    factor: "ft_to_m*66",
    category: "length",
  },
  {
    source: "furlong",
    baseUnit: "meter",
    factor: "ft_to_m*660",
    category: "length",
  },
  {
    source: "mile",
    baseUnit: "meter",
    factor: "ft_to_m*5280",
    category: "length",
  },
  {
    source: "nautical-mile",
    baseUnit: "meter",
    factor: "1852",
    category: "length",
  },
  {
    source: "mile-scandinavian",
    baseUnit: "meter",
    factor: "10000",
    category: "length",
    intl: true,
  },
  {
    source: "earth-radius",
    baseUnit: "meter",
    factor: "6.3781E6",
    category: "length",
  },
  {
    source: "solar-radius",
    baseUnit: "meter",
    factor: "695700000",
    category: "length",
  },
  {
    source: "astronomical-unit",
    baseUnit: "meter",
    factor: "meters_per_AU",
    category: "length",
  },
  {
    source: "light-year",
    baseUnit: "meter",
    factor: "speed_of_light_meters_per_second*sec_per_julian_year",
    category: "length",
  },
  {
    source: "parsec",
    baseUnit: "meter",
    factor: "meters_per_AU*60*60*180/PI",
    category: "length",
  },
  // Japanese length units (ECMA-402)
  {
    source: "rin",
    baseUnit: "meter",
    factor: "shaku_to_m/1000",
    category: "length",
    intl: true,
  },
  {
    source: "sun",
    baseUnit: "meter",
    factor: "shaku_to_m/10",
    category: "length",
    intl: true,
  },
  {
    source: "shaku-length",
    baseUnit: "meter",
    factor: "shaku_to_m",
    category: "length",
    intl: true,
  },
  {
    source: "shaku-cloth",
    baseUnit: "meter",
    factor: "shaku_to_m*5/4",
    category: "length",
    intl: true,
  },
  {
    source: "ken",
    baseUnit: "meter",
    factor: "shaku_to_m*6",
    category: "length",
    intl: true,
  },
  {
    source: "jo-jp",
    baseUnit: "meter",
    factor: "shaku_to_m*10",
    category: "length",
    intl: true,
  },
  {
    source: "ri-jp",
    baseUnit: "meter",
    factor: "shaku_to_m*12960",
    category: "length",
    intl: true,
  },
  // Prefixed length units (not explicit in CLDR, derived from metric prefixes)
  {
    source: "centimeter",
    baseUnit: "meter",
    factor: "0.01",
    category: "length",
  },
  {
    source: "millimeter",
    baseUnit: "meter",
    factor: "0.001",
    category: "length",
  },
  {
    source: "micrometer",
    baseUnit: "meter",
    factor: "0.000001",
    category: "length",
  },
  {
    source: "nanometer",
    baseUnit: "meter",
    factor: "0.000000001",
    category: "length",
  },
  {
    source: "kilometer",
    baseUnit: "meter",
    factor: "1000",
    category: "length",
  },

  // Mass (base unit: kilogram)
  { source: "kilogram", baseUnit: "kilogram", category: "mass" },
  {
    source: "gram",
    baseUnit: "kilogram",
    factor: "0.001",
    category: "mass",
  },
  {
    source: "milligram",
    baseUnit: "kilogram",
    factor: "0.000001",
    category: "mass",
  },
  {
    source: "microgram",
    baseUnit: "kilogram",
    factor: "0.000000001",
    category: "mass",
  },
  {
    source: "carat",
    baseUnit: "kilogram",
    factor: "0.0002",
    category: "mass",
  },
  {
    source: "grain",
    baseUnit: "kilogram",
    factor: "lb_to_kg/7000",
    category: "mass",
  },
  {
    source: "ounce",
    baseUnit: "kilogram",
    factor: "lb_to_kg/16",
    category: "mass",
  },
  {
    source: "ounce-troy",
    baseUnit: "kilogram",
    factor: "0.03110348",
    category: "mass",
  },
  {
    source: "pound",
    baseUnit: "kilogram",
    factor: "lb_to_kg",
    category: "mass",
  },
  {
    source: "stone",
    baseUnit: "kilogram",
    factor: "lb_to_kg*14",
    category: "mass",
  },
  {
    source: "ton",
    baseUnit: "kilogram",
    factor: "lb_to_kg*2000",
    category: "mass",
  },
  {
    source: "tonne",
    baseUnit: "kilogram",
    factor: "1000",
    category: "mass",
  },
  {
    source: "slug",
    baseUnit: "kilogram",
    factor: "lb_to_kg*gravity/ft_to_m",
    category: "mass",
  },
  {
    source: "earth-mass",
    baseUnit: "kilogram",
    factor: "5.9722E+24",
    category: "mass",
  },
  {
    source: "solar-mass",
    baseUnit: "kilogram",
    factor: "1.98847E+30",
    category: "mass",
  },
  {
    source: "dalton",
    baseUnit: "kilogram",
    factor: "AMU",
    category: "mass",
  },
  {
    source: "fun",
    baseUnit: "kilogram",
    factor: "1*3/8000",
    category: "mass",
    intl: true,
  },

  // Volume (base unit: cubic-meter)
  { source: "cubic-meter", baseUnit: "cubic-meter", category: "volume" },
  {
    source: "liter",
    baseUnit: "cubic-meter",
    factor: "0.001",
    category: "volume",
  },
  {
    source: "milliliter",
    baseUnit: "cubic-meter",
    factor: "0.000001",
    category: "volume",
  },
  {
    source: "gallon",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3",
    category: "volume",
  },
  {
    source: "gallon-imperial",
    baseUnit: "cubic-meter",
    factor: "gal_imp_to_m3",
    category: "volume",
  },
  {
    source: "quart",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/4",
    category: "volume",
  },
  {
    source: "pint",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/8",
    category: "volume",
  },
  {
    source: "cup",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/16",
    category: "volume",
  },
  {
    source: "cup-metric",
    baseUnit: "cubic-meter",
    factor: "0.00025",
    category: "volume",
  },
  {
    source: "fluid-ounce",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/128",
    category: "volume",
  },
  {
    source: "fluid-ounce-imperial",
    baseUnit: "cubic-meter",
    factor: "gal_imp_to_m3/160",
    category: "volume",
  },
  {
    source: "tablespoon",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/256",
    category: "volume",
  },
  {
    source: "teaspoon",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/16*48",
    category: "volume",
  },
  {
    source: "pint-imperial",
    baseUnit: "cubic-meter",
    factor: "gal_imp_to_m3/8",
    category: "volume",
  },
  {
    source: "quart-imperial",
    baseUnit: "cubic-meter",
    factor: "gal_imp_to_m3/4",
    category: "volume",
  },
  {
    source: "barrel",
    baseUnit: "cubic-meter",
    factor: "42*gal_to_m3",
    category: "volume",
  },
  {
    source: "bushel",
    baseUnit: "cubic-meter",
    factor: "2150.42*in3_to_m3",
    category: "volume",
  },
  {
    source: "drop",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/128*576",
    category: "volume",
  },
  {
    source: "pinch",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/128*128",
    category: "volume",
  },
  {
    source: "dessert-spoon",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/16*128",
    category: "volume",
  },
  {
    source: "dessert-spoon-imperial",
    baseUnit: "cubic-meter",
    factor: "gal_imp_to_m3/16*128",
    category: "volume",
    intl: true,
  },
  {
    source: "dram",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3/128*8",
    category: "volume",
  },
  {
    source: "fluid-ounce-metric",
    baseUnit: "cubic-meter",
    factor: "0.03*0.001",
    category: "volume",
  },
  {
    source: "jigger",
    baseUnit: "cubic-meter",
    factor: "gal_to_m3*3/128*2",
    category: "volume",
  },
  {
    source: "cup-imperial",
    baseUnit: "cubic-meter",
    factor: "gal_imp_to_m3/16",
    category: "volume",
    intl: true,
  },
  {
    source: "pint-metric",
    baseUnit: "cubic-meter",
    factor: "0.0005",
    category: "volume",
  },
  // Japanese volume units (ECMA-402)
  {
    source: "kosaji",
    baseUnit: "cubic-meter",
    factor: "1*5*0.000001",
    category: "volume",
    intl: true,
  },
  {
    source: "osaji",
    baseUnit: "cubic-meter",
    factor: "1*15*0.000001",
    category: "volume",
    intl: true,
  },
  {
    source: "cup-jp",
    baseUnit: "cubic-meter",
    factor: "1*100*0.000001",
    category: "volume",
    intl: true,
  },
  {
    source: "shaku",
    baseUnit: "cubic-meter",
    factor: "sho_to_m3/100",
    category: "volume",
    intl: true,
  },
  {
    source: "sai",
    baseUnit: "cubic-meter",
    factor: "sho_to_m3/1000",
    category: "volume",
    intl: true,
  },
  {
    source: "to-jp",
    baseUnit: "cubic-meter",
    factor: "sho_to_m3*10",
    category: "volume",
    intl: true,
  },
  {
    source: "koku",
    baseUnit: "cubic-meter",
    factor: "sho_to_m3*100",
    category: "volume",
    intl: true,
  },

  // Temperature (base unit: kelvin)
  { source: "kelvin", baseUnit: "kelvin", category: "temperature" },
  {
    source: "celsius",
    baseUnit: "kelvin",
    offset: "273.15",
    category: "temperature",
  },
  {
    source: "fahrenheit",
    baseUnit: "kelvin",
    factor: "5/9",
    offset: "2298.35/9",
    category: "temperature",
  },
  {
    source: "rankine",
    baseUnit: "kelvin",
    factor: "5/9",
    category: "temperature",
  },

  // Area (base unit: square-meter)
  { source: "square-meter", baseUnit: "square-meter", category: "area" },
  {
    source: "hectare",
    baseUnit: "square-meter",
    factor: "10000",
    category: "area",
  },
  {
    source: "acre",
    baseUnit: "square-meter",
    factor: "ft2_to_m2*43560",
    category: "area",
  },
  {
    source: "dunam",
    baseUnit: "square-meter",
    factor: "1000",
    category: "area",
  },
  // Japanese area units (ECMA-402)
  {
    source: "bu-jp",
    baseUnit: "square-meter",
    factor: "tsubo_to_m2",
    category: "area",
    intl: true,
  },
  {
    source: "se-jp",
    baseUnit: "square-meter",
    factor: "tsubo_to_m2*30",
    category: "area",
    intl: true,
  },
  {
    source: "cho",
    baseUnit: "square-meter",
    factor: "tsubo_to_m2*3000",
    category: "area",
    intl: true,
  },
  // Prefixed
  {
    source: "square-kilometer",
    baseUnit: "square-meter",
    factor: "1000000",
    category: "area",
  },
  {
    source: "square-centimeter",
    baseUnit: "square-meter",
    factor: "0.0001",
    category: "area",
  },
  {
    source: "square-foot",
    baseUnit: "square-meter",
    factor: "ft2_to_m2",
    category: "area",
  },
  {
    source: "square-inch",
    baseUnit: "square-meter",
    factor: "ft2_to_m2/144",
    category: "area",
  },
  {
    source: "square-yard",
    baseUnit: "square-meter",
    factor: "ft2_to_m2*9",
    category: "area",
  },
  {
    source: "square-mile",
    baseUnit: "square-meter",
    factor: "ft2_to_m2*27878400",
    category: "area",
  },

  // Duration (base unit: second)
  { source: "second", baseUnit: "second", category: "duration" },
  {
    source: "millisecond",
    baseUnit: "second",
    factor: "0.001",
    category: "duration",
  },
  {
    source: "microsecond",
    baseUnit: "second",
    factor: "0.000001",
    category: "duration",
  },
  {
    source: "nanosecond",
    baseUnit: "second",
    factor: "0.000000001",
    category: "duration",
  },
  {
    source: "minute",
    baseUnit: "second",
    factor: "60",
    category: "duration",
  },
  {
    source: "hour",
    baseUnit: "second",
    factor: "3600",
    category: "duration",
  },
  {
    source: "day",
    baseUnit: "second",
    factor: "86400",
    category: "duration",
  },
  {
    source: "week",
    baseUnit: "second",
    factor: "86400*7",
    category: "duration",
  },
  {
    source: "day-person",
    baseUnit: "second",
    factor: "86400",
    category: "duration",
    intl: true,
  },
  {
    source: "week-person",
    baseUnit: "second",
    factor: "86400*7",
    category: "duration",
    intl: true,
  },
  {
    source: "fortnight",
    baseUnit: "second",
    factor: "86400*14",
    category: "duration",
  },

  // Year-Duration (base unit: year)
  { source: "year", baseUnit: "year", category: "year-duration" },
  {
    source: "month",
    baseUnit: "year",
    factor: "1/12",
    category: "year-duration",
  },
  {
    source: "decade",
    baseUnit: "year",
    factor: "10",
    category: "year-duration",
  },
  {
    source: "century",
    baseUnit: "year",
    factor: "100",
    category: "year-duration",
  },
  {
    source: "month-person",
    baseUnit: "year",
    factor: "1/12",
    category: "year-duration",
    intl: true,
  },
  {
    source: "quarter",
    baseUnit: "year",
    factor: "1/4",
    category: "year-duration",
  },
  {
    source: "year-person",
    baseUnit: "year",
    category: "year-duration",
    intl: true,
  },

  // Speed (base unit: meter-per-second)
  { source: "meter-per-second", baseUnit: "meter-per-second", category: "speed" },
  {
    source: "kilometer-per-hour",
    baseUnit: "meter-per-second",
    factor: "1000/3600",
    category: "speed",
  },
  {
    source: "mile-per-hour",
    baseUnit: "meter-per-second",
    factor: "ft_to_m*5280/3600",
    category: "speed",
  },
  {
    source: "knot",
    baseUnit: "meter-per-second",
    factor: "1852/3600",
    category: "speed",
  },
  {
    source: "light-speed",
    baseUnit: "meter-per-second",
    factor: "speed_of_light_meters_per_second",
    category: "speed",
  },

  // Angle (base unit: revolution)
  { source: "revolution", baseUnit: "revolution", category: "angle" },
  {
    source: "degree",
    baseUnit: "revolution",
    factor: "1/360",
    category: "angle",
  },
  {
    source: "arc-minute",
    baseUnit: "revolution",
    factor: "1/360*60",
    category: "angle",
  },
  {
    source: "arc-second",
    baseUnit: "revolution",
    factor: "1/360*60*60",
    category: "angle",
  },
  {
    source: "radian",
    baseUnit: "revolution",
    factor: "1/2*PI",
    category: "angle",
  },

  // Pressure
  {
    source: "pascal",
    baseUnit: "kilogram-per-meter-square-second",
    category: "pressure",
  },
  {
    source: "hectopascal",
    baseUnit: "kilogram-per-meter-square-second",
    factor: "100",
    category: "pressure",
  },
  {
    source: "kilopascal",
    baseUnit: "kilogram-per-meter-square-second",
    factor: "1000",
    category: "pressure",
  },
  {
    source: "megapascal",
    baseUnit: "kilogram-per-meter-square-second",
    factor: "1000000",
    category: "pressure",
  },
  {
    source: "bar",
    baseUnit: "kilogram-per-meter-square-second",
    factor: "100000",
    category: "pressure",
  },
  {
    source: "atmosphere",
    baseUnit: "kilogram-per-meter-square-second",
    factor: "101325",
    category: "pressure",
  },
  {
    source: "gasoline-energy-density",
    baseUnit: "kilogram-per-meter-square-second",
    factor: "33.705*3600*1000/gal_to_m3",
    category: "pressure",
  },

  // Energy
  {
    source: "joule",
    baseUnit: "kilogram-square-meter-per-square-second",
    category: "energy",
  },
  {
    source: "kilojoule",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "1000",
    category: "energy",
  },
  {
    source: "calorie",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "4.184",
    category: "energy",
  },
  {
    source: "kilocalorie",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "4184",
    category: "energy",
  },
  {
    source: "foodcalorie",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "4184",
    category: "energy",
  },
  {
    source: "british-thermal-unit",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "4.184*2267.96185/9",
    category: "energy",
  },
  {
    source: "electronvolt",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "1.602177E-19",
    category: "energy",
  },
  {
    source: "calorie-it",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "4.1868",
    category: "energy",
  },
  {
    source: "british-thermal-unit-it",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "4.1868*2267.96185/9",
    category: "energy",
  },
  {
    source: "therm-us",
    baseUnit: "kilogram-square-meter-per-square-second",
    factor: "105480400",
    category: "energy",
  },

  // Power
  {
    source: "watt",
    baseUnit: "kilogram-square-meter-per-cubic-second",
    category: "power",
  },
  {
    source: "kilowatt",
    baseUnit: "kilogram-square-meter-per-cubic-second",
    factor: "1000",
    category: "power",
  },
  {
    source: "megawatt",
    baseUnit: "kilogram-square-meter-per-cubic-second",
    factor: "1000000",
    category: "power",
  },
  {
    source: "horsepower",
    baseUnit: "kilogram-square-meter-per-cubic-second",
    factor: "ft_to_m*lb_to_kg*gravity*550",
    category: "power",
  },
  {
    source: "solar-luminosity",
    baseUnit: "kilogram-square-meter-per-cubic-second",
    factor: "3.828E+26",
    category: "power",
  },

  // Force
  {
    source: "newton",
    baseUnit: "kilogram-meter-per-square-second",
    category: "force",
  },
  {
    source: "kilonewton",
    baseUnit: "kilogram-meter-per-square-second",
    factor: "1000",
    category: "force",
  },
  {
    source: "pound-force",
    baseUnit: "kilogram-meter-per-square-second",
    factor: "lb_to_kg*gravity",
    category: "force",
  },
  {
    source: "kilogram-force",
    baseUnit: "kilogram-meter-per-square-second",
    factor: "gravity",
    category: "force",
  },

  // Digital (base unit: bit)
  { source: "bit", baseUnit: "bit", category: "digital" },
  { source: "byte", baseUnit: "bit", factor: "8", category: "digital" },
  {
    source: "kilobit",
    baseUnit: "bit",
    factor: "1000",
    category: "digital",
  },
  {
    source: "megabit",
    baseUnit: "bit",
    factor: "1000000",
    category: "digital",
  },
  {
    source: "gigabit",
    baseUnit: "bit",
    factor: "1000000000",
    category: "digital",
  },
  {
    source: "kilobyte",
    baseUnit: "bit",
    factor: "8000",
    category: "digital",
  },
  {
    source: "megabyte",
    baseUnit: "bit",
    factor: "8000000",
    category: "digital",
  },
  {
    source: "gigabyte",
    baseUnit: "bit",
    factor: "8000000000",
    category: "digital",
  },
  {
    source: "terabyte",
    baseUnit: "bit",
    factor: "8000000000000",
    category: "digital",
  },

  // Portion (base unit: part)
  { source: "part", baseUnit: "part", category: "portion" },
  {
    source: "percent",
    baseUnit: "part",
    factor: "1/100",
    category: "portion",
  },
  {
    source: "permille",
    baseUnit: "part",
    factor: "1/1000",
    category: "portion",
  },
  {
    source: "permyriad",
    baseUnit: "part",
    factor: "1/10000",
    category: "portion",
  },
  {
    source: "karat",
    baseUnit: "part",
    factor: "1/24",
    category: "portion",
  },

  // Frequency
  {
    source: "hertz",
    baseUnit: "revolution-per-second",
    category: "frequency",
  },
  {
    source: "kilohertz",
    baseUnit: "revolution-per-second",
    factor: "1000",
    category: "frequency",
  },
  {
    source: "megahertz",
    baseUnit: "revolution-per-second",
    factor: "1000000",
    category: "frequency",
  },
  {
    source: "gigahertz",
    baseUnit: "revolution-per-second",
    factor: "1000000000",
    category: "frequency",
  },

];

// --- Compute rational factor/offset for each unit ---

interface ComputedUnit {
  source: string;
  category: string;
  baseUnit: string;
  factorNum: bigint;
  factorDen: bigint;
  offsetNum: bigint;
  offsetDen: bigint;
  intl: boolean;
}

const computedUnits: ComputedUnit[] = [];

for (const unit of allUnits) {
  const factor = unit.factor
    ? evaluateExpression(unit.factor)
    : { num: 1n, den: 1n };
  const offset = unit.offset
    ? evaluateExpression(unit.offset)
    : { num: 0n, den: 1n };

  computedUnits.push({
    source: unit.source,
    category: unit.category,
    baseUnit: unit.baseUnit,
    factorNum: factor.num,
    factorDen: factor.den,
    offsetNum: offset.num,
    offsetDen: offset.den,
    intl: unit.intl ?? false,
  });
}

// --- Select all units except base-unit identity entries ---
// Base units are handled by GetUnitConversionFactor's
// "Else if _unit_ appears as the base unit" clause in the spec.

const selectedUnits = computedUnits.filter((u) => u.source !== u.baseUnit);

// --- Verification: test some known conversions ---

// Simulate the spec's ConvertUnitValue using rational arithmetic on BigInts,
// converting to Number only at the very end via Number(num) / Number(den).
function simulateConversion(
  value: number,
  sourceUnit: string,
  targetUnit: string
): number {
  const src = computedUnits.find((u) => u.source === sourceUnit);
  const tgt = computedUnits.find((u) => u.source === targetUnit);
  if (!src || !tgt) throw new Error(`Unit not found: ${sourceUnit} or ${targetUnit}`);
  if (src.category !== tgt.category)
    throw new Error(`Category mismatch: ${src.category} vs ${tgt.category}`);

  // Represent input value as a rational: parse the Number to avoid FP issues
  // For our test cases, values are integers or simple fractions
  const valueRat = parseDecimalToRational(String(value));

  // No-offset path
  if (src.offsetNum === 0n && tgt.offsetNum === 0n) {
    const resultNum = valueRat.num * src.factorNum * tgt.factorDen;
    const resultDen = valueRat.den * src.factorDen * tgt.factorNum;
    const r = reduce({ num: resultNum, den: resultDen });
    return Number(r.num) / Number(r.den);
  }

  // Offset path: baseValue = value * srcF + srcO
  // baseValue as rational:
  //   = (valueRat.num/valueRat.den) * (src.factorNum/src.factorDen) + (src.offsetNum/src.offsetDen)
  const valTimesFactor: Rational = {
    num: valueRat.num * src.factorNum,
    den: valueRat.den * src.factorDen,
  };
  const baseValue = addRat(valTimesFactor, {
    num: src.offsetNum,
    den: src.offsetDen,
  });

  // result = (baseValue - tgtOffset) * tgtFD / tgtFN
  const shifted = addRat(baseValue, {
    num: -tgt.offsetNum,
    den: tgt.offsetDen,
  });
  const result = mulRat(shifted, {
    num: tgt.factorDen,
    den: tgt.factorNum,
  });

  return Number(result.num) / Number(result.den);
}

console.log("=== VERIFICATION ===\n");

const tests: [number, string, string, number][] = [
  [84, "inch", "foot", 7],
  [7, "foot", "inch", 84],
  [1, "mile", "foot", 5280],
  [5280, "foot", "mile", 1],
  [1, "yard", "foot", 3],
  [1, "pound", "ounce", 16],
  [16, "ounce", "pound", 1],
  [100, "celsius", "fahrenheit", 212],
  [212, "fahrenheit", "celsius", 100],
  [-40, "celsius", "fahrenheit", -40],
  [-40, "fahrenheit", "celsius", -40],
  [0, "celsius", "fahrenheit", 32],
  [32, "fahrenheit", "celsius", 0],
  [1, "kilometer", "meter", 1000],
  [1000, "meter", "kilometer", 1],
  [1, "gallon", "quart", 4],
  [4, "quart", "gallon", 1],
  [1, "gallon", "fluid-ounce", 128],
  [1, "hour", "minute", 60],
  [1, "minute", "second", 60],
  [1, "day", "hour", 24],
  [1, "byte", "bit", 8],
  [360, "degree", "revolution", 1],
  [1, "kilogram", "gram", 1000],
  [1000, "gram", "kilogram", 1],
  [1, "kilogram", "pound", 1 / 0.45359237], // not exact int, but let's see
];

let allPassed = true;
for (const [value, from, to, expected] of tests) {
  const result = simulateConversion(value, from, to);
  const pass = Math.abs(result - expected) < 1e-10;
  if (!pass) allPassed = false;
  const exactInt = Number.isInteger(expected) && result === expected;
  console.log(
    `  ${value} ${from} → ${to}: ${result}${exactInt ? " (EXACT)" : ""}${!pass ? " FAIL (expected " + expected + ")" : ""}`
  );
}
console.log(`\n${allPassed ? "All tests passed!" : "SOME TESTS FAILED!"}\n`);

// --- Output: human-readable table ---

console.log("=== CONVERSION FACTOR TABLE ===\n");

// Group by category
const byCategory = new Map<string, ComputedUnit[]>();
for (const u of selectedUnits) {
  const list = byCategory.get(u.category) || [];
  list.push(u);
  byCategory.set(u.category, list);
}

// Sort categories
const categoryOrder = [
  "length",
  "mass",
  "volume",
  "temperature",
  "area",
  "duration",
  "year-duration",
  "speed",
  "angle",
  "pressure",
  "energy",
  "power",
  "force",
  "digital",
  "portion",
  "frequency",
];

for (const cat of categoryOrder) {
  const units = byCategory.get(cat);
  if (!units) continue;

  console.log(`Category: ${cat} (base unit: ${units[0].baseUnit})`);
  console.log(
    "  %-25s %20s %20s %15s %15s".replace(
      /%(-?\d*)s/g,
      (_, w) => `${"Unit".padEnd(parseInt(w) || 25)}`
    )
  );

  for (const u of units) {
    const factorStr =
      u.factorDen === 1n
        ? `${u.factorNum}`
        : `${u.factorNum}/${u.factorDen}`;
    const offsetStr =
      u.offsetNum === 0n
        ? "0"
        : u.offsetDen === 1n
          ? `${u.offsetNum}`
          : `${u.offsetNum}/${u.offsetDen}`;
    const approx = Number(u.factorNum) / Number(u.factorDen);
    console.log(
      `  ${u.source.padEnd(25)} factor=${factorStr.padEnd(30)} offset=${offsetStr.padEnd(15)} (~${approx})`
    );
  }
  console.log();
}

// --- Output: ecmarkup tables (one per category, split by 262/402) ---

function emitTables(units: ComputedUnit[], label: string, idSuffix: string) {
  const byCat = new Map<string, ComputedUnit[]>();
  for (const u of units) {
    const list = byCat.get(u.category) || [];
    list.push(u);
    byCat.set(u.category, list);
  }

  console.log(`=== ECMARKUP TABLES (${label}) ===\n`);

  for (const cat of categoryOrder) {
    const catUnits = byCat.get(cat);
    if (!catUnits || catUnits.length === 0) continue;
    const baseUnit = catUnits[0].baseUnit;
    const capCat = cat.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
    const id = idSuffix ? `table-unit-conversion-factors-${cat}-${idSuffix}` : `table-unit-conversion-factors-${cat}`;
    const hasOffset = catUnits.some(u => u.offsetNum !== 0n);
    console.log(`      <emu-table id="${id}" caption="Unit Conversion Factors: ${capCat} (base unit: ${baseUnit})">`);
    console.log(`        <table>`);
    console.log(`          <thead>`);
    console.log(`            <tr>`);
    console.log(`              <th>Unit</th>`);
    console.log(`              <th>Numerator</th>`);
    console.log(`              <th>Denominator</th>`);
    if (hasOffset) {
      console.log(`              <th>OffsetNumerator</th>`);
      console.log(`              <th>OffsetDenominator</th>`);
    }
    console.log(`            </tr>`);
    console.log(`          </thead>`);
    console.log(`          <tbody>`);
    for (const u of catUnits) {
      console.log(`            <tr>`);
      console.log(`              <td>${u.source}</td>`);
      console.log(`              <td>${u.factorNum}</td>`);
      console.log(`              <td>${u.factorDen}</td>`);
      if (hasOffset) {
        console.log(`              <td>${u.offsetNum}</td>`);
        console.log(`              <td>${u.offsetDen}</td>`);
      }
      console.log(`            </tr>`);
    }
    console.log(`          </tbody>`);
    console.log(`        </table>`);
    console.log(`      </emu-table>`);
    console.log();
  }
}

const ecma262Units = selectedUnits.filter(u => !u.intl);
const ecma402Units = selectedUnits.filter(u => u.intl);

emitTables(ecma262Units, "ECMA-262 / spec.emu", "");
emitTables(ecma402Units, "ECMA-402 / intl.emu", "intl");

console.log(`\nTotal units: ${selectedUnits.length} (262: ${ecma262Units.length}, 402: ${ecma402Units.length})`);
