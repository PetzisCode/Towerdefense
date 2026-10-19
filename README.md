# PRISMA – Resonanz Tower Defense

Ein Neon-Tower-Defense für den Handy-Browser (optimiert fürs iPhone, Hochformat). Reines HTML5/Canvas + JavaScript, keine Abhängigkeiten, kein Build-Schritt.

**Spielen:** https://petziscode.github.io/Towerdefense/ (sobald GitHub Pages aktiviert ist, siehe unten)

## Was PRISMA anders macht

- **Freies Labyrinth** – Es gibt keinen festen Weg. Gegner berechnen live den kürzesten Weg zum Kern; deine Türme sind die Wände. Beim Bauen siehst du vorab, wie sich die Route verändert. Komplett zubauen geht nicht – und Gleiter fliegen einfach drüber.
- **Element-Reaktionen** – Frost, Glut und Volt hinterlassen Zustände auf Gegnern, die miteinander reagieren:
  - Frost + Glut → **Thermoschock** (Burst-Schaden, Gegner wird brüchig)
  - Frost + Volt → **Supraleiter** (Gegner gefriert komplett)
  - Glut + Volt → **Plasma** (Explosion im Umkreis)
- **Resonanz** – Unterschiedliche Turmtypen direkt nebeneinander verbinden sich mit Energie-Strahlen: +15 % Schaden pro verschiedenem Nachbarn.
- **Wisch-Ernte** – Besiegte Gegner lassen Energie-Splitter fallen. Wische darüber, um sie einzusammeln; schnelle Serien geben einen Kombo-Bonus. Liegengelassenes bringt weniger.
- **Überladen** – Doppeltipp auf einen Turm: 5 s lang 2,5× Feuerrate, danach überhitzt er.
- **Vortex** – Schwerkraftbrunnen bündelt Gegner und implodiert; je mehr gefangen sind, desto härter.
- **Zeitriss** – Globale Verlangsamung mit Abklingzeit.
- 6 Türme mit je 3 Stufen, 9 Gegnertypen (Panzer, Phantome, Splitter, Heiler, Gleiter, Koloss-Bosse …), zweites Portal ab Welle 12, Sieg nach Welle 30, danach endlos.

## Steuerung

| Aktion | Geste |
|---|---|
| Turm wählen | Karte unten antippen |
| Bauen | Feld antippen (Vorschau) → nochmal tippen |
| Turm-Menü | Turm antippen |
| Überladen | Turm doppelt antippen |
| Energie ernten | Über Splitter wischen |

Tipp: In Safari **Teilen → Zum Home-Bildschirm** – dann läuft PRISMA im Vollbild wie eine App.

## GitHub Pages aktivieren

1. Repository → **Settings** → **Pages**
2. Unter *Build and deployment*: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → **Save**
3. Nach ca. einer Minute ist das Spiel unter `https://petziscode.github.io/Towerdefense/` erreichbar.

## Lokal starten

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

(ES-Module brauchen einen Webserver – Doppelklick auf `index.html` reicht nicht.)

## Aufbau

```
index.html          Layout, Menüs, Anleitung
css/style.css       Neon-UI, Safe-Areas fürs iPhone
js/data.js          Türme, Gegner, Reaktionen, Wellen-Generator
js/game.js          Spiellogik (Pfadfindung, Kampf, Reaktionen) & Canvas-Rendering
js/main.js          Touch-Eingabe, HUD, Spielschleife
js/audio.js         Synthesizer-Soundeffekte (WebAudio)
sw.js, manifest     Offline-Fähigkeit & Home-Bildschirm-Icon
```
