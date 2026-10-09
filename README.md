# regelpruefer

Prüft gebaute Ausgabe (HTML, Mail-HTML, CSS, Markdown, Text) gegen eine
Regeldatei. Das Werkzeug bringt keine eigenen Regeln mit und hat keine
Abhängigkeiten. Voraussetzung: Node 20 oder neuer.

## Aufruf

```
regelpruefer --regeln <datei.json> [--format text|json] [--nur-warnen] <pfad|glob>...
```

Ohne Installation: `node cli.mjs --regeln regeln.json ausgabe/`.

| Option | Bedeutung |
|---|---|
| `--regeln <datei>` | Regeldatei (Pflicht) |
| `--format text` | eine Zeile je Fund (Standard) |
| `--format json` | Liste der Funde als JSON auf stdout |
| `--nur-warnen` | Exit-Code immer 0 |

Pfade sind Dateien, Verzeichnisse (rekursiv; geprüft werden `html`, `htm`,
`css`, `md`, `markdown`, `txt`) oder Globs mit `*`, `**` und `?`. `node_modules`
und `.git` werden übersprungen.

Exit-Code 1 gibt es nur bei mindestens einem Fund mit Schweregrad `fehler`
(nie mit `--nur-warnen`), sonst 0. Fehlt die Regeldatei oder ist sie kaputt,
steht ein Hinweis auf stderr und der Exit-Code ist 0. Falscher Aufruf ergibt 2.

## Was geprüft wird

- **HTML:** sichtbarer Text ohne `<script>`, `<style>` und Kommentare, Entities
  dekodiert. Zeilennummern beziehen sich auf die Quelldatei. `style="..."`-Attribute
  und `<style>`-Blöcke gehen in die Stil-Prüfung.
- **CSS:** Deklarationen werden zu `eigenschaft:wert` normalisiert (klein, ohne
  Leerraum), auch bei minifiziertem CSS. Bei einzeiligem CSS nennt der Fund den
  Selektor statt der Zeile.
- **Markdown und Text:** zeilenweise als Text, kein Markdown-Parser.
- Eingetippte Großbuchstaben sind nur grob erkennbar; dafür sind Warnungen gedacht.

## Regelformat (JSON, Version 1)

```json
{
  "version": 1,
  "quelle": "datei",
  "stand_iso": "2000-01-01T00:00:00Z",
  "ausnahmen": {
    "ok_marker": "<!-- wording-ok -->",
    "guillemet_zitate": true,
    "zitat_direktive": true
  },
  "regeln": [
    {
      "id": "stil-versalien",
      "fakt": "schluessel.des.fakts",
      "bereich": "stil",
      "muster": "text-transform:uppercase",
      "gross_klein": false,
      "schweregrad": "warnung",
      "begriff": "Versalien",
      "hinweis": "Keine Versalien per CSS.",
      "ausnahmen": []
    }
  ]
}
```

Regelfelder:

- `id`: stabile Kennung, steht im Fund.
- `fakt`: Verweis auf den Ursprung der Regel; der Prüfer wertet ihn nicht aus.
- `bereich`: `text` (sichtbarer Text, zeilenweise) oder `stil` (CSS-Deklaration
  als `eigenschaft:wert`).
- `muster`: regulärer Ausdruck (JavaScript-Syntax, Unicode-Modus).
- `gross_klein`: `true` heißt, Groß-/Kleinschreibung zählt; sonst wird ohne Beachtung
  gesucht.
- `schweregrad`: `warnung` oder `fehler`.
- `begriff`, `hinweis`: Beschreibung für die Ausgabe.
- `ausnahmen`: Fundtexte, die für diese Regel nie gemeldet werden (genau
  übereinstimmend, Groß-/Kleinschreibung zählt).

Globaler Block `ausnahmen`:

- `ok_marker`: Zeilen, die diesen Text enthalten, werden nicht gemeldet. Der Marker
  wird in der Quelldatei gesucht, also auch, wenn er in HTML ein Kommentar ist.
- `guillemet_zitate`: Zeilen mit Text in »Guillemets« werden nicht geprüft.
- `zitat_direktive`: In Markdown und Text bleibt alles zwischen `:::zitat` und
  dem schließenden `:::` ungeprüft.

Ein ungültiges `muster` überspringt nur diese Regel, mit einer Zeile auf stderr.
Regeln mit unbekanntem `bereich` werden ebenfalls übersprungen.

## Dialekt der Muster

Die Muster sollen in Python-`re` und in JavaScript dasselbe bedeuten. Verwende
deshalb nur die gemeinsame Teilmenge: Zeichenklassen, Gruppen, Alternativen,
Quantoren, Lookahead/Lookbehind. `\w`, `\W`, `\b` und `\B` werden vor dem
Kompilieren so umgeschrieben, dass sie wie in Python Unicode kennen (Umlaute, ß
zählen als Wortzeichen). In Zeichenklassen wird nur `\w` ersetzt. Das Muster wird
mit dem Unicode-Flag kompiliert; dort ungültige Escapes (etwa `\"`) machen die
Regel ungültig. Inline-Flags wie `(?i)` gibt es nicht, Groß-/Kleinschreibung
steuert `gross_klein`.

## Ausgabe

Textformat: `datei:zeile: schweregrad id: "fund" - hinweis`. JSON: Liste von
Objekten mit `datei`, `zeile`, `selektor`, `id`, `fund`, `schweregrad`,
`hinweis` (`zeile` ist bei minifiziertem CSS `null`, `selektor` nur bei Stil-Funden gesetzt).

## Tests

```
node --test
```

## Als Bibliothek

`import { ladeRegeln, pruefeInhalt } from "regelpruefer"` liefert dieselbe
Prüfung ohne Prozessaufruf: `pruefeInhalt(dateiname, inhalt, ladeRegeln(pfad))`
gibt die Liste der Funde zurück.
