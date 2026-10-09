// Kern des Regelprüfers: Regeln laden, Text und Stil aus HTML/CSS/Markdown
// gewinnen, Regeln anwenden. Keine eigenen Regeln, keine Abhängigkeiten.

import { readFileSync } from "node:fs";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", copy: "©",
  reg: "®", euro: "€", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä",
  Ouml: "Ö", Uuml: "Ü", szlig: "ß", bdquo: "„", ldquo: "“", rdquo: "”",
  lsquo: "‘", rsquo: "’",
};

// ---------------------------------------------------------------- Regeln

/** Liest die Regeldatei. Wirft bei fehlender/kaputter Datei einen Error mit lesbarer Meldung. */
export function ladeRegeln(pfad) {
  let roh;
  try {
    roh = readFileSync(pfad, "utf8");
  } catch (e) {
    throw new Error(`Regeldatei nicht lesbar: ${pfad} (${e.code || e.message})`);
  }
  let daten;
  try {
    daten = JSON.parse(roh);
  } catch (e) {
    throw new Error(`Regeldatei ist kein gültiges JSON: ${pfad} (${e.message})`);
  }
  return normalisiereRegeln(daten);
}

/** Prüft das Austauschformat (Version 1) und übersetzt Muster in RegExp. Ungültige Regeln werden gemeldet und übersprungen. */
export function normalisiereRegeln(daten, warne = (t) => process.stderr.write(t + "\n")) {
  if (!daten || typeof daten !== "object" || daten.version !== 1 || !Array.isArray(daten.regeln)) {
    throw new Error("Regeldatei hat nicht das Format {version: 1, regeln: [...]}");
  }
  const ausnahmen = {
    ok_marker: "",
    guillemet_zitate: false,
    zitat_direktive: false,
    ...(daten.ausnahmen || {}),
  };
  const regeln = [];
  for (const r of daten.regeln) {
    if (!r || typeof r.id !== "string" || typeof r.muster !== "string") {
      warne(`Regel übersprungen: id oder muster fehlt (${JSON.stringify(r)})`);
      continue;
    }
    const bereich = r.bereich === "stil" ? "stil" : r.bereich === "text" ? "text" : null;
    if (!bereich) {
      warne(`Regel ${r.id} übersprungen: unbekannter bereich "${r.bereich}"`);
      continue;
    }
    let rx;
    try {
      rx = new RegExp(r.muster, r.gross_klein ? "gu" : "giu");
    } catch (e) {
      warne(`Regel ${r.id} übersprungen: ungültiges Muster (${e.message})`);
      continue;
    }
    regeln.push({
      id: r.id,
      bereich,
      rx,
      schweregrad: r.schweregrad === "fehler" ? "fehler" : "warnung",
      begriff: r.begriff || "",
      hinweis: r.hinweis || "",
      ausnahmen: Array.isArray(r.ausnahmen) ? r.ausnahmen.map(String) : [],
    });
  }
  return { ausnahmen, regeln };
}

// ------------------------------------------------------------ Extraktion

function zeilenAnzahlBis(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Ersetzt Treffer durch ihre Zeilenumbrüche, damit Zeilennummern stimmen.
function leere(text, rx) {
  return text.replace(rx, (m) => m.replace(/[^\n]/g, ""));
}

export function dekodiereEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m;
  });
}

/**
 * Zerlegt HTML in sichtbaren Text (Zeilen bleiben erhalten) und Stil-Quellen.
 * Rückgabe: { text, stile: [{ css, ersteZeile, attribut?, tag? }] }
 */
