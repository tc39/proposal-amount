# Representing Measures

**Stage**: 1

**Champion**: Ben Allen [@ben-allen](https://github.com/ben-allen)

**Author**: Ben Allen [@ben-allen](https://github.com/ben-allen)

## Goals and needs

Modeling amounts with a precision is useful for any task that involves physical quantities.
It can also be useful for other types of real-world amounts, such as currencies.
We propose creating a new object for representing amounts,
for producing formatted string representations thereof,
and for converting amounts between scales.

Common user needs that can be addressed by a robust API for measurements include, but are not limited to:

* The need to keep track of the precision of measured values. A measurement value represented with a large number of significant figures can imply that the measurements themselves are more precise than the apparatus used to take the measurement can support.

* The need to represent currency values. Often users will want to keep track of money values together with the currency in which those values are denominated.

* The need to format measurements into string representations

* The need to convert measurements from one scale to another

* Related to both of the above, the need to localize measurements.

## Description

We propose creating a new `Amount` API, whose values will be immutable and have the following properties:

Note: ⚠️  All property/method names up for bikeshedding.

* `unit` (String or undefined): The unit of measurement with which number should be understood (with *undefined* indicating "none supplied")
* `significantDigits` (Number): how many significant digits does this value contain? (Should be a positive integer)
* `fractionalDigits` (Number): how many digits are required to fully represent the part of the fractional part of the underlying mathematical value. (Should be a non-negative integer.)

#### Precision

A big question is how we should handle precision. When constructing an Amount, both the significant digits and fractional digits are recorded.

### Constructor

* `new Amount(value[, options])`. Constructs an Amount with the mathematical value of `value`, and optional `options`, of which the following are supported (all being optional):
  * `unit` (String): a marker for the measurement
  * `fractionDigits`: the number of fractional digits the mathematical value should have (can be less than, equal to, or greater than the actual number of fractional digits that the underlying mathematical value has when rendered as a decimal digit string)
  * `significantDigits`: the number of significant digits that the mathematical value should have  (can be less than, equal to, or greater than the actual number of significant digits that the underlying mathematical value has when rendered as a decimal digit string)
  * `roundingMode`: one of the seven supported Intl rounding modes. This option is used when the `fractionDigits` and `significantDigits` options are provided and rounding is necessary to ensure that the value really does have the specified number of fraction/significant digits.

The object prototype would provide the following methods:

* `convertTo(options)`. This method returns an Amount in the scale indicated by the `options` parameter,
  with the value of the new Amount being the value of the Amount it is called on converted to the new scale.
  The `options` object supports the following properties:

  * `unit` (String): An explicit conversion target unit identifier
  * `locale` (String or Array of Strings or undefined):
    The locale for which the preferred unit of the corresponding category is determined.
  * `usage` (String): The use case for the Amount, such as `"person"` for a mass unit.
  * Optional properties with the same meanings as the corresponding
    Intl.NumberFormat constructor [digit options]:
    * `minimumFractionDigits`
    * `maximumFractionDigits`
    * `minimumSignificantDigits`
    * `maximumSignificantDigits`
    * `roundingMode`
    * `roundingPriority`

  The `options` must contain at least one of `unit`, `locale`, or `usage`.
  If the `options` contains an explicit `unit` value, it must not contain `locale` or `usage`.
  If `locale` is set and `usage` is undefined, the `"default"` usage is assumed.
  If `usage` is set and `locale` is undefined, the default locale is assumed.

  The result of unit conversion will be rounded according to the digit options.
  By default, if no rounding options are set,
  `{ minimumFractionDigits: 0, maximumFractionDigits: 3}` is used.
  If both fraction and significant digit options are set,
  the resulting behaviour is selected by the `roundingPriority`.

  Calling `convertTo()` will throw an error if conversion is not supported
  for the Amount's unit (such as currency units),
  or if the resolved conversion target is not valid for the Amount's unit
  (such as attempting to convert a mass unit into a length unit).

* `toString([ options ])`: Returns a string representation of the Amount.
  By default, returns a digit string together with the unit in square brackets (e.g., `"1.23[kg]`) if the Amount does have an amount; otherwise, just the bare numeric value.
  With `options` specified (not undefined), we consult its `displayUnit` property, looking for three possible String values: `"auto"`, `"never"`, and `"always"`. With `"auto"` (the default), we do what was just described previously. With `displayUnit "never"`, we will never show the unit, even if the Amount does have one; and with `displayUnit: "always"` we will always show the unit, using `"1"` as the unit for Amounts without a unit (the "unit unit").

* `toLocaleString(locale[, options])`: Return a formatted string representation appropriate to the locale (e.g., `"1,23 kg"` in a locale that uses a comma as a fraction separator). The options are the same as those for `toString()` above.
* `with(options)`: Create a new Amount based on this one,
  together with additional options.

[digit options]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#digit_options

### Examples

Let's construct an Amount, query its properties, and render it.
First, we'll work with a bare number (no unit):

```js
let a = new Amount("123.456");
a.fractionDigits; // 3
a.significantDigits; // 6
a.with({ fractionDigits: 4 }).toString(); // "123.4560"
```

Notice that "upgrading" the precision of an Amount appends trailing zeroes to the number.

Here's an example with units:

```js
let a = new Amount("42.7", { unit: "kg" });
a.toString(); // "42.7[kg]"
a.toString({ numberOnly: true }); // "42.7"
```

#### Rounding

If one downgrades the precision of an Amount, rounding will occur. (Upgrading just adds trailing zeroes.)

```js
let a = new Amount("123.456");
a.with({ significantDigits: 5 }).toString(); // "123.46"
```

By default, we use the round-ties-to-even rounding mode, which is used by IEEE 754 standard, and thus by Number and [Decimal](https://github.com/tc39/proposal-decimal). One can specify a rounding mode:

```js
let b = new Amount("123.456");
a.with({ significantDigits: 5, roundingMode: "truncate" }).toString(); // "123.45"
```

## Units (including currency)

A core piece of functionality for the proposal is to support units (`mile`, `kilogram`, etc.) as well as currency (`EUR`, `USD`, etc.). An Amount need not have a unit/currency, and if it does, it has one or the other (not both). Example:

```js
let a = new Amount("123.456", { unit: "kg" }); // 123.456 kilograms
let b = new Amount("42.55", { unit: "EUR" }); // 42.55 Euros
```

Note that, currently, no meaning is specified within Amount for units, except for what is supported for unit conversion.
You can use `"XYZ"` or `"keelogramz"` as a unit.
Calling `toLocaleString()` on an Amount with a unit not supported by Intl.NumberFormat will throw an Error.
Unit identifiers consisting of three upper-case ASCII letters will be formatted with `style: 'currency'`,
while all other units will be formatted with `style: 'unit'`.

### Unit conversion

Unit conversion is supported for some units, the data for which is provided by the CLDR in the its file
[`common/supplemental/units.xml`](https://github.com/unicode-org/cldr/blob/main/common/supplemental/units.xml).
This file also provides the data for per-usage and per-locale unit preferences.

For each unit type, the data given in CLDR defines
a multiplication factor (and an offset for temperature untis)
for converting from a source unit to the unit type's base unit.
For example, the base unit for length is `meter`, and the conversion from `foot` to `meter` is given as 0.3048,
while the conversion from `inch` to `meter` is given as 0.3048/12.

Unit conversions with Amount work by first converting the source unit to the base unit,
and then to the target unit.
Each of these operations is done with Number operations.
For example, to convert 1.75 feet to inches, the following mathematical operations are performed internally:
```js
1.75 * 0.3048 / 0.025400000000000002 = 20.999999999999996
```

Rounding is applied only to the final result, according to the [digit options]
set in the conversion method's `options`.
The precision of the source Amount is not retained,
and the precision of the result is capped by the precision of Number.

The `locale` and `usage` values that may have been used in the conversion are not retained,
but the resulting Amount will of course have an appropriate `unit` set.

For example:

```js
let feet = new Amount(1.75, { unit: "foot" });
feet.convertTo({ unit: "inch" }); // 21 inches
feet.convertTo({ locale: "fr", usage: "person", maximumSignificantDigits: 3 }); // 53.3 cm
```

## Related but out-of-scope features

Amount is intended to be a small, straightforwardly implementable kernel of functionality for JavaScript programmers that could perhaps be expanded upon in a follow-on proposal if data warrants. Some features that one might imagine belonging to Amount are natural and understandable, but are currently out-of scope. Here are the features:

### Mathematical operations

Below is a list of mathematical operations that one could consider supporting. However, to avoid confusion and ambiguity about the meaning of propagating precision in arithmetic operations, *we do not intend to support mathematical operations*. A natural source of data would be the [CLDR data](https://github.com/unicode-org/cldr/blob/main/common/supplemental/units.xml) for both our unit names and the conversion constants are as in CLDR. One could conceive of operations such as:

* raising an Amount to an exponent
* multiply/divide an Amount by a scalar
* Add/subtract two Amounts of the same dimension
* multiply/divide an Amount by another Amount
* Convert between scales (e.g., convert from grams to kilograms)

could be imagined, but are out-of-scope in this proposal.
This proposal focuses on the numeric core that future proposals can build on.

### Derived units

Some units can derive other units, such as square meters and cubic yards (to mention only a couple!). Support for such units is currently out-of-scope for this proposal.

### Compound units

Some units can be combined. In the US, it is common to express the heights of people in terms of feet and inches, rather than a non-integer number of feet or a "large" number of inches. For instance, one would say commonly express a height of 71 inches as "5 feet 11 inches" rather than "71 inches" or "5.92 feet". Thus, one would naturally want to support "foot-and-inch" as a compound unit, derivable from a measurement in terms of feet or inches. Likewise, combining units to express, say, velocity (miles per hour) or density (grams per cubic centimeter) also falls under this umbrella.  Since this is closely related to unit conversion, we prefer to see this functionality in Smart Units.

## Related/See also

* [Smart Units](https://github.com/tc39/proposal-smart-unit-preferences) (mentioned several times as a natural follow-on proposal to this one)
* [Decimal](https://github.com/tc39/proposal-decimal) for exact decimal arithmetic
* [Keep trailing zeroes](https://github.com/tc39/proposal-intl-keep-trailing-zeros) to ensure that when Intl handles digit strings, it doesn't automatically strip trailing zeroes (e.g., silently normalize "1.20" to "1.2").
