# JSBON
JavaScript Binary Object Notation - a module for encoding/decoding objects to/from binary.

## Caveat

JSBON (*JavaScript Binary Object Notation*) is **not** BJSON (*Binary JSON*) and does not necessarily serve the same purpose.
If you are looking for binary JSON encoders/decoders, there are several proposals for BJSON (notably *Universal Binary 
JSON* at http://ubjson.org/) which may better fit your needs.

## Purpose

The aim of this small library is to provide a simple binary format for JavaScript structures, mostly intended for on-disk storage or data transmission. The requirements were to have a reasonably efficient encoding, preserving object structures (including duplicate objects and cyclic references).

THIS IS A PRELIMINARY VERSION - Things may certainly be further optimized and improved.

**NOTE**: The library relies on the *DataStream* module (https://github.com/kig/DataStream.js) which is also included here for mere convenience - This might not necessarily be the latest version.

## Documentation

#### Prerequisites

##### In regular browser-based environments

Load the scripts in that order:
```
  <script src="DataStream.js"></script>
  <script src="JSBON.js"></script>
```

**NOTE**: Tests performed on Chrome 51+ and Firefox 47+.

##### For the NodeJS environment

Simply require the module:
```
  const JSBON = require('./JSBON')
  // Your code goes here
```

##### In AMD-enabled environments

Assuming paths are correctly configured and you know how to write AMD-aware code (*Asynchronous Module Definition*):
```
  define(['JSBON'], function(JSBON) {
    // Your code goes here
  });
```

#### Usage 

Once the module and its dependencies are loaded, you may just use the `JSBON.encode` and `JSBON.decode` functions as illustrated below.

```
var o1 = { *Some object* };
var binary = JSBON.encode(o1); // Uint8Array containing the encoded data
...
var o2 = JSBON.decode(binary); // Object
```

The module also exports the encoder and decoder object classes, for those who may want to extend them.

The `JSON.encode` function also accepts options as a second argument.

The only option supported so far is `hasCRC`. When enabled, a CRC32 will also be stored, and checked at decoding (with some cost in performances, so this is mostly reserved for cases where a data integrity check is required):
```
var o1 = { *Some object* };
var binary = JSBON.encode(o1, { hasCRC: true });
```

The decoder and encoder throw errors (exceptions) if anything goes wrongs, so you may want to `try..catch` the calls if felt necessary. (For the record, the same comment would apply to JSON.)

## General principles

The following rules apply:
- Numbers, strings, objects, arrays, null and booleans are obviously supported,
- Undefined properties are kept (as opposed e.g. to JSON),
```
var o1 = { a: undefined };
var binary = JSBON.encode(o1);
var o2 = JSBON.decode(binary); 
o2.hasOwnProperty("a"); // True
```
- Dates are supported (and not converted to string as in JSON),
```
var o1 = { d: new Date() };
var binary = JSBON.encode(o1);
var o2 = JSBON.decode(binary); 
o2.d instanceof Date; // True
```
- Uint8Arrays are also allowed (allowing for binary data to be embedded efficiently),
```
var o1 = [1, 2, 3];
var b1 = JSBON.encode(o1);
var o2 = { o: b1 };
var b2 = JSBON.encode(o2);
var o3 = JSBON.decode(b2); 
o3.o instanceof Uint8Array; // True
```
- Referenced objects are kept (also allowing circular structures - something JSON cannot do),
```
var o1 = { name: "o1", children: [] } ;
var o2 = { name: "o2", parent: o1 };
o1.children.push(o2);
var binary = JSBON.encode(o1);
var o3 = JSBON.decode(binary); 
o3.children[0].parent === o3; // True
```
- This also works for arrays,
- If an object has a `toJSON` method, it is honored, allowing you to specify what should be serialized in your own classes.
```
var user = { firstName: "John", lastName: "Smith", 
  get fullName() { return this.firstName + " " + this.lastName; }
  toJSON: function() { return { firstName: this.firstName, lastName: this.lastName }; }
};
JSBON.decode(JSBON.encode(user)); // { firstName: "John", lastName: "Smith" } 
```

## Encoding internal workings

The binary encoding follows the principles detailed hereafter.
- Data are encoded in Big Endian format, when relevant,
- First byte encodes the major version (for compatibility check) and the options. The decoder throws an error if data were encoded with a more recent major version,
- If the CRC option is enabled, a 32-bit unsigned value follows. By design, the CRC32 is currently computed on the encoded objects, but not on the two initial TOS. This may change in later versions, if felt preferable,
- Two tables of strings (TOS) are prepended to the actual data, the first for object property names, and the second for all other string values:
  - The TOS starts with a Count value (see below), and is followed by a many strings as specified,
  - All strings are null-terminated and encoded in UTF-8,
- Data types are encoded with an 8-bit tag:
  - False (0x00), true (0x01), null (0x05), undefined (0x06) are encoded by their tag only,
  - Numbers are encoded differently depending on being integers or not:
    - Int8: tag 0x02 and 8-bit signed value,
    - Int16: tag 0x03 and 16-bit signed value,
    - Int32: tag 0x04 and 32-bit signed value,
    - All other numbers: tag 0x09 and 64-bit float value,
  - String: tag 0x16 and Count value as index in the string TOS,
  - Date: tag 0x20 and 64-bit float value,
  - Object or Array (by reference): tag 0x07 and 32-bit unsigned reference index: position in the binary stream before the TOS are added,
  - Object (by value): tag 0x30, Count value specifiying the number of properties, and then each property with a Count value as index to the property TOS, and the value,
  - Array (by value): tag 0x31, Count value for number of elements and then all elements,
  - Uint8Array: tag 0x32, Count value for number of bytes, and then the contents of the Uint8Array itself,
- Count values are encoded according to their size:
  - Short values 0..127 are encoded in a single unsigned byte,
  - 0x80 and 16-bit unsigned value,
  - 0x81 and 32-bit unsigned value,
- Some tags are reserved for future use.

While not necessarily optimal (and not an aim it itself), this seems to achive a good compression ratio. Very small objects will likely require more bytes than their JSON encoding, but on large objects with lots of repeated property names (e.g. GeoJSON), the binary encoding may be 20-50% smaller the raw JSON. Your mileage may vary depending on your data set.

## License

Licensed under the Apache License, Version 2.0 (the "License").
You may not use this file except in compliance with the License. 
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