export function zerlegeHtml(html) {
  let t = leere(html, /<!--[\s\S]*?-->/g);
  const stile = [];
  for (const m of t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const start = m.index + m[0].indexOf(">") + 1;
    stile.push({ css: m[1], ersteZeile: zeilenAnzahlBis(t, start) });
  }
  t = leere(t, /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi);
  t = leere(t, /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi);
  for (const m of t.matchAll(/<([a-zA-Z][\w:-]*)\b[^>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const innen = m[2] ?? m[3];
    const pos = m.index + m[0].lastIndexOf(innen);
    stile.push({ css: innen, ersteZeile: zeilenAnzahlBis(t, pos), attribut: true, tag: m[1].toLowerCase() });
  }
  t = t.replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g, (m, name) =>
    BLOCK_TAGS.has(name.toLowerCase()) ? m.replace(/[^\n]/g, " ") : m.replace(/[^\n]/g, "")
  );
  t = t.replace(/<![^>]*>/g, (m) => m.replace(/[^\n]/g, ""));
  return { text: dekodiereEntities(t), stile };
}

/**
 * Liest CSS (auch minifiziert) und liefert Deklarationen in der Form
 * "eigenschaft:wert" (klein, ohne Leerraum) mit Zeile und Selektor.
 * `zeilenOffset` ist die Zeilennummer der ersten Zeile im Gesamtdokument.
 */
export function leseDeklarationen(css, { zeilenOffset = 1, standardSelektor = "" } = {}) {
  const s = leere(css, /\/\*[\s\S]*?\*\//g);
  const ergebnis = [];
  const stapel = [];
  let puffer = "";
  let zeile = zeilenOffset;
  let pufferZeile = null;

  const deklarationAbschliessen = () => {
    const roh = puffer.trim();
    if (roh.includes(":") && !roh.startsWith("@")) {
      const i = roh.indexOf(":");
      const eig = roh.slice(0, i).replace(/\s+/g, "").toLowerCase();
      const wert = roh.slice(i + 1).replace(/\s+/g, "").toLowerCase();
      if (eig && wert) {
        const selektor = [...stapel].reverse().find((x) => !x.startsWith("@")) ?? stapel[stapel.length - 1] ?? standardSelektor;
        ergebnis.push({ text: `${eig}:${wert}`, zeile: pufferZeile ?? zeile, selektor });
      }
    }
    puffer = "";
    pufferZeile = null;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") zeile++;
    if (c === "{") {
      stapel.push(puffer.replace(/\s+/g, " ").trim());
      puffer = "";
      pufferZeile = null;
    } else if (c === "}") {
      deklarationAbschliessen();
      stapel.pop();
    } else if (c === ";") {
      deklarationAbschliessen();
    } else {
      if (pufferZeile === null && !/\s/.test(c)) pufferZeile = zeile;
      puffer += c;
    }
  }
  deklarationAbschliessen();
  return ergebnis;
}

function ausnahmeZeilen(rohText, ausnahmen) {
  const marker = new Set();
  if (!ausnahmen.ok_marker) return marker;
  rohText.split("\n").forEach((z, i) => {
    if (z.includes(ausnahmen.ok_marker)) marker.add(i + 1);
  });
  return marker;
}

// Zeilen innerhalb von :::zitat ... ::: (remark-directive).
function zitatZeilen(text) {
  const menge = new Set();
  let innen = 0;
  text.split("\n").forEach((z, i) => {
    const k = z.trim();
    if (/^:{2,}zitat\b/.test(k)) {
      innen++;
      menge.add(i + 1);
    } else if (innen > 0 && /^:{2,}$/.test(k)) {
      menge.add(i + 1);
      innen--;
    } else if (innen > 0) {
      menge.add(i + 1);
    }
  });
  return menge;
}

// ------------------------------------------------------------- Anwenden

function fundOk(regel, fund) {
  return regel.ausnahmen.includes(fund.trim());
}

function wendeTextAn(datei, text, rohText, regeln, ausnahmen, istHtml) {
  const funde = [];
  const textRegeln = regeln.filter((r) => r.bereich === "text");
  if (!textRegeln.length) return funde;
  const marker = ausnahmeZeilen(rohText, ausnahmen);
  const zitat = !istHtml && ausnahmen.zitat_direktive ? zitatZeilen(text) : new Set();
  text.split("\n").forEach((zeile, i) => {
    const nr = i + 1;
    if (marker.has(nr) || zitat.has(nr)) return;
    if (ausnahmen.guillemet_zitate && /»[^«]*«/.test(zeile)) return;
    for (const r of textRegeln) {
      for (const m of zeile.matchAll(r.rx)) {
        if (m[0] === "" || fundOk(r, m[0])) continue;
        funde.push(neuerFund(datei, nr, null, r, m[0]));
      }
    }
  });
  return funde;
}

function wendeStilAn(datei, deklarationen, rohText, regeln, ausnahmen, minifiziert) {
  const funde = [];
  const stilRegeln = regeln.filter((r) => r.bereich === "stil");
  if (!stilRegeln.length) return funde;
  const marker = ausnahmeZeilen(rohText, ausnahmen);
  for (const d of deklarationen) {
    if (marker.has(d.zeile)) continue;
    for (const r of stilRegeln) {
      for (const m of d.text.matchAll(r.rx)) {
        if (m[0] === "" || fundOk(r, m[0])) continue;
        funde.push(neuerFund(datei, minifiziert ? null : d.zeile, d.selektor || null, r, m[0]));
      }
    }
  }
  return funde;
}

function neuerFund(datei, zeile, selektor, regel, fund) {
  return {
    datei,
    zeile,
    selektor,
    id: regel.id,
    fund,
    schweregrad: regel.schweregrad,
    hinweis: regel.hinweis,
  };
}

/** Prüft den Inhalt einer Datei; Art richtet sich nach der Endung. */
export function pruefeInhalt(datei, inhalt, { regeln, ausnahmen }) {
  const endung = (datei.match(/\.([^./\\]+)$/)?.[1] || "").toLowerCase();
  if (endung === "css") {
    const mini = inhalt.trim().split("\n").length <= 1;
    const dekl = leseDeklarationen(inhalt);
    return wendeStilAn(datei, dekl, inhalt, regeln, ausnahmen, mini);
  }
  if (endung === "html" || endung === "htm") {
    const { text, stile } = zerlegeHtml(inhalt);
    const dekl = [];
    for (const s of stile) {
      dekl.push(
        ...leseDeklarationen(s.css, {
          zeilenOffset: s.ersteZeile,
          standardSelektor: s.attribut ? `${s.tag}[style]` : "",
        })
      );
    }
    return [
      ...wendeTextAn(datei, text, inhalt, regeln, ausnahmen, true),
      ...wendeStilAn(datei, dekl, inhalt, regeln, ausnahmen, false),
    ].sort((a, b) => (a.zeile ?? 0) - (b.zeile ?? 0));
  }
  // Markdown, Text und alles Übrige: zeilenweise als Text.
  return wendeTextAn(datei, inhalt, inhalt, regeln, ausnahmen, false);
}
