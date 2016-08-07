/**
 * JSBON (JavaScript Binary Object Notation) is a module for encoding/decoding JavaScript objects to 
 * and from a binary representation.
 * Coded in 2016 by "Omikhleia"
 *
 * JSBON is not BJSON - If you are looking for binary JSON representations, several exist. This 
 * module may be used to a similar purpose, but its aims are different.
 * 
 * LICENSE:
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except 
 * in compliance with the License. You may obtain a copy of the License at
 * 
 * http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express 
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 *
 * @requires DataStreaam
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['DataStream'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(require('./DataStream'));
    } else {
        // Browser globals (root is window)
        root.JSBON = factory(root.DataStream);
    }
}(this, function (DataStream) {
    "use strict";
    
    const MAJOR_VERSION = 1;

    /** 
     * UTF-8 helper functions
     */
    function encode_utf8(s) {
      return unescape(encodeURIComponent(s));
    }

    function decode_utf8(s) {
      return decodeURIComponent(escape(s));
    }
    
    /** 
     * CRC-32 algorithm
     * Loosely inspired by sample code on the Internet 
     */

    var crc32 = (function () {
        "use strict";

        var table = new Uint32Array(256);

        // Pre-generate crc32 polynomial lookup table
        var i, tmp, k;
        for (i = 256; i--;) {
            var tmp = i;

            for (k = 8; k--;) {
                tmp = tmp & 1 ? 3988292384 ^ tmp >>> 1 : tmp >>> 1;
            }
            table[i] = tmp;
        }

        // crc32b function
        // param {Uint8Array} input     Byte array
        // returns {Uint32}   CRC value
        return function (data) {
            var crc = -1; // Begin with all bits set (0xffffffff)
            var i, l;
            for (i = 0, l = data.length; i < l; i += 1) {
                crc = crc >>> 8 ^ table[crc & 255 ^ data[i]];
            }

            return (crc ^ -1) >>> 0; // Binary NOT
        };
    })();
    
    /**
     * Encoder.
     *
     * @constructor
     */
    var Encoder = function () {
        this.ds = new DataStream();
        this.ds.endianness = DataStream.BIG_ENDIAN;
        this.object_refs = new Map(); // Object map for object references
        this.string_keys = new Map(); // Map for key references (i.e. property names)
        this.string_refs = new Map(); // Map for all other string references
        this.hasCycle = false; // Circular references exist: we don't know yet, so assume false until met.
    };

    // - Data type tags
    Encoder.TAG_BOOLEAN_FALSE  = 0x00;
    Encoder.TAG_BOOLEAN_TRUE   = 0x01;
    
    Encoder.TAG_INT8           = 0x02;
    Encoder.TAG_INT16          = 0x03;
    Encoder.TAG_INT32          = 0x04;
    
    Encoder.TAG_NULL           = 0x05;
    Encoder.TAG_UNDEFINED      = 0x06;
    
    Encoder.TAG_OBJECT_REF     = 0x07;
    /* 0x08 RESERVED */
    /* May be use if tables of strings are leveraged */
    
    Encoder.TAG_NUMBER         = 0x09;
    
    Encoder.TAG_UINT8          = 0x12;
    Encoder.TAG_UINT16         = 0x13;
    Encoder.TAG_UINT32         = 0x14;
    
    Encoder.TAG_STRING_REF     = 0x16;
    
    Encoder.TAG_DATE           = 0x20;
    
    Encoder.TAG_OBJECT         = 0x30;
    Encoder.TAG_ARRAY          = 0x31;
    Encoder.TAG_UINT8ARRAY     = 0x32;
    /* 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39 RESERVED */
    /* May be used if other binary arrays are implemented */
            
    // - Option flags
    Encoder.OPTION_CRC32       = 0x80;
    Encoder.OPTION_NOCYCLE     = 0x40;

    function getNumberTag(value) {
        if (value === (value >>> 0)) {
            // Unsigned integer 32-bit
            if ((value & 0xFF) === value) {
                return Encoder.TAG_UINT8;
            } else if ((value & 0xFFFF) === value) {
                return Encoder.TAG_UINT16;
            } else {
                return Encoder.TAG_UINT32;
            }
        } 

        if (value === (value | 0)) {
            // Signed integer 32-bit
            if (-128 <= value && value <= 127) {
                return Encoder.TAG_INT8;
            } else if (-32768 <= value && value <= 32767) {
                return Encoder.TAG_INT16;
            } else {
                return Encoder.TAG_INT32;
            }
        }
        
        return Encoder.TAG_NUMBER;
    }
    
    function getValueTag(obj) {
        if (obj === undefined) {
            return Encoder.TAG_UNDEFINED;
        } else if (obj === null) {
            return Encoder.TAG_NULL;
        } else if (obj instanceof Array) {
            return Encoder.TAG_ARRAY;
        } else if (obj instanceof Date) {
            return Encoder.TAG_DATE;
        } else if (obj instanceof Uint8Array) {
            return Encoder.TAG_UINT8ARRAY;
        } else if (typeof obj === "object") {
            return Encoder.TAG_OBJECT;
        } else if (typeof obj === "number") {
            return getNumberTag(obj);
        } else if (typeof obj === "string") {
            return Encoder.TAG_STRING_REF;
        } else if (typeof obj === "boolean") {
            return (obj ? Encoder.TAG_BOOLEAN_TRUE : Encoder.TAG_BOOLEAN_FALSE);
        } else {
            throw new Error("Unsupported type (as of yet)")
        }
    }
    
    /**
     * Serialize a positive counter value (e.g. size,  number of items)
     */
    Encoder.prototype.serializeCount = function(value) {
        if ((value >>> 0) !== value) {
            // Shall be an unsiged integer
            throw new Error("Invalid count value " + value);
        }
        
        // Write varint (bit 8 of all bytes is 'continue' flag)
        var b;
        while (value >= 0x80) {
            b = (value & 0x7F) | 0x80;
            this.ds.writeUint8(b);
            value >>>= 7;
        }
        this.ds.writeUint8(value);
    }
    
    Encoder.prototype.serializeNumber = function(value, tag) {      
        if (tag === Encoder.TAG_INT8) {
            this.ds.writeInt8(value)
        } else if (tag === Encoder.TAG_INT16) {
            this.ds.writeInt16(value)
        } else if (tag === Encoder.TAG_INT32) {
            this.ds.writeInt32(value)
        } else if (tag === Encoder.TAG_UINT8) {
            this.ds.writeUint8(value)
        } else if (tag === Encoder.TAG_UINT16) {
            this.ds.writeUint16(value)        
        } else if (tag === Encoder.TAG_UINT32) {
            this.ds.writeUint32(value)
        } else {
            this.ds.writeFloat64(value);        
        }
    }
    
    Encoder.prototype.serializeString = function(string) {
        var index;
        if (string === "") {
            index = 0;
        } else {
            index = this.string_refs.get(string);
            if (index === undefined) {
                index = this.string_refs.size + 1;
                this.string_refs.set(string, index);
            }
       }
       
       this.serializeCount(index);
    };
    
    Encoder.prototype.serializeDate = function(date) {
         this.ds.writeFloat64(date);
    }
    
    Encoder.prototype.serializeObject = function(obj) {
        var refindex = this.object_refs.get(obj);
        
        if (refindex === undefined) { 
            // Object by value
            
            // Keep reference index for cyclic references or mere object copy
            this.object_refs.set(obj, this.ds.position);
            
            this.ds.writeUint8(Encoder.TAG_OBJECT);
            
            // If object has a toJSON method, honor it
            if ((obj.toJSON !== undefined) && (typeof obj.toJSON === "function")) {
                obj = obj.toJSON();
            }

            // Serialize number of properties
            var keys = Object.keys(obj).filter(function(k) { return (typeof this[k] !== "function"); }, obj);
            this.serializeCount(keys.length);
            
            // Serialize each property
            var i, k, index;
            for (i = 0; i < keys.length; i += 1) {
                k = keys[i];
                index = this.string_keys.get(k);
                if (index === undefined) {
                    // Name not yet know, register it in reference map
                    index = this.string_keys.size;
                    this.string_keys.set(k, index);
                }
                
                this.serializeCount(index);
                this.serializeComponent(obj[k]);
            };
        } else {
            // Object by reference
            this.ds.writeUint8(Encoder.TAG_OBJECT_REF);
            this.serializeCount(refindex);
            this.hasCycle = true;
        }
    }
    
    Encoder.prototype.serializeArray = function(array) {
        var refindex = this.object_refs.get(array);
        
        if (refindex === undefined) {
            // Array by value

            // Keep reference index for cyclic references or mere object copy
            this.object_refs.set(array, this.ds.position);
            
            this.ds.writeUint8(Encoder.TAG_ARRAY);
            this.serializeCount(array.length);
                            
            for (let i = 0; i < array.length; i += 1) {
                this.serializeComponent(array[i]);
            }
        } else {
            // Array by reference
            this.ds.writeUint8(Encoder.TAG_OBJECT_REF);
            this.serializeCount(refindex);
            this.hasCycle = true;
        }
    }
    
    Encoder.prototype.serializeComponentPart = function(obj, tag) {    
        switch (tag) {
            case Encoder.TAG_NUMBER:
            case Encoder.TAG_INT8:
            case Encoder.TAG_INT16:
            case Encoder.TAG_INT32:
            case Encoder.TAG_UINT8:
            case Encoder.TAG_UINT16:
            case Encoder.TAG_UINT32:
                this.serializeNumber(obj, tag);
                break;

            case Encoder.TAG_STRING_REF:
                this.serializeString(obj);      
                break;
            
            case Encoder.TAG_DATE:
                this.serializeDate(obj);
                break;

            case Encoder.TAG_UINT8ARRAY:
                this.serializeCount(obj.length);
                this.ds.writeUint8Array(obj);
            
            case Encoder.TAG_BOOLEAN_TRUE:
            case Encoder.TAG_BOOLEAN_FALSE:
            case Encoder.TAG_NULL:
            case Encoder.TAG_UNDEFINED:
                // DO NOTHING
                break;
            default:
                throw new Error("Unexpected tag for component part " + tag);
        }
    }
    
    Encoder.prototype.serializeComponent = function(obj) {
        var tag = getValueTag(obj);
        
        if (tag == Encoder.TAG_OBJECT) {
            this.serializeObject(obj);
        } else if (tag == Encoder.TAG_ARRAY) {
            this.serializeArray(obj);
        } else {
            this.ds.writeUint8(tag);        
            this.serializeComponentPart(obj, tag);
        }
    }

    Encoder.prototype.serializeTOS = function (options) {
        var next_ds = this.ds;
        
        this.ds = new DataStream();
        this.ds.endianness = DataStream.BIG_ENDIAN;
        
        var v = MAJOR_VERSION;
        if (!this.hasCycle) {
            v |= Encoder.OPTION_NOCYCLE;
        }
        
        // Checksum and options
        if (options && options.hasCRC) {
            var crc = crc32(new Uint8Array(next_ds.buffer));
            this.ds.writeUint8(v | Encoder.OPTION_CRC32 );
            this.ds.writeUint32(crc);
        } else {
            this.ds.writeUint8(v);
        }

        // Key references
        this.serializeCount(this.string_keys.size);
        this.string_keys.forEach(function(value, key, map) {
            this.ds.writeCString(encode_utf8(key));
        }, this);
        
        // String references
        this.serializeCount(this.string_refs.size);
        this.string_refs.forEach(function(value, key, map) {
            this.ds.writeCString(encode_utf8(key));
        }, this);
        
        // All table of strings are prepended to the data
        var dst = new ArrayBuffer(next_ds.position + this.ds.position);
        DataStream.memcpy(dst, 0, this.ds.buffer, 0, this.ds.position);
        DataStream.memcpy(dst, this.ds.position, next_ds.buffer, 0, next_ds.position);
        this.ds.buffer = dst;
    };

    Encoder.prototype.encode = function(obj, options) {
        if (options && options.hasExperimental) {
            this.hasExperimental = true;
        }
        this.serializeComponent(obj);
        this.serializeTOS(options);
        
        return new Uint8Array(this.ds.buffer);
    }

    /**
     * Decoder.
     *
     * @constructor
     */
    var Decoder = function (arrayBuffer) {
        this.ds = new DataStream(arrayBuffer, 0, DataStream.BIG_ENDIAN);
        this.object_refs = new Map(); // Object references
        this.string_keys = new Map(); // Array for key references
        this.string_refs = new Map(); // Array for all other string references
        this.hasCycle = true; // Circular references exist: we don't know yet, so assume true by default
    };
    
    Decoder.prototype.unserializeCount = function() {
        // Read varint (bit 8 of all bytes is 'continue' flag)
        var c = 0, value = 0 >>> 0, b;
        do {
            b = this.ds.readUint8();
            value |= (b & 0x7F) << 7 * c;
            c += 1;
        } while ((b & 0x80) !== 0);
        
        return value;
    };

    Decoder.prototype.unserializeString = function() {
        var string;
        
        var index = this.unserializeCount();
        if (index === 0) {
            string = "";
        } else {
            if (index > this.string_refs.size) {
                throw new Error("Out of bound string reference " + index);
            }
            
            string = this.string_refs.get(index - 1);
        }
        
        return string;
    };
    
    Decoder.prototype.unserializeDate = function() {
        return new Date(this.ds.readFloat64());
    };

    Decoder.prototype.unserializeObject = function() {
        var obj = {};

        if (this.hasCycle) {
            this.object_refs.set(this.ds.position - 1, obj);
        }
        
        var size = this.unserializeCount();
        
        var i, index, key;
        var max = this.string_keys.size;
        while (size > 0) {
            index = this.unserializeCount();
            
            if (index >= max) {
                throw new Error("Out of bound property reference " + index);
            }
            
            key = this.string_keys.get(index);
            obj[key] = this.unserializeComponent();
            size -= 1;
        };
        
        return obj;
    };

    Decoder.prototype.unserializeArray = function() {
        var arr = [];
   
        if (this.hasCycle) {
            this.object_refs.set(this.ds.position - 1, arr);
        }
        
        var size = this.unserializeCount();
        
        var i = 0, elem;
        while (i < size) {
            elem = this.unserializeComponent();
            arr[i] = elem;
            i += 1;
        }
        
        return arr;
    };
    
    Decoder.prototype.unserializeComponentPart = function (tag) {
        var size, refindex;
        
        switch (tag) {
            case Encoder.TAG_NUMBER:
                return this.ds.readFloat64();
            case Encoder.TAG_INT8:
                return this.ds.readInt8();
            case Encoder.TAG_INT16:
                return this.ds.readInt16();
            case Encoder.TAG_INT32:
                return this.ds.readInt32();
            case Encoder.TAG_UINT8:
                return this.ds.readUint8();
            case Encoder.TAG_UINT16:
                return this.ds.readUint16();
            case Encoder.TAG_UINT32:
                return this.ds.readUint32();

            case Encoder.TAG_STRING_REF:
                return this.unserializeString();

            case Encoder.TAG_DATE:
                return this.unserializeDate();

            case Encoder.TAG_UINT8ARRAY:
                size = this.unserializeCount();
                return this.ds.readUint8Array(size);                

            case Encoder.TAG_BOOLEAN_TRUE:
                return true;
            case Encoder.TAG_BOOLEAN_FALSE:
                return false;
            case Encoder.TAG_NULL:
                return null;
            case Encoder.TAG_UNDEFINED:
                return; // Keep undefined              

            case Encoder.TAG_OBJECT:
                return this.unserializeObject();
            case Encoder.TAG_ARRAY:
                return this.unserializeArray();
            case Encoder.TAG_OBJECT_REF:
                refindex = this.object_refs.get(this.unserializeCount() + this.offset);
                if (refindex !== undefined) {
                    return refindex;
                } 
                throw new Error("Invalid object reference " + refindex);

            default:
                throw new Error("Unexpected tag " + tag);
        }
    };
    
    Decoder.prototype.unserializeComponent = function () {
        var value, size, refindex;
        
        var tag = this.ds.readUint8();
        return this.unserializeComponentPart(tag);
    };

    Decoder.prototype.unserializeTOS = function () {
        var size, i, s;
        
        var crc, version = this.ds.readUint8();
        if ((version & 0x0F) > MAJOR_VERSION) {
            throw new Error("Major version mistmatch");
        }
        
        if (version & Encoder.OPTION_CRC32) {
            crc = this.ds.readUint32();
        }
        
        if (version & Encoder.OPTION_NOCYCLE) {
            this.hasCycle = false;
        }
        
        // Key references
        size = this.unserializeCount();
        for (i = 0; i < size; i += 1) {
            s = decode_utf8(this.ds.readCString());
            this.string_keys.set(i, s);
        }
        
        // Key references
        size = this.unserializeCount();
        for (i = 0; i < size; i += 1) {
            s = decode_utf8(this.ds.readCString());
            this.string_refs.set(i, s);
        }
        
        if (version & Encoder.OPTION_CRC32) {
            var offset = this.ds.position;
            var raw = this.ds.readUint8Array();
            var new_crc = crc32(raw);
            if (new_crc !== crc) {
                throw new Error("CRC32 checksum mistmach");
            }
            // Reset position in buffer
            this.ds.position = offset;
        }
    };

    Decoder.prototype.decode = function () {
        this.unserializeTOS();
        this.offset = this.ds.position;
        return this.unserializeComponent(); 
    };
    
    return {
        encode: function(obj, options) {
            var s = new Encoder();
            return s.encode(obj, options);
        },
        decode: function(binary) {
            if (binary === undefined || binary === null || (!(binary instanceof ArrayBuffer || binary.buffer instanceof ArrayBuffer))) {
                // Has to be non-null, and and instance of array buffer or one of the binary arrays
                throw new Error("Invalid data");
            }
            var u = new Decoder(binary);
            return u.decode();
        },
        // Exported for those who may want to extend the objects.
        Encoder: Encoder,
        Decoder: Decoder,
    };
}));

//EOF