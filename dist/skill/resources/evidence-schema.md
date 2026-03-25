# Evidence Bundle Schema

The evidence collector (pixelslop-scanner) captures all browser data in a single Playwright session, writes it to a JSON file, and hands the path to the orchestrator. Specialist evaluators read this file — they never touch a browser.

This schema is the contract. If the collector writes it and the specialist reads it, they must agree on the shape.

---

## Top-Level Structure

```json
{
  "url": "http://localhost:3000",
  "timestamp": "2026-03-25T16:30:00.000Z",
  "root": "/path/to/project",
  "confidence": {
    "screenshots": true,
    "computedStyles": true,
    "contrastRatios": true,
    "a11ySnapshot": true,
    "sourceGrepped": false,
    "multiViewport": true
  },
  "viewports": { /* see below */ },
  "console": { /* see below */ },
  "network": { /* see below */ },
  "personaChecks": { /* see below */ },
  "sourcePatterns": [ /* see below */ ]
}
```

- `confidence` tracks which evidence types were successfully collected. Specialists use this to adjust their scoring confidence.
- `root` is only present when `--root` was passed (enables source pattern detection).
- `sourcePatterns` is only populated when `root` is present.

---

## Viewports

Three viewports, each with different evidence depth.

### Desktop (1440x900) — Full extraction

```json
"desktop": {
  "width": 1440,
  "height": 900,
  "screenshot": "/tmp/pixelslop-screenshots/desktop.png",
  "typography": [
    {
      "tag": "h1",
      "classes": "text-5xl font-bold",
      "fontFamily": "'DM Sans', sans-serif",
      "fontSize": "48px",
      "fontWeight": "700",
      "lineHeight": "56px",
      "letterSpacing": "normal",
      "color": "rgb(17, 24, 39)"
    }
  ],
  "colors": [
    {
      "tag": "section",
      "classes": "hero bg-slate-900",
      "backgroundColor": "rgb(15, 23, 42)",
      "color": "rgb(248, 250, 252)",
      "borderColor": "none",
      "backgroundImage": "none"
    }
  ],
  "spacing": [
    {
      "tag": "section",
      "classes": "py-24 px-6",
      "padding": "96px 24px 96px 24px",
      "margin": "0px",
      "gap": "0px",
      "maxWidth": "none"
    }
  ],
  "decorations": {
    "counts": {
      "shadows": 4,
      "blurs": 0,
      "roundedElements": 12,
      "gradientTexts": 1
    },
    "details": [
      {
        "tag": "h2",
        "property": "background-clip",
        "value": "text",
        "context": "gradient text on heading"
      }
    ]
  },
  "contrast": [
    {
      "tag": "p",
      "text": "Start your journey today",
      "fg": "rgb(156, 163, 175)",
      "bg": "rgb(15, 23, 42)",
      "ratio": 5.2,
      "fontSize": "16px",
      "isLarge": false,
      "passesAA": true
    }
  ],
  "a11ySnapshot": {
    "headings": [
      { "level": 1, "text": "Build Something Real", "tag": "h1" },
      { "level": 2, "text": "Features", "tag": "h2" }
    ],
    "landmarks": ["banner", "navigation", "main", "contentinfo"],
    "images": [
      { "src": "/hero.png", "alt": "Dashboard preview", "hasAlt": true }
    ],
    "forms": [
      { "inputs": 2, "labels": 1, "missingLabels": ["email input"] }
    ],
    "ariaRoles": ["button", "link", "navigation"],
    "skipLink": false,
    "langAttribute": "en"
  },
  "overflow": {
    "hasOverflow": false,
    "count": 0,
    "elements": []
  }
}
```

### Tablet (768x1024) — Layout stress test

```json
"tablet": {
  "width": 768,
  "height": 1024,
  "screenshot": "/tmp/pixelslop-screenshots/tablet.png",
  "overflow": {
    "hasOverflow": true,
    "count": 1,
    "elements": [{ "tag": "table", "classes": "pricing-table", "overflowWidth": 892 }]
  }
}
```

Only screenshot + overflow check. Full extraction happens at desktop.

### Mobile (375x812) — Usability gauntlet

