# JSBON
JavaScript Binary Object Notation - a module for encoding/decoding objects from/to binary.

## Caveat

JSBON (JavaScript Binary Object Notation) is **not** BJSON (Binary JSON) and does not necessarily serve the same purpose.
If you are looking for binary JSON encoders/decoders, there are several proposals for BJSON (notably Universal Binaray 
JSON at http://ubjson.org/) which may better fit your needs.

## Purpose

The aim of this small library is to provide a simple binary format for JavaScript structures, mostly intended for on-disk storage or data transmission.

THIS IS A PRELIMINARY VERSION - Things may certainly be further optimized and improved.

**NOTE**: The library relies on the *DataStream* module (https://github.com/kig/DataStream.js) which is also included here for 
mere convenience - This might not necessarily be the latest version.

## Usage

Assuming DataStream.js and JSBON.js are included (or require()'d) in your code, you may just use the `JSBON.encode` and `JSBON.decode` functions as illustrated below.

```
var o1 = { *Some object* };
var binary = JSBON.encode(o1); // Uint8Array containing the encoded data
...
var o2 = JSBON.decode(binary); // Object
```

## Principles

The following rules apply:
- Numbers, strings, objects, arrays, null and booleans are obviously supported
- Undefined properties are kept (as opposed e.g. to JSON)
```
var o1 = { a: undefined };
var binary = JSBON.encode(o1);
var o2 = JSBON.decode(binary); 
o2.hasOwnProperty("a"); // True
```
- Dates are restored (and not converted to string as in JSON)
```
var o1 = { d: new Date() };
var binary = JSBON.encode(o1);
var o2 = JSBON.decode(binary); 
o2.d instanceof Date; // True
```
- Uint8Arrays are also kept (allowing for binary data to be embedded)
```
var o1 = [1, 2, 3];
var b1 = JSBON.encode(o1);
var o2 = { o: b1 };
var b2 = JSBON.encode(o2);
var o3 = JSBON.decode(b2); 
o3.o instanceof Uint8Array; // True
```
- Referenced objects are kept (also allowing circular structures) 
```
var o1 = { name: "o1", children: [] } ;
var o2 = { name: "o2", parent: o1 };
o1.children.push(o2);
var binary = JSBON.encode(o1);
var o3 = JSBON.decode(binary); 
o3.children[0].parent === o3; // True
```

## License

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
