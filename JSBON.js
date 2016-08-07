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
     * Serializer.
     *
     * @constructor
     */
    var Serializer = function () {
        this.ds = new DataStream();
        this.ds.endianness = DataStream.BIG_ENDIAN;
        this.object_refs = new Map(); // Object map for object references
        this.string_keys = new Map(); // Map for key references (i.e. property names)
        this.string_refs = new Map(); // Map for all other string references
        this.hasCycle = false; // Circular references exist: we don't know yet, so assume false until met.
    };

    // - Data type tags
    Serializer.TAG_BOOLEAN_FALSE  = 0x00;
    Serializer.TAG_BOOLEAN_TRUE   = 0x01;
    
    Serializer.TAG_INT8           = 0x02;
    Serializer.TAG_INT16          = 0x03;
    Serializer.TAG_INT32          = 0x04;
    
    Serializer.TAG_NULL           = 0x05;
    Serializer.TAG_UNDEFINED      = 0x06;
    
    Serializer.TAG_OBJECT_REF     = 0x07;
    /* 0x08 RESERVED */
    /* May be use if tables of strings are leveraged */
    
    Serializer.TAG_NUMBER         = 0x09;
    
    Serializer.TAG_UINT8          = 0x12;
    Serializer.TAG_UINT16         = 0x13;
    Serializer.TAG_UINT32         = 0x14;
    
    Serializer.TAG_STRING_REF     = 0x16;
    
    Serializer.TAG_DATE           = 0x20;
    
    Serializer.TAG_OBJECT         = 0x30;
    Serializer.TAG_ARRAY          = 0x31;
    Serializer.TAG_UINT8ARRAY     = 0x32;
    /* 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39 RESERVED */
    /* May be used if other binary arrays are implemented */
    
    Serializer.TAG_ARRAY_OF       = 0x71; // EXPERIMENTAL
        
    // - Option flags
    Serializer.OPTION_CRC32       = 0x80;
    Serializer.OPTION_NOCYCLE     = 0x40;

    function getNumberTag(value) {
        if (value === (value >>> 0)) {
            // Unsigned integer 32-bit
            if ((value & 0xFF) === value) {
                return Serializer.TAG_UINT8;
            } else if ((value & 0xFFFF) === value) {
                return Serializer.TAG_UINT16;
            } else {
                return Serializer.TAG_UINT32;
            }
        } 

        if (value === (value | 0)) {
            // Signed integer 32-bit
            if (-128 <= value && value <= 127) {
                return Serializer.TAG_INT8;
            } else if (-32768 <= value && value <= 32767) {
                return Serializer.TAG_INT16;
            } else {
                return Serializer.TAG_INT32;
            }
        }
        
        return Serializer.TAG_NUMBER;
    }
    
    /**
     * Serialize a positive counter value (e.g. size,  number of items)
     * 
     */
    Serializer.prototype.serializeCount = function(value) {
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
    
    Serializer.prototype.serializeNumber = function(value, tag) {      
        if (tag === Serializer.TAG_INT8) {
            this.ds.writeInt8(value)
        } else if (tag === Serializer.TAG_INT16) {
            this.ds.writeInt16(value)
        } else if (tag === Serializer.TAG_INT32) {
            this.ds.writeInt32(value)
        } else if (tag === Serializer.TAG_UINT8) {
            this.ds.writeUint8(value)
        } else if (tag === Serializer.TAG_UINT16) {
            this.ds.writeUint16(value)        
        } else if (tag === Serializer.TAG_UINT32) {
            this.ds.writeUint32(value)
        } else {
            this.ds.writeFloat64(value);        
        }
    }
    
    Serializer.prototype.serializeString = function(string) {
        this.ds.writeUint8(Serializer.TAG_STRING_REF);

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
    
    Serializer.prototype.serializeDate = function(date) {
         this.ds.writeUint8(Serializer.TAG_DATE);
         this.ds.writeFloat64(date);
    }
    
    Serializer.prototype.serializeObject = function(obj) {
        var refindex = this.object_refs.get(obj);
        
        if (refindex === undefined) { 
            // Object by value
            this.ds.writeUint8(Serializer.TAG_OBJECT);
            
            // Keep reference index for cyclic references or mere object copy
            this.object_refs.set(obj, this.ds.position);

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
            this.ds.writeUint8(Serializer.TAG_OBJECT_REF);
            this.serializeCount(refindex);
            this.hasCycle = true;
        }
    }

    Serializer.prototype.serializeArray = function(array) {
        var refindex = this.object_refs.get(array);
        
        if (refindex === undefined) {
            // Array by value
            
            var canOptimize = false, tag;
            if (this.hasExperimental && (array.length > 0) && (typeof array[0] === "number")) {
                tag = getNumberTag(array[0]);
                canOptimize = true;
                for (let i = 1; i < array.length; i += 1) {
                    if (tag !== getNumberTag(array[i])) {
                        canOptimize = false;
                        break;
                    }
                }
            }
            
            if (!canOptimize) {
                this.ds.writeUint8(Serializer.TAG_ARRAY);
                
                // Keep reference index for cyclic references or mere object copy
                this.object_refs.set(array, this.ds.position);
                
                this.serializeCount(array.length);
                                
                for (let i = 0; i < array.length; i += 1) {
                    this.serializeComponent(array[i]);
                }
            } else {
                // EXPERIMENTAL - Array of same number types
                this.ds.writeUint8(Serializer.TAG_ARRAY_OF);
                
                // Keep reference index for cyclic references or mere object copy
                this.object_refs.set(array, this.ds.position);
                
                this.serializeCount(array.length);
                this.ds.writeUint8(tag);
                
                for (let i = 0; i < array.length; i += 1) {
                    this.serializeNumber(array[i], tag);
                }
            }
        } else {
            // Array by reference
            this.ds.writeUint8(Serializer.TAG_OBJECT_REF);
            this.serializeCount(refindex);
            this.hasCycle = true;
        }
    }
    
    Serializer.prototype.serializeComponent = function(obj) {
        if (obj === undefined) {
           this.ds.writeUint8(Serializer.TAG_UNDEFINED);
        } else if (obj === null) {
           this.ds.writeUint8(Serializer.TAG_NULL);
        } else if (obj instanceof Array) {
            this.serializeArray(obj);
        } else if (obj instanceof Date) {
            this.serializeDate(obj);
        } else if (obj instanceof Uint8Array) {
            this.ds.writeUint8(Serializer.TAG_UINT8ARRAY);
            this.serializeCount(obj.length);
            this.ds.writeUint8Array(obj);
        } else if (typeof obj === "object") {
            this.serializeObject(obj);
        } else if (typeof obj === "number") {
            var tag = getNumberTag(obj);
            this.ds.writeUint8(tag);
            this.serializeNumber(obj, tag);
        } else if (typeof obj === "string") {
            this.serializeString(obj);      
        } else if (typeof obj === "boolean") {
            this.ds.writeUint8(obj ? Serializer.TAG_BOOLEAN_TRUE : Serializer.TAG_BOOLEAN_FALSE);
        } else {
            throw new Error("Unsupported type (as of yet)")
        }
    }

    Serializer.prototype.serializeTOS = function (options) {
        var next_ds = this.ds;
        
        this.ds = new DataStream();
        this.ds.endianness = DataStream.BIG_ENDIAN;
        
        var v = MAJOR_VERSION;
        if (!this.hasCycle) {
            v |= Serializer.OPTION_NOCYCLE;
        }
        
        // Checksum and options
        if (options && options.hasCRC) {
            var crc = crc32(new Uint8Array(next_ds.buffer));
            this.ds.writeUint8(v | Serializer.OPTION_CRC32 );
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

    Serializer.prototype.encode = function(obj, options) {
        if (options && options.hasExperimental) {
            this.hasExperimental = true;
        }
        this.serializeComponent(obj);
        this.serializeTOS(options);
        
        return new Uint8Array(this.ds.buffer);
    }

    /**
     * Unserializer.
     *
     * @constructor
     */
    var Unserializer = function (arrayBuffer) {
        this.ds = new DataStream(arrayBuffer, 0, DataStream.BIG_ENDIAN);
        this.object_refs = new Map(); // Object references
        this.string_keys = new Map(); // Array for key references
        this.string_refs = new Map(); // Array for all other string references
        this.hasCycle = true; // Circular references exist: we don't know yet, so assume true by default
    };
    
    Unserializer.prototype.unserializeCount = function() {
        // Read varint (bit 8 of all bytes is 'continue' flag)
        var c = 0, value = 0 >>> 0, b;
        do {
            b = this.ds.readUint8();
            value |= (b & 0x7F) << 7 * c;
            c += 1;
        } while ((b & 0x80) !== 0);
        
        return value;
    };

    Unserializer.prototype.unserializeString = function() {
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
    
    Unserializer.prototype.unserializeDate = function() {
        return new Date(this.ds.readFloat64());
    };

    Unserializer.prototype.unserializeObject = function() {
        var obj = {};

        if (this.hasCycle) {
            this.object_refs.set(this.ds.position, obj);
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

    Unserializer.prototype.unserializeArray = function() {
        var arr = [];
   
        if (this.hasCycle) {
            this.object_refs.set(this.ds.position, arr);
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
    
    Unserializer.prototype.unserializeArrayOf = function() {
        var arr = [];
   
        if (this.hasCycle) {
            this.object_refs.set(this.ds.position, arr);
        }
        
        var size = this.unserializeCount();
        var tag = this.ds.readUint8();

        var i = 0, elem;
        while (i < size) {
            switch (tag) {
                case Serializer.TAG_NUMBER:
                    elem = this.ds.readFloat64(tag);
                    break;
                case Serializer.TAG_INT8:
                    elem = this.ds.readInt8(tag);
                    break;
                case Serializer.TAG_INT16:
                    elem = this.ds.readInt16(tag);
                    break;
                case Serializer.TAG_INT32:
                    elem = this.ds.readInt32(tag);
                    break;
                case Serializer.TAG_UINT8:
                    elem = this.ds.readUint8(tag);
                    break;
                case Serializer.TAG_UINT16:
                    elem = this.ds.readUint16(tag);
                    break;
                case Serializer.TAG_UINT32:
                    elem = this.ds.readUint32(tag);
                    break;
                default:
                    throw new Error("Unexpected tag in ArrayOf " + tag);
            }
            arr[i] = elem;
            i += 1;
        }
        
        return arr;
    };
    
    Unserializer.prototype.unserializeComponent = function () {
        var value, size, refindex;
        
        var tag = this.ds.readUint8();
        switch (tag) {
            case Serializer.TAG_NUMBER:
                return this.ds.readFloat64();
            case Serializer.TAG_INT8:
                return this.ds.readInt8();
            case Serializer.TAG_INT16:
                return this.ds.readInt16();
            case Serializer.TAG_INT32:
                return this.ds.readInt32();
            case Serializer.TAG_UINT8:
                return this.ds.readUint8();
            case Serializer.TAG_UINT16:
                return this.ds.readUint16();
            case Serializer.TAG_UINT32:
                return this.ds.readUint32();
            case Serializer.TAG_OBJECT:
                return this.unserializeObject();
            case Serializer.TAG_ARRAY:
                return this.unserializeArray();
            case Serializer.TAG_ARRAY_OF:
                return this.unserializeArrayOf();
            case Serializer.TAG_STRING_REF:
                return this.unserializeString();
            case Serializer.TAG_DATE:
                return this.unserializeDate();
            case Serializer.TAG_BOOLEAN_TRUE:
                return true;
            case Serializer.TAG_BOOLEAN_FALSE:
                return false;
            case Serializer.TAG_NULL:
                return null;
            case Serializer.TAG_UNDEFINED:
                return; // Keep undefined              
            case Serializer.TAG_UINT8ARRAY:
                size = this.unserializeCount();
                return this.ds.readUint8Array(size);
            case Serializer.TAG_OBJECT_REF:
                refindex = this.object_refs.get(this.unserializeCount() + this.offset);
                if (refindex !== undefined) {
                    return refindex;
                } 
                throw new Error("Invalid object reference " + refindex);
            default:
                throw new Error("Unexpected tag " + tag);
        }
    };

    Unserializer.prototype.unserializeTOS = function () {
        var size, i, s;
        
        var crc, version = this.ds.readUint8();
        if ((version & 0x0F) > MAJOR_VERSION) {
            throw new Error("Major version mistmatch");
        }
        
        if (version & Serializer.OPTION_CRC32) {
            crc = this.ds.readUint32();
        }
        
        if (version & Serializer.OPTION_NOCYCLE) {
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
        
        if (version & Serializer.OPTION_CRC32) {
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

    Unserializer.prototype.decode = function () {
        this.unserializeTOS();
        this.offset = this.ds.position;
        return this.unserializeComponent(); 
    };
    
    return {
        encode: function(obj, options) {
            var s = new Serializer();
            return s.encode(obj, options);
        },
        decode: function(binary) {
            if (binary === undefined || binary === null || (!(binary instanceof ArrayBuffer || binary.buffer instanceof ArrayBuffer))) {
                // Has to be non-null, and and instance of array buffer or one of the binary arrays
                throw new Error("Invalid data");
            }
            var u = new Unserializer(binary);
            return u.decode();
        },
        // Exported for those who may want to extend the objects.
        Serializer: Serializer,
        Unserializer: Unserializer,
    };
}));

//EOF