;/*jslint browser, bitwise*/
/*global window, Hyphenopoly, TextDecoder, WebAssembly, asmHyphenEngine*/
(function mainWrapper(w) {
    "use strict";
    const H = Hyphenopoly;
    const SOFTHYPHEN = String.fromCharCode(173);

    function empty() {
        return Object.create(null);
    }

    function makeTimeStamp(label) {
        if (window.console.timeStamp) {
            window.console.timeStamp(label);
        }
    }
    function setProp(val, props) {
        /* props is a bit pattern:
         * 1. bit: configurable
         * 2. bit: enumerable
         * 3. bit writable
         * e.g. 011(2) = 3(10) => configurable: false, enumerable: true, writable: true
         */
        return {
            configurable: (props & 4) > 0,
            enumerable: (props & 2) > 0,
            writable: (props & 1) > 0,
            value: val
        };
    }

    (function configurationFactory() {
        const generalDefaults = Object.create(null, {
            timeout: setProp(3000, 2),
            defaultLanguage: setProp("en", 2),
            dontHyphenateClass: setProp("donthyphenate", 2),
            dontHyphenate: setProp((function () {
                const r = empty();
                const list = "video,audio,script,code,pre,img,br,samp,kbd,var,abbr,acronym,sub,sup,button,option,label,textarea,input,math,svg,style";
                list.split(",").forEach(function (value) {
                    r[value] = true;
                });
                return r;
            }()), 2),
            safeCopy: setProp(true, 2),
            normalize: setProp(false, 2),
            onHyphenopolyStart: setProp(function () {
                makeTimeStamp("Hyphenopoly start!");
            }, 2),
            onHyphenationDone: setProp(function () {
                makeTimeStamp("Hyphenation done!");
            }, 2),
            onHyphenationFailed: setProp(function (e) {
                window.console.error("Hyphenopoly.js error", e);
            }, 2)
        });

        const settings = Object.create(generalDefaults);

        const perClassDefaults = Object.create(null, {
            minWordLength: setProp(6, 2),
            leftmin: setProp(0, 2),
            leftminPerLang: setProp(0, 2),
            rightmin: setProp(0, 2),
            rightminPerLang: setProp(0, 2),
            hyphen: setProp(SOFTHYPHEN, 2), //soft hyphen
            orphanControl: setProp(1, 2),
            compound: setProp("hyphen", 2),
            onBeforeWordHyphenation: setProp(function (word) {
                return word;
            }, 2),
            onAfterWordHyphenation: setProp(function (word) {
                return word;
            }, 2),
            onBeforeElementHyphenation: setProp(function (element, lang) {
                return {"element": element, "lang": lang};
            }, 2),
            onAfterElementHyphenation: setProp(function (element, lang) {
                return {"element": element, "lang": lang};
            }, 2)
        });

        //copy settings if not yet set
        Object.keys(H.setup).forEach(function (key) {
            if (key === "classnames") {
                const classNames = Object.keys(H.setup.classnames);
                Object.defineProperty(settings, "classNames", setProp(classNames, 2));
                classNames.forEach(function (cn) {
                    const tmp = {};
                    Object.keys(H.setup.classnames[cn]).forEach(function (pcnkey) {
                        tmp[pcnkey] = setProp(H.setup.classnames[cn][pcnkey], 2);
                    });
                    Object.defineProperty(settings, cn, setProp(Object.create(perClassDefaults, tmp), 2));
                });
            } else {
                Object.defineProperty(settings, key, setProp(H.setup[key], 3));
            }
        });

        H.c = settings;

    }());

    (function H9Y(w) {
        const C = H.c;

        let mainLanguage = null;

        const elements = (function () {

            function makeElement(element, cn) {
                return {
                    element: element,
                    hyphenated: false,
                    treated: false,
                    class: cn
                };
            }

            function makeElementCollection() {
                // array of [number of collected elements, number of hyphenated elements]
                const counters = [0, 0];

                const list = empty();

                function add(el, lang, cn) {
                    const elo = makeElement(el, cn);
                    if (list[lang] === undefined) {
                        list[lang] = [];
                    }
                    list[lang].push(elo);
                    counters[0] += 1;
                    return elo;
                }

                function each(fn) {
                    Object.keys(list).forEach(function (k) {
                        if (fn.length === 2) {
                            fn(k, list[k]);
                        } else {
                            fn(list[k]);
                        }
                    });
                }

                return {
                    counters: counters,
                    list: list,
                    add: add,
                    each: each
                };
            }
            return makeElementCollection();
        }());

        const registerOnCopy = function (el) {
            el.addEventListener("copy", function (e) {
                e.preventDefault();
                const selectedText = window.getSelection().toString();
                e.clipboardData.setData("text/plain", selectedText.replace(new RegExp(SOFTHYPHEN, "g"), ""));
            }, true);
        };

        const exceptions = empty();

        function getLang(el, fallback) {
            try {
                return (el.getAttribute("lang"))
                    ? el.getAttribute("lang").toLowerCase()
                    : el.tagName.toLowerCase() !== "html"
                        ? getLang(el.parentNode, fallback)
                        : fallback
                            ? mainLanguage
                            : null;
            } catch (ignore) {}
        }

        function autoSetMainLanguage() {
            const el = w.document.getElementsByTagName("html")[0];

            mainLanguage = getLang(el, false);
            //fallback to defaultLang if set
            if (!mainLanguage && C.defaultLanguage !== "") {
                mainLanguage = C.defaultLanguage;
            }
            //el.lang = mainLanguage; //this trigger recalculate style! is it really necessary?
        }

        function sortOutSubclasses(x, y) {
            return (x[0] === "")
                ? []
                : x.filter(function (i) {
                    return y.indexOf(i) !== -1;
                });
        }

        function collectElements() {
            function processText(el, pLang, cn, isChild) {
                let eLang;
                let n;
                let j = 0;
                isChild = isChild || false;
                //set eLang to the lang of the element
                if (el.lang && typeof el.lang === "string") {
                    eLang = el.lang.toLowerCase(); //copy attribute-lang to internal eLang
                } else if (pLang !== undefined && pLang !== "") {
                    eLang = pLang.toLowerCase();
                } else {
                    eLang = getLang(el, true);
                }
                if (H.testResults.languages[eLang] === "H9Y") {
                    elements.add(el, eLang, cn);
                    if (!isChild && C.safeCopy) {
                        registerOnCopy(el);
                    }
                }

                n = el.childNodes[j];
                while (n !== undefined) {
                    if (n.nodeType === 1 && !C.dontHyphenate[n.nodeName.toLowerCase()] && n.className.indexOf(C.dontHyphenateClass) === -1) {
                        //console.log(sortOutSubclasses(n.className.split(" "), C.classNames));
                        if (sortOutSubclasses(n.className.split(" "), C.classNames).length === 0) {
                            //this child element doesn't contain a hyphenopoly-class
                            processText(n, eLang, cn, true);
                        }
                    }
                    j += 1;
                    n = el.childNodes[j];
                }
            }
            C.classNames.forEach(function (cn) {
                const nl = w.document.querySelectorAll("." + cn);
                Array.prototype.forEach.call(nl, function (n) {
                    processText(n, getLang(n, true), cn, false);
                });
            });
            H.elementsReady = true;
        }

        const wordHyphenatorPool = empty();

        function createWordHyphenator(lo, lang, cn) {
            const classSettings = C[cn];
            const cache = empty();
            const normalize = C.normalize && (String.prototype.normalize !== undefined);
            const hyphen = classSettings.hyphen;

            function hyphenateCompound(lo, lang, word) {
                const zeroWidthSpace = String.fromCharCode(8203);
                let parts;
                let i = 0;
                let wordHyphenator;
                let hw = word;
                switch (classSettings.compound) {
                case "auto":
                    parts = word.split("-");
                    wordHyphenator = createWordHyphenator(lo, lang, cn);
                    while (i < parts.length) {
                        if (parts[i].length >= classSettings.minWordLength) {
                            parts[i] = wordHyphenator(parts[i]);
                        }
                        i += 1;
                    }
                    hw = parts.join("-");
                    break;
                case "all":
                    parts = word.split("-");
                    wordHyphenator = createWordHyphenator(lo, lang, cn);
                    while (i < parts.length) {
                        if (parts[i].length >= classSettings.minWordLength) {
                            parts[i] = wordHyphenator(parts[i]);
                        }
                        i += 1;
                    }
                    hw = parts.join("-" + zeroWidthSpace);
                    break;
                default: //"hyphen" and others
                    hw = word.replace("-", "-" + zeroWidthSpace);
                }
                return hw;
            }

            function hyphenator(word) {
                word = classSettings.onBeforeWordHyphenation(word, lang);
                if (normalize) {
                    word = word.normalize("NFC");
                }
                let hw = cache[word] || undefined;
                if (!hw) {
                    if (lo.exceptions[word] !== undefined) { //the word is in the exceptions list
                        hw = lo.exceptions[word].replace(/-/g, classSettings.hyphen);
                    } else if (word.indexOf("-") !== -1) {
                        hw = hyphenateCompound(lo, lang, word);
                    } else {
                        hw = lo.hyphenateFunction(word, hyphen, classSettings.leftminPerLang[lang], classSettings.rightminPerLang[lang]);
                    }
                }
                hw = classSettings.onAfterWordHyphenation(hw, lang);
                cache[word] = hw;
                return hw;
            }
            wordHyphenatorPool[lang + "-" + cn] = hyphenator;
            return hyphenator;
        }

        const orphanControllerPool = empty();

        function createOrphanController(cn) {
            function controlOrphans(ignore, leadingWhiteSpace, lastWord, trailingWhiteSpace) {
                const classSettings = C[cn];
                let h = classSettings.hyphen;
                //escape hyphen
                if (".\\+*?[^]$(){}=!<>|:-".indexOf(classSettings.hyphen) !== -1) {
                    h = "\\" + classSettings.hyphen;
                }
                if (classSettings.orphanControl === 3 && leadingWhiteSpace === " ") {
                    leadingWhiteSpace = String.fromCharCode(160);
                }
                return leadingWhiteSpace + lastWord.replace(new RegExp(h, "g"), "") + trailingWhiteSpace;
            }
            orphanControllerPool[cn] = controlOrphans;
            return controlOrphans;
        }

        function hyphenateElement(lang, elo) {
            const el = elo.element;
            const lo = H.languages[lang];
            const cn = elo.class;
            const classSettings = C[cn];
            const minWordLength = classSettings.minWordLength;
            classSettings.onBeforeElementHyphenation(el, lang);
            const wordHyphenator = (wordHyphenatorPool[lang + "-" + cn] !== undefined)
                ? wordHyphenatorPool[lang + "-" + cn]
                : createWordHyphenator(lo, lang, cn);
            const orphanController = (orphanControllerPool[cn] !== undefined)
                ? orphanControllerPool[cn]
                : createOrphanController(cn);
            const re = lo.genRegExps[cn];
            let i = 0;
            let n = el.childNodes[i];
            let tn;
            while (n) {
                if (
                    n.nodeType === 3 //type 3 = #text
                        && n.data.length >= minWordLength //longer then min
                ) {
                    tn = n.data.replace(re, wordHyphenator);
                    if (classSettings.orphanControl !== 1) {
                        //prevent last word from being hyphenated
                        tn = tn.replace(/(\u0020*)(\S+)(\s*)$/, orphanController);
                    }
                    n.data = tn;
                }
                i += 1;
                n = el.childNodes[i];
            }
            elo.hyphenated = true;
            elements.counters[1] += 1;
            classSettings.onAfterElementHyphenation(el, lang);
        }

        function hyphenateLangElements(lang, elArr) {
            elArr.forEach(function eachElem(elo) {
                hyphenateElement(lang, elo);
            });
            if (elements.counters[0] === elements.counters[1]) {
                handleEvt(["hyphenationDone"]);
            }

        }

        function convertExceptionsToObject(exc) {
            const words = exc.split(", ");
            const r = empty();
            const l = words.length;
            let i = 0;
            let key;
            while (i < l) {
                key = words[i].replace(/-/g, "");
                if (r[key] === undefined) {
                    r[key] = words[i];
                }
                i += 1;
            }
            return r;
        }

        function prepareLanguagesObj(lang, hyphenateFunction, alphabet, leftmin, rightmin) {
            if (!H.hasOwnProperty("languages")) {
                H.languages = {};
            }
            if (!H.languages.hasOwnProperty(lang)) {
                H.languages[lang] = empty();
            }
            const lo = H.languages[lang];
            if (!lo.engineReady) {
                lo.cache = empty();
                //copy global exceptions to the language specific exceptions
                if (exceptions.global !== undefined) {
                    if (exceptions.lang !== undefined) {
                        exceptions[lang] += ", " + exceptions.global;
                    } else {
                        exceptions[lang] = exceptions.global;
                    }
                }
                //move exceptions from the the local "exceptions"-obj to the "language"-object
                if (exceptions.lang !== undefined) {
                    lo.exceptions = convertExceptionsToObject(exceptions[lang]);
                    delete exceptions[lang];
                } else {
                    lo.exceptions = empty();
                }
                lo.genRegExps = empty();
                lo.leftmin = leftmin;
                lo.rightmin = rightmin;
                lo.hyphenateFunction = hyphenateFunction;
                C.classNames.forEach(function (cn) {
                    const classSettings = C[cn];
                    //merge leftmin/rightmin to config
                    if (classSettings.leftminPerLang === 0) {
                        Object.defineProperty(classSettings, "leftminPerLang", setProp(empty(), 2));
                    }
                    if (classSettings.rightminPerLang === 0) {
                        Object.defineProperty(classSettings, "rightminPerLang", setProp(empty(), 2));
                    }
                    if (classSettings.leftminPerLang[lang] === undefined) {
                        classSettings.leftminPerLang[lang] = Math.max(lo.leftmin, classSettings.leftmin);
                    } else {
                        classSettings.leftminPerLang[lang] = Math.max(lo.leftmin, classSettings.leftmin, classSettings.leftminPerLang[lang]);
                    }
                    if (classSettings.rightminPerLang[lang] === undefined) {
                        classSettings.rightminPerLang[lang] = Math.max(lo.rightmin, classSettings.rightmin);
                    } else {
                        classSettings.rightminPerLang[lang] = Math.max(lo.rightmin, classSettings.rightmin, classSettings.rightminPerLang[lang]);
                    }
                    lo.genRegExps[cn] = new RegExp("[\\w" + alphabet + String.fromCharCode(8204) + "-]{" + classSettings.minWordLength + ",}", "gi");
                });
                lo.engineReady = true;
            }
            H.evt(["engineReady", lang]);
        }

        function calculateHeapSize(targetSize) {
            if (H.isWASMsupported) {
                //wasm page size: 65536 = 64 Ki
                return Math.ceil(targetSize / 65536) * 65536;
            } else {
                //http://asmjs.org/spec/latest/#linking-0
                const exp = Math.ceil(Math.log2(targetSize));
                if (exp <= 12) {
                    return 1 << 12;
                }
                if (exp < 24) {
                    return 1 << exp;
                }
                return Math.ceil(targetSize / (1 << 24)) * (1 << 24);
            }
        }

        function decode(ui16) {
            if (window.TextDecoder !== undefined) {
                const utf16ledecoder = new TextDecoder("utf-16le");
                const characters = utf16ledecoder
                    .decode(ui16)
                    .replace(/-/g, "");
                return characters;
            } else {
                let i = 0;
                let str = "";
                while (i < ui16.length) {
                    str += String.fromCharCode(ui16[i]);
                    i += 1;
                }
                str = str.replace(/-/g, "");
                return str;
            }
        }

        function calculateBaseData(hpbBuf) {
            /* Build Heap (the heap object's byteLength must be either 2^n for n in [12, 24) or 2^24 · n for n ≥ 1;)
             * -------------------- <- Offset: 0           -
             * |     HEADER       |                        |
             * |    6*4 Bytes     |                        |
             * |    24 Bytes      |                        |
             * --------------------                        |
             * |    PATTERN LIC   |                        |
             * |  variable Length |                        |
             * --------------------                        |
             * | align to 4Bytes  |                        } this is the .hpb-file
             * -------------------- <- hpbTranslateOffset  |
             * |    TRANSLATE     |                        |
             * | 2 + [0] * 2Bytes |                        |
             * -------------------- <- hpbPatternsOffset   |
             * |     PATTERNS     |                        |
             * |  patternsLength  |                        |
             * --------------------                        |
             * | align to 4Bytes  |                        |
             * -------------------- <- charMapOffset       -
             * |     charMap      |
             * |     2 Bytes      |
             * |  * 65536 (BMP)   |
             * -------------------- <- valueStoreOffset
             * |    valueStore    |
             * |      1 Byte      |
             * |* valueStoreLength|
             * --------------------
             * | align to 4Bytes  |
             * -------------------- <- patternTrieOffset
             * |    patternTrie   |
             * |     4 Bytes      |
             * |*patternTrieLength|
             * -------------------- <- wordOffset
             * |    wordStore     |
             * |    Uint16[64]    | 128 bytes
             * -------------------- <- hyphenPointsOffset
             * |   hyphenPoints   |
             * |    Uint8[64]     |
             * -------------------- <- heapEnd
             * |  align heapSize  |
             * -------------------- <- heapSize
             */
            const hpbMetaData = new Uint32Array(hpbBuf).subarray(0, 8);
            const hpbTranslateOffset = hpbMetaData[1];
            const hpbPatternsOffset = hpbMetaData[2];
            const patternsLength = hpbMetaData[3];
            const charMapLength = 65536 << 1; //16bit
            const patternTrieLength = hpbMetaData[6] * 4;
            const valueStoreLength = hpbMetaData[7];
            const leftmin = hpbMetaData[4];
            const rightmin = hpbMetaData[5];
            const charMapOffset = hpbBuf.byteLength + (4 - (hpbBuf.byteLength % 4));
            const valueStoreOffset = charMapOffset + charMapLength;
            const patternTrieOffset = valueStoreOffset + valueStoreLength + (4 - ((valueStoreOffset + valueStoreLength) % 4));
            const wordOffset = patternTrieOffset + patternTrieLength;
            const hyphenPointsOffset = wordOffset + 128;
            const heapEnd = hyphenPointsOffset + 64;
            const heapSize = Math.max(calculateHeapSize(heapEnd), 32 * 1024 * 64);
            const characters = decode(new Uint16Array(hpbBuf).subarray((hpbTranslateOffset + 6) >> 1, hpbPatternsOffset >> 1));
            return {
                characters: characters,
                hpbTranslateOffset: hpbTranslateOffset,
                hpbPatternsOffset: hpbPatternsOffset,
                leftmin: leftmin,
                rightmin: rightmin,
                patternsLength: patternsLength,
                charMapOffset: charMapOffset,
                valueStoreOffset: valueStoreOffset,
                patternTrieOffset: patternTrieOffset,
                wordOffset: wordOffset,
                hyphenPointsOffset: hyphenPointsOffset,
                heapSize: heapSize
            };
        }

        function createImportObject(baseData) {
            return {
                hpbTranslateOffset: baseData.hpbTranslateOffset,
                hpbPatternsOffset: baseData.hpbPatternsOffset,
                patternsLength: baseData.patternsLength,
                charMapOffset: baseData.charMapOffset,
                valueStoreOffset: baseData.valueStoreOffset,
                patternTrieOffset: baseData.patternTrieOffset,
                wordOffset: baseData.wordOffset,
                hyphenPointsOffset: baseData.hyphenPointsOffset
            };
        }

        function encloseHyphenateFunction(baseData, hyphenateFunc) {
            const heapBuffer = H.isWASMsupported
                ? baseData.wasmMemory.buffer
                : baseData.heapBuffer;
            const wordOffset = baseData.wordOffset;
            const hyphenPointsOffset = baseData.hyphenPointsOffset;
            const wordStore = (new Uint16Array(heapBuffer)).subarray(wordOffset >> 1, (wordOffset >> 1) + 64);
            const hyphenPointsStore = (new Uint8Array(heapBuffer)).subarray(hyphenPointsOffset, hyphenPointsOffset + 64);
            const defLeftmin = baseData.leftmin;
            const defRightmin = baseData.rightmin;

            return function hyphenate(word, hyphenchar, leftmin, rightmin) {
                let i = 0;
                const wordLength = word.length;
                leftmin = leftmin || defLeftmin;
                rightmin = rightmin || defRightmin;
                wordStore[0] = wordLength + 2;
                wordStore[1] = 95;
                while (i < wordLength) {
                    wordStore[i + 2] = word.charCodeAt(i);
                    i += 1;
                }
                wordStore[i + 2] = 95;
                hyphenateFunc();
                i = wordLength - rightmin;
                while (i >= leftmin) {
                    if ((hyphenPointsStore[i + 1] & 1) === 1) {
                        word = word.substring(0, i) + hyphenchar + word.substring(i);
                    }
                    i -= 1;
                }
                return word;
            };
        }

        function instantiateWasmEngine(lang) {
            Promise.all([H.assets[lang], H.assets.wasmHyphenEngine]).then(
                function onAll(assets) {
                    const hpbBuf = assets[0];
                    const baseData = calculateBaseData(hpbBuf);
                    const wasmModule = assets[1];
                    const wasmMemory = (H.specMems[lang].buffer.byteLength >= baseData.heapSize)
                        ? H.specMems[lang]
                        : new WebAssembly.Memory({
                            initial: baseData.heapSize / 65536,
                            maximum: 256
                        });
                    const ui32wasmMemory = new Uint32Array(wasmMemory.buffer);
                    ui32wasmMemory.set(new Uint32Array(hpbBuf), 0);
                    baseData.wasmMemory = wasmMemory;
                    WebAssembly.instantiate(wasmModule, {
                        ext: createImportObject(baseData),
                        env: {
                            memory: baseData.wasmMemory,
                            memoryBase: 0
                        }
                    }).then(
                        function runWasm(result) {
                            result.exports.convert();
                            prepareLanguagesObj(
                                lang,
                                encloseHyphenateFunction(baseData, result.exports.hyphenate),
                                baseData.characters,
                                baseData.leftmin,
                                baseData.rightmin
                            );
                        }
                    );
                }
            );
        }

        function instantiateAsmEngine(lang) {
            const hpbBuf = H.assets[lang];
            const baseData = calculateBaseData(hpbBuf);
            const heapBuffer = (H.specMems[lang].byteLength >= baseData.heapSize)
                ? H.specMems[lang]
                : new ArrayBuffer(baseData.heapSize);
            const ui8Heap = new Uint8Array(heapBuffer);
            const ui8Patterns = new Uint8Array(hpbBuf);
            ui8Heap.set(ui8Patterns, 0);
            baseData.heapBuffer = heapBuffer;
            const theHyphenEngine = asmHyphenEngine(
                {
                    Uint8Array: window.Uint8Array,
                    Uint16Array: window.Uint16Array,
                    Int32Array: window.Int32Array
                },
                createImportObject(baseData),
                baseData.heapBuffer
            );
            //console.time("convert(asm)");
            theHyphenEngine.convert();
            //console.timeEnd("convert(asm)");
            prepareLanguagesObj(
                lang,
                encloseHyphenateFunction(baseData, theHyphenEngine.hyphenate),
                baseData.characters,
                baseData.leftmin,
                baseData.rightmin
            );
        }

        let engineInstantiator;
        const hpb = [];
        function prepare(lang, engineType) {
            if (lang === "*") {
                if (engineType === "wasm") {
                    engineInstantiator = instantiateWasmEngine;
                } else if (engineType === "asm") {
                    engineInstantiator = instantiateAsmEngine;
                }
                hpb.forEach(function (lang) {
                    engineInstantiator(lang);
                });
            } else {
                if (engineInstantiator) {
                    engineInstantiator(lang);
                } else {
                    hpb.push(lang);
                }
            }
        }

        function handleEvt(evt) {
            //makeTimeStamp(evt[0]);
            switch (evt[0]) {
            case "DOMContentLoaded":
                autoSetMainLanguage();
                collectElements();
                H.evt(["ElementsReady"]);
                break;
            case "ElementsReady":
                elements.each(function (lang, values) {
                    if (H.hasOwnProperty("languages") && H.languages.hasOwnProperty(lang) && H.languages[lang].engineReady) {
                        hyphenateLangElements(lang, values);
                    }//else wait for "patternReady"-evt
                });
                break;
            case "engineLoaded":
                prepare("*", evt[1]);
                break;
            case "hpbLoaded":
                prepare(evt[1], "*");
                //fires H.evt(["engineReady", evt[1]]);
                break;
            case "engineReady":
                if (H.elementsReady) {
                    hyphenateLangElements(evt[1], elements.list[evt[1]]);
                } //else wait for "ElementsReady"-evt
                break;
            case "hyphenationDone":
                w.clearTimeout(C.timeOutHandler);
                w.document.documentElement.style.visibility = "visible";
                C.onHyphenationDone();
                break;
            case "timeout":
                w.document.documentElement.style.visibility = "visible";
                C.onTimeOut();
                break;
            }
        }
        //public methods
        H.addExceptions = function (lang, words) {
            if (lang === "") {
                lang = "global";
            }
            if (exceptions.lang !== undefined) {
                exceptions[lang] += ", " + words;
            } else {
                exceptions[lang] = words;
            }
        };

        C.onHyphenopolyStart();

        //clear Loader-timeout
        w.clearTimeout(H.setup.timeOutHandler);
        //renew timeout for the case something fails
        Object.defineProperty(C, "timeOutHandler", setProp(w.setTimeout(function () {
            handleEvt(["timeout"]);
        }, C.timeout), 2));

        //import and exec triggered events from loader
        H.evt = function (m) {
            handleEvt(m);
        };
        H.evtList.forEach(function evt(m) {
            handleEvt(m);
        });
        delete H.evtList;


    }(w));
}(window));