```json
"mobile": {
  "width": 375,
  "height": 812,
  "screenshot": "/tmp/pixelslop-screenshots/mobile.png",
  "overflow": {
    "hasOverflow": false,
    "count": 0,
    "elements": []
  },
  "touchTargets": {
    "totalInteractive": 24,
    "undersized": 3,
    "issues": [
      { "tag": "a", "text": "Terms", "width": 28, "height": 16 }
    ]
  }
}
```

Overflow + touch target audit. Touch targets need ≥44x44px.

---

## Console & Network

```json
"console": {
  "errors": [
    { "type": "error", "text": "Uncaught TypeError: Cannot read property 'map' of undefined", "url": "app.js:142" }
  ],
  "warnings": []
},
"network": {
  "failed": [
    { "url": "/api/config", "status": 500, "type": "xhr" },
    { "url": "/fonts/custom.woff2", "status": 404, "type": "font" }
  ]
}
```

Console errors and failed network requests. Secondary evidence — not scored directly, but specialists can reference them (e.g., failed font load affects typography score).

---

## Persona Checks

Pre-collected data that persona evaluation needs. Run during the desktop pass so specialists and the orchestrator's persona logic can reuse it without needing Playwright.

```json
"personaChecks": {
  "headingHierarchy": {
    "sequence": [1, 2, 2, 3, 2, 3, 3],
    "skips": [],
    "multipleH1": false
  },
  "landmarks": {
    "present": ["banner", "navigation", "main", "contentinfo"],
    "missing": []
  },
  "skipNav": {
    "exists": false,
    "target": null
  },
  "aboveFoldCta": {
    "exists": true,
    "text": "Get Started",
    "visible": true
  },
  "readingLevel": {
    "estimatedGrade": 8,
    "avgSentenceLength": 14,
    "avgWordLength": 5.2
  },
  "imageOptimization": {
    "totalImages": 6,
    "withoutDimensions": 2,
    "withoutLazy": 4,
    "largeImages": [{ "src": "/hero.png", "estimatedSize": "2.4MB" }]
  },
  "cognitiveDensity": {
    "sectionsAnalyzed": 5,
    "avgInteractivePerSection": 4,
    "maxInteractiveInSection": 12,
    "ctasInViewport": 3
  }
}
```

---

## Source Patterns

Only populated when `--root` is provided. Grep results from the S11-S16 source patterns in `ai-slop-patterns.md`.

```json
"sourcePatterns": [
  {
    "id": "S12",
    "name": "Placeholder Content Markers",
    "matches": 2,
    "files": ["src/components/Hero.tsx:14", "src/pages/About.tsx:8"],
    "evidence": "Lorem ipsum dolor sit amet"
  }
]
```

---

## Snippet-to-Field Mapping

| visual-eval.md Section | JS Snippet | Evidence Field |
|------------------------|-----------|----------------|
| Typography extraction | `(() => { const elements...` | `viewports.desktop.typography` |
| Color extraction | `(() => { const sampled...` | `viewports.desktop.colors` |
| Spacing extraction | `(() => { const containers...` | `viewports.desktop.spacing` |
| Decoration detection | `(() => { const all...` | `viewports.desktop.decorations` |
| Contrast calculation | `(() => { function luminance...` | `viewports.desktop.contrast` |
| Touch target audit | `(() => { const interactive...` | `viewports.mobile.touchTargets` |
| Overflow check | `(() => { const vw...` | `viewports.{viewport}.overflow` |
| Heading hierarchy | `browser_snapshot()` parsed | `personaChecks.headingHierarchy` |
| Landmark check | `browser_snapshot()` parsed | `personaChecks.landmarks` |

---

## Writing the Bundle

The evidence collector writes the bundle as:

```bash
/tmp/pixelslop-evidence-{timestamp}.json
```

If the bundle exceeds 200KB, that's expected — browser evidence is verbose. The tmpfile pattern matches the existing `@file:` convention used by pixelslop-tools for large output.

The collector returns the file path to the orchestrator. Each specialist receives this path in its prompt and reads the file directly.

---

## Reading the Bundle (Specialists)

Each specialist:
1. Reads the JSON file from the path in its prompt
2. Extracts only the fields relevant to its pillar
3. Reads its scoring rubric from `scoring.md`
4. Reads its domain resource file for interpretation hints
5. Returns a JSON score + findings

Specialists never see each other's output. They score independently. The orchestrator aggregates.
