import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

// Node has no DOMParser/XMLSerializer; polyfill the globals `character-svg.ts`
// expects before re-exporting it, so that module can stay environment-agnostic
// (and the browser bundle never pulls in @xmldom/xmldom, since client code
// imports "@/lib/character-svg" directly and uses its own native globals).
if (typeof globalThis.DOMParser === "undefined") {
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
}
if (typeof globalThis.XMLSerializer === "undefined") {
  (globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = XMLSerializer;
}

export { parseCharacterSvg, type CharacterVector } from "@/lib/character-svg";
