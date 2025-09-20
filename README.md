# Representing Measures

**Stage**: 1

**Champion**: Ben Allen [@ben-allen](https://github.com/ben-allen)

**Author**: Ben Allen [@ben-allen](https://github.com/ben-allen)

## Goals and needs

Modeling amounts with a precision is useful for any task that involves physical quantities.
It can also be useful for other types of real-world amounts, such as currencies.
We propose creating a new object for representing amounts,
and for producing formatted string representations thereof.

Common user needs that can be addressed by a robust API for measurements include, but are not limited to:

* The need to keep track of the precision of measured values. A measurement value represented with a large number of significant figures can imply that the measurements themselves are more precise than the apparatus used to take the measurement can support.

* The need to represent currency values. Often users will want to keep track of money values together with the currency in which those values are denominated.

* The need to format measurements into string representations

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

* `toString([ options ])`: Returns a string representation of the Amount.
  By default, returns a digit string together with the unit in square brackets (e.g., `"1.23[kg]`) if the Amount does have an amount; otherwise, just the bare numeric value.
  With `options` specified (not undefined), we consult its `displayUnit` property, looking for three possible String values: `"auto"`, `"never"`, and `"always"`. With `"auto"` (the default), we do what was just described previously. With `displayUnit "never"`, we will never show the unit, even if the Amount does have one; and with `displayUnit: "always"` we will always show the unit, using `"1"` as the unit for Amounts without a unit (the "unit unit").

* `toLocaleString(locale[, options])`: Return a formatted string representation appropriate to the locale (e.g., `"1,23 kg"` in a locale that uses a comma as a fraction separator). The options are the same as those for `toString()` above.
* `with(options)`: Create a new Amount based on this one,
  together with additional options.

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

Note that, currently, no meaning is specified within Amount for units.
You can use `"XYZ"` or `"keelogramz"` as a unit.
Calling `toLocaleString()` on an Amount with a unit not supported by Intl.NumberFormat will throw an Error.
Unit identifiers consisting of three upper-case ASCII letters will be formatted with `style: 'currency'`,
while all other units will be formatted with `style: 'unit'`.


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

### Unit conversion

One might want to convert an Amount from one unit (e.g., miles) to another (e.g., kilometers).
We envision that functionality to be potentially introduced as part of the [Smart Units](https://github.com/tc39/proposal-smart-unit-preferences) proposal.
This implies that converting from unit to another is not supported,
as well as converting amounts between scales (e.g., converting grams to kilograms).
Our work here in this proposal is designed to provide a foundation for such ideas.

### Derived units

Some units can derive other units, such as square meters and cubic yards (to mention only a couple!). Support for such units is currently out-of-scope for this proposal.

### Compound units

Some units can be combined. In the US, it is common to express the heights of people in terms of feet and inches, rather than a non-integer number of feet or a "large" number of inches. For instance, one would say commonly express a height of 71 inches as "5 feet 11 inches" rather than "71 inches" or "5.92 feet". Thus, one would naturally want to support "foot-and-inch" as a compound unit, derivable from a measurement in terms of feet or inches. Likewise, combining units to express, say, velocity (miles per hour) or density (grams per cubic centimeter) also falls under this umbrella.  Since this is closely related to unit conversion, we prefer to see this functionality in Smart Units.

## Frequently Asked Questions

### Why a language feature and not a library?

This type exists primarily for interop with existing native language features, like Intl, and between libraries.

### If Intl is the motivating use case, why not call this Intl.Amount?

Although Intl is what drives some of the champions to pursue this proposal, the use cases are not limited to Intl. The Amount type is a generally-useful abstraction on top of a numeric type with some non-Intl functionality such as serialization and library interop. Optimal i18n on the Web Platform depends on Amount being a widely accepted and used type, not something only for developers who are already using Intl. It is not unlike how Temporal types earning widespread adoption improves localization of datetimes on the Web.

### Why a primordial and not a protocol?

Some delegates unconvinced by the non-Intl use cases have suggested that `Intl.NumberFormat.prototype.format` can read fields from its argument the same as if it were passed a proper Amount object, which we call a "protocol" based approach.

The primordial assists with discoverability and adoption. If it is just a protocol supported by Intl.NumberFormat, then the usage that would get would be significantly lower than if an Amount actually existed as a thing that developers could find and use and benefit from. The primordial also allows fast-paths in engine APIs that accept it as an argument.

The protocol should likely coexist, as it enables polyfills and cross-membrane code.

### Why represent precision as number of significant digits instead of something else like margin of error?

Existing ECMA-262 and ECMA-402 APIs deal with precision in terms of significant digits: for example, `Number.prototype.toPrecision` and `minimumSignificantDigits` in `Intl.NumberFormat` and `Intl.PluralRules`. We do not wish to innovate in this area. Further, CLDR does not provide data for formatting of precision any other way, and we are unaware of a feature request for it.

## Related/See also

* [Smart Units](https://github.com/tc39/proposal-smart-unit-preferences) (mentioned several times as a natural follow-on proposal to this one)
* [Decimal](https://github.com/tc39/proposal-decimal) for exact decimal arithmetic
* [Keep trailing zeroes](https://github.com/tc39/proposal-intl-keep-trailing-zeros) to ensure that when Intl handles digit strings, it doesn't automatically strip trailing zeroes (e.g., silently normalize "1.20" to "1.2").

## Polyfill

A [polyfill](https://www.npmjs.com/package/proposal-amount)
is available for testing. Since this proposal is still at
stage 1, expect breaking changes; in general, it is not
suitable for production use.
