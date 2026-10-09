import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));

// Neutrale Testregeln, keine fachlichen Inhalte.
const REGELN = {
  version: 1,
  quelle: "datei",
  stand_iso: "2000-01-01T00:00:00Z",
  ausnahmen: { ok_marker: "<!-- test-ok -->", guillemet_zitate: true, zitat_direktive: true },
  regeln: [
    { id: "stil-gross", fakt: "x.y", bereich: "stil", muster: "text-transform:uppercase",
      gross_klein: false, schweregrad: "warnung", begriff: "Versalien", hinweis: "Keine Versalien per CSS", ausnahmen: [] },
    { id: "text-gross", fakt: "x.y", bereich: "text", muster: "\\b[A-ZÄÖÜ]{4,}\\b",
      gross_klein: true, schweregrad: "warnung", begriff: "Grossbuchstaben", hinweis: "Nicht in Grossbuchstaben", ausnahmen: ["ABCD"] },
    { id: "text-wort", fakt: "x.y", bereich: "text", muster: "verboten",
      gross_klein: false, schweregrad: "fehler", begriff: "verboten", hinweis: "Wort vermeiden", ausnahmen: [] },
  ],
};

function arbeitsordner() {
  const d = mkdtempSync(join(tmpdir(), "regelpruefer-"));
  writeFileSync(join(d, "regeln.json"), JSON.stringify(REGELN));
  return d;
}

