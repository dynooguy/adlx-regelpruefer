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
    assert.match(n.err, /keine Datei gefunden für nix\/\*\.md/);
    assert.equal(n.code, 2);
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

test("Pfadfehler: Exit 2 mit Pfad auf stderr, auch mit --nur-warnen", () => {
  const d = arbeitsordner();
  try {
    mkdirSync(join(d, "leer"));
    writeFileSync(join(d, "leer", "bild.png"), "x");
    for (const pfad of ["gibt-es-nicht.md", "nix/*.md", "leer"]) {
      for (const extra of [[], ["--nur-warnen"]]) {
        const r = lauf(d, ["--regeln", "regeln.json", ...extra, pfad]);
        assert.equal(r.code, 2, `${pfad} ${extra}`);
        assert.ok(r.err.includes(pfad), r.err);
      }
    }
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Pfadfehler: vorhandene Dateien werden trotzdem geprüft, Exit bleibt 2", () => {
  const d = arbeitsordner();
  try {
    writeFileSync(join(d, "x.md"), "verboten\n");
    const r = lauf(d, ["--regeln", "regeln.json", "x.md", "fehlt.md"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /x\.md:1: fehler text-wort/);
    assert.match(r.err, /fehlt\.md/);
    const w = lauf(d, ["--regeln", "regeln.json", "--nur-warnen", "x.md", "fehlt.md"]);
    assert.equal(w.code, 2);
    assert.match(w.out, /x\.md:1: fehler text-wort/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("\\W, \\d, \\s in Zeichenklassen: Unicode wie Python (umgeschrieben)", () => {
  const d = arbeitsordner();
  try {
    const regeln = structuredClone(REGELN);
    const mk = (id, muster) => ({ id, bereich: "text", muster, gross_klein: true, schweregrad: "warnung" });
    regeln.regeln = [
      mk("w", "x[\\W]y"),     // Nicht-Wortzeichen zwischen x und y
      mk("d", "n[\\d]n"),     // Ziffer, auch nicht-ASCII (arabisch-indisch)
      mk("s", "a[\\s]b"),     // Leerraum, auch NBSP
      mk("nd", "m[^\\d\\s]m"), // weder Ziffer noch Leerraum
      mk("sw", "q[\\S]q"),    // Nicht-Leerraum
    ];
    writeFileSync(join(d, "regeln.json"), JSON.stringify(regeln));
    const text = [
      "x-y xäy",          // w: nur "x-y" (ä ist Wortzeichen)
      "n5n n\u0665n nXn",   // d: 5 und arabische 5, nicht X
      "a b a\u00a0b aXb",  // s: Leerzeichen und NBSP
      "m1m m m mxm",      // nd: nur mxm
      "q q qxq",          // sw: nur qxq
    ].join("\n") + "\n";
    const r = json(d, "k.md", text);
    assert.deepEqual(
      r.funde.map((f) => [f.id, f.zeile, f.fund]),
      [["w", 1, "x-y"], ["d", 2, "n5n"], ["d", 2, "n\u0665n"], ["s", 3, "a b"], ["s", 3, "a\u00a0b"], ["nd", 4, "mxm"], ["sw", 5, "qxq"]]
    );
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("CSS: Escapes außerhalb von Strings verschieben weder Selektor noch Deklaration", () => {
  const d = arbeitsordner();
  try {
    let r = json(d, "e1.css", ".a\\{b{text-transform:uppercase}");
    assert.equal(r.funde.length, 1);
    assert.equal(r.funde[0].selektor, ".a\\{b");
    r = json(d, "e2.css", ".x\\;y{text-transform:uppercase}");
    assert.equal(r.funde.length, 1);
    assert.equal(r.funde[0].selektor, ".x\\;y");
    r = json(d, "e3.css", ".x\\;y{color:red}.z{text-transform:uppercase}");
    assert.deepEqual(r.funde.map((f) => f.selektor), [".z"]);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Negierte Klasse mit \\W/\\D/\\S und nicht geschlossene Klasse", () => {
  const d = arbeitsordner();
  try {
    const regeln = structuredClone(REGELN);
    const mk = (id, muster) => ({ id, bereich: "text", muster, gross_klein: true, schweregrad: "warnung" });
    regeln.regeln = [mk("buchstabe", "k[^\\W\\d]k"), mk("offen", "k[abc")];
    writeFileSync(join(d, "regeln.json"), JSON.stringify(regeln));
    const r = lauf(d, ["--regeln", "regeln.json", "--format", "json", (writeFileSync(join(d, "n.md"), "kak käk k5k k-k\n"), "n.md")]);
    assert.deepEqual(JSON.parse(r.out).map((f) => f.fund), ["kak", "käk"]);
    assert.match(r.err, /Regel offen übersprungen: ungültiges Muster/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("Glob mit vorhandener Basis ohne Treffer: Exit 2", () => {
  const d = arbeitsordner();
  try {
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "sub", "a.md"), "verboten\n");
    const r = lauf(d, ["--regeln", "regeln.json", "sub/*.html"]);
    assert.equal(r.code, 2);
    assert.match(r.err, /keine Datei gefunden für sub\/\*\.html/);
  } finally {
    rmSync(d, { recursive: true });
  }
});
