// Ablauf des Kommandozeilenaufrufs (Einstieg und Hilfetext: cli.mjs).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { ladeRegeln, pruefeInhalt } from "./pruefer.mjs";

const ENDUNGEN = new Set(["html", "htm", "css", "md", "markdown", "txt"]);
const UEBERSPRINGEN = new Set(["node_modules", ".git"]);

function hilfe() {
  const kopf = [];
  for (const z of readFileSync(new URL("./cli.mjs", import.meta.url), "utf8").split("\n").slice(1)) {
    if (!z.startsWith("//")) break;
    kopf.push(z);
  }
  return kopf.map((z) => z.replace(/^\/\/ ?/, "")).join("\n");
}

export function leseArgumente(argv) {
  const a = { regeln: null, format: "text", nurWarnen: false, pfade: [], fehler: null, hilfe: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--regeln") a.regeln = argv[++i] ?? null;
    else if (x === "--format") a.format = argv[++i] ?? "";
    else if (x === "--nur-warnen") a.nurWarnen = true;
    else if (x === "--hilfe" || x === "-h" || x === "--help") a.hilfe = true;
    else if (x.startsWith("--")) a.fehler = `Unbekannte Option: ${x}`;
    else a.pfade.push(x);
  }
  if (!a.fehler && !["text", "json"].includes(a.format)) a.fehler = `Unbekanntes Format: ${a.format}`;
  if (!a.fehler && !a.hilfe && !a.regeln) a.fehler = "--regeln <datei.json> fehlt";
  return a;
}

function globZuRegex(muster) {
  let rx = "";
  for (let i = 0; i < muster.length; i++) {
    const c = muster[i];
    if (c === "*" && muster[i + 1] === "*") {
      i++;
      if (muster[i + 1] === "/") i++;
      rx += "(?:.*/)?";
    } else if (c === "*") rx += "[^/]*";
    else if (c === "?") rx += "[^/]";
    else rx += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${rx}$`);
}

function gehe(ordner, sammler) {
  for (const name of readdirSync(ordner).sort()) {
    if (UEBERSPRINGEN.has(name)) continue;
    const voll = join(ordner, name);
    const st = statSync(voll);
    if (st.isDirectory()) gehe(voll, sammler);
    else sammler.push(voll);
  }
}

function hatEndung(pfad) {
  return ENDUNGEN.has((pfad.match(/\.([^./\\]+)$/)?.[1] || "").toLowerCase());
}

/** Löst Dateien, Verzeichnisse und Globs zu einer sortierten Dateiliste auf. */
export function loesePfadeAuf(eingaben, cwd = process.cwd(), zaehler = { pfadfehler: 0 }) {
  const dateien = new Set();
  const meldeFehler = (text) => {
    zaehler.pfadfehler++;
    process.stderr.write(`Fehler: ${text}\n`);
  };
  for (const e of eingaben) {
    if (/[*?]/.test(e)) {
      const teile = e.split("/");
      const i = teile.findIndex((t) => /[*?]/.test(t));
      const basis = teile.slice(0, i).join("/") || ".";
      const abs = resolve(cwd, basis);
      if (!existsSync(abs)) {
        meldeFehler(`keine Datei gefunden für ${e}`);
        continue;
      }
      const alle = [];
      gehe(abs, alle);
      const absolut = e.startsWith("/");
      const rx = globZuRegex(absolut ? e : e.replace(/^\.\//, ""));
      let treffer = 0;
      for (const f of alle) {
        const rel = relative(cwd, f).split("\\").join("/");
        const vergleich = absolut ? f.split("\\").join("/") : rel;
        if (rx.test(vergleich) && hatEndung(f)) {
          dateien.add(rel);
          treffer++;
        }
      }
      if (!treffer) meldeFehler(`keine Datei gefunden für ${e}`);
    } else {
      const abs = resolve(cwd, e);
      if (!existsSync(abs)) {
        meldeFehler(`Pfad nicht gefunden: ${e}`);
        continue;
      }
      if (statSync(abs).isDirectory()) {
        const alle = [];
        gehe(abs, alle);
        let treffer = 0;
        for (const f of alle) {
          if (hatEndung(f)) {
            dateien.add(relative(cwd, f).split("\\").join("/"));
            treffer++;
          }
        }
        if (!treffer) meldeFehler(`keine prüfbare Datei in ${e}`);
      } else dateien.add(relative(cwd, abs).split("\\").join("/"));
    }
  }
  return [...dateien].sort();
}

export function formatiereText(funde) {
  return funde
    .map((f) => {
      const ort = f.zeile != null ? `${f.datei}:${f.zeile}` : f.selektor ? `${f.datei} [${f.selektor}]` : f.datei;
      return `${ort}: ${f.schweregrad} ${f.id}: "${f.fund}"${f.hinweis ? ` - ${f.hinweis}` : ""}`;
    })
    .join("\n");
}

export function lauf(argv, { cwd = process.cwd(), ausgabe = (t) => process.stdout.write(t) } = {}) {
  const a = leseArgumente(argv);
  if (a.hilfe) {
    ausgabe(hilfe() + "\n");
    return 0;
  }
  if (a.fehler) {
    process.stderr.write(`${a.fehler}\n\n${hilfe()}\n`);
    return 2;
  }
  let satz;
  try {
    satz = ladeRegeln(resolve(cwd, a.regeln));
  } catch (e) {
    process.stderr.write(`Hinweis: ${e.message}. Es wurde nichts geprüft.\n`);
    return 0;
  }
  const funde = [];
  const zaehler = { pfadfehler: 0 };
  for (const datei of loesePfadeAuf(a.pfade, cwd, zaehler)) {
    let inhalt;
    try {
      inhalt = readFileSync(resolve(cwd, datei), "utf8");
    } catch (e) {
      process.stderr.write(`Datei nicht lesbar: ${datei} (${e.code || e.message})\n`);
      continue;
    }
    funde.push(...pruefeInhalt(datei, inhalt, satz));
  }
  if (a.format === "json") ausgabe(JSON.stringify(funde, null, 2) + "\n");
  else if (funde.length) ausgabe(formatiereText(funde) + "\n");
  const fehler = funde.filter((f) => f.schweregrad === "fehler").length;
  if (a.format === "text") {
    process.stderr.write(`${funde.length} Funde, davon ${fehler} Fehler\n`);
  }
  if (zaehler.pfadfehler) return 2;
  return fehler > 0 && !a.nurWarnen ? 1 : 0;
}
