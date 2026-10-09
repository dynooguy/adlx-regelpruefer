#!/usr/bin/env node
// regelpruefer - prüft gebaute Ausgabe gegen eine Regeldatei (JSON, Version 1).
//
// Aufruf:
//   regelpruefer --regeln <datei.json> [--format text|json] [--nur-warnen] <pfad|glob>...
//
// Optionen:
//   --regeln <datei>   Regeldatei im Austauschformat Version 1 (Pflicht)
//   --format text|json Ausgabe als Zeilen (Standard) oder als JSON-Liste der Funde
//   --nur-warnen       Exit-Code ist immer 0, auch bei Funden mit Schweregrad "fehler"
//   --hilfe            diese Hilfe
//
// Pfade: Dateien, Verzeichnisse (rekursiv, Endungen html htm css md markdown txt)
// oder Globs mit * ** ?. Fund: Datei, Zeile (bei minifiziertem CSS Selektor statt
// Zeile), Regel-id, Fundtext, Schweregrad, Hinweis.
//
// Exit-Code: 1 nur bei mindestens einem Fund mit Schweregrad "fehler" (nie mit
// --nur-warnen), sonst 0. Fehlende oder kaputte Regeldatei: Hinweis auf stderr,
// Exit 0. Falscher Aufruf (Option fehlt/unbekannt): Exit 2.

import { lauf } from "./lauf.mjs";

process.exitCode = lauf(process.argv.slice(2));