function lauf(d, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function json(d, datei, inhalt, extra = []) {
  writeFileSync(join(d, datei), inhalt);
  const r = lauf(d, ["--regeln", "regeln.json", "--format", "json", ...extra, datei]);
  return { ...r, funde: JSON.parse(r.out) };
}

test("Stil-Regel: CSS-Datei, minifiziertes CSS und style-Attribut", () => {
  const d = arbeitsordner();
  try {
    let r = json(d, "a.css", ".kopf {\n  color: red;\n  text-transform: uppercase;\n}\n");
    assert.equal(r.funde.length, 1);
    assert.equal(r.funde[0].id, "stil-gross");
    assert.equal(r.funde[0].zeile, 3);
    assert.equal(r.funde[0].fund, "text-transform:uppercase");

    r = json(d, "m.css", ".a{text-transform:uppercase}.b{color:red}");
    assert.equal(r.funde.length, 1);
    assert.equal(r.funde[0].zeile, null);
    assert.equal(r.funde[0].selektor, ".a");

    r = json(d, "s.html", '<p>Text</p>\n<p style="color:red; text-transform: UPPERCASE">x</p>\n<style>\nh1 { text-transform: uppercase }\n</style>');
    const ids = r.funde.map((f) => [f.id, f.zeile]);
    assert.deepEqual(ids, [["stil-gross", 2], ["stil-gross", 4]]);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Text-Regel mit gross_klein: Fund, Script, ok_marker, Regel-Ausnahme", () => {
  const d = arbeitsordner();
  try {
    const html = [
      "<p>RENDITE &amp; REALITÄT</p>",
      "<script>var x = 'NICHTGEMELDET';</script>",
      "<p>MARKIERT</p> <!-- test-ok -->",
      "<p>ABCD ist erlaubt</p>",
      "<!-- KOMMENTAR -->",
      "<p>klein bleibt klein</p>",
    ].join("\n");
    const r = json(d, "t.html", html);
    assert.deepEqual(r.funde.map((f) => [f.fund, f.zeile]), [["RENDITE", 1], ["REALITÄT", 1]]);
    assert.equal(r.code, 0);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Guillemets und zitat-Direktive in Markdown", () => {
  const d = arbeitsordner();
  try {
    const md = ["Das Wort »verboten« wird erwähnt.", ":::zitat", "verboten hier", ":::", "verboten dort"].join("\n");
    const r = json(d, "a.md", md);
    assert.deepEqual(r.funde.map((f) => f.zeile), [5]);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Exit-Codes", () => {
  const d = arbeitsordner();
  try {
    writeFileSync(join(d, "warn.md"), "SCHREIEN\n");
    writeFileSync(join(d, "fehler.md"), "verboten\n");
    assert.equal(lauf(d, ["--regeln", "regeln.json", "warn.md"]).code, 0);
    assert.equal(lauf(d, ["--regeln", "regeln.json", "fehler.md"]).code, 1);
    assert.equal(lauf(d, ["--regeln", "regeln.json", "--nur-warnen", "fehler.md"]).code, 0);
    const fehlt = lauf(d, ["--regeln", "gibt-es-nicht.json", "fehler.md"]);
    assert.equal(fehlt.code, 0);
    assert.match(fehlt.err, /Regeldatei nicht lesbar/);
    writeFileSync(join(d, "kaputt.json"), "{");
    const kaputt = lauf(d, ["--regeln", "kaputt.json", "fehler.md"]);
    assert.equal(kaputt.code, 0);
    assert.match(kaputt.err, /kein gültiges JSON/);
    assert.equal(lauf(d, ["fehler.md"]).code, 2);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("JSON-Felder, Textausgabe, Verzeichnis und Glob", () => {
  const d = arbeitsordner();
  try {
    mkdirSync(join(d, "ausgabe/unter"), { recursive: true });
    writeFileSync(join(d, "ausgabe/a.md"), "verboten\n");
    writeFileSync(join(d, "ausgabe/unter/b.txt"), "verboten\n");
    writeFileSync(join(d, "ausgabe/c.png"), "verboten\n");
    const j = lauf(d, ["--regeln", "regeln.json", "--format", "json", "ausgabe"]);
    const funde = JSON.parse(j.out);
    assert.equal(funde.length, 2);
    assert.deepEqual(Object.keys(funde[0]).sort(),
      ["datei", "fund", "hinweis", "id", "schweregrad", "selektor", "zeile"]);
    assert.equal(funde[0].schweregrad, "fehler");
    assert.equal(funde[0].hinweis, "Wort vermeiden");
    const g = lauf(d, ["--regeln", "regeln.json", "ausgabe/*.md"]);
    assert.match(g.out, /^ausgabe\/a\.md:1: fehler text-wort: "verboten" - Wort vermeiden$/m);
    assert.equal(g.out.includes("b.txt"), false);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Ungültiges Muster überspringt nur diese Regel", () => {
  const d = arbeitsordner();
  try {
    const regeln = structuredClone(REGELN);
    regeln.regeln.unshift({ id: "kaputt", bereich: "text", muster: "(", schweregrad: "fehler" });
    writeFileSync(join(d, "regeln.json"), JSON.stringify(regeln));
    const r = json(d, "x.md", "verboten\n");
    assert.equal(r.funde.length, 1);
    assert.match(r.err, /Regel kaputt übersprungen/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Unicode-Wortgrenzen wie in Python", () => {
  const d = arbeitsordner();
  try {
    const regeln = structuredClone(REGELN);
    regeln.regeln = [
      { id: "a", bereich: "text", muster: "\\bÄrger\\b", gross_klein: true, schweregrad: "warnung" },
      { id: "b", bereich: "text", muster: "\\bgroß\\b", gross_klein: true, schweregrad: "warnung" },
      { id: "c", bereich: "text", muster: "\\bpacht\\w*", gross_klein: false, schweregrad: "warnung" },
    ];
    writeFileSync(join(d, "regeln.json"), JSON.stringify(regeln));
    const r = json(d, "u.md", "Ärger und Ärgernis\ngroß und großartig\nein Pachtvertrag\n");
    assert.deepEqual(r.funde.map((f) => [f.id, f.fund, f.zeile]), [["a", "Ärger", 1], ["b", "groß", 2], ["c", "Pachtvertrag", 3]]);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Absoluter Glob und Hinweis ohne Treffer", () => {
  const d = arbeitsordner();
  try {
    writeFileSync(join(d, "x.md"), "verboten\n");
    const r = lauf(d, ["--regeln", "regeln.json", `${d}/*.md`]);
    assert.match(r.out, /x\.md:1: fehler text-wort/);
    const n = lauf(d, ["--regeln", "regeln.json", "nix/*.md"]);
    assert.match(n.err, /keine Datei gefunden/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("CSS: Semikolon und Klammer in Strings und url() sind keine Trenner", () => {
  const d = arbeitsordner();
  try {
    const css = '.a{background:url(data:image/svg+xml;utf8,<svg>{x}</svg>);text-transform:uppercase}.b{content:"a;b}";color:red}';
    const r = json(d, "d.css", css);
    assert.equal(r.funde.length, 1);
    assert.equal(r.funde[0].selektor, ".a");
  } finally {
    rmSync(d, { recursive: true });
  }
});
