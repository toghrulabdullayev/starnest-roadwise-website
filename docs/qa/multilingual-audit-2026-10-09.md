# Multilingual Website QA Report: Roadwise web

## 1. Executive summary

**Overall:** English is close to release quality. Russian and Azerbaijani work functionally, with the same routes, forms, validation and data as English. Both have defects that a visitor notices on the first screen.

**Most important risks**
1. **Headings in Russian render in the wrong font on every page (WEB-001, P1).** The display font has no Cyrillic glyphs, so Russian headings fall back to a thin, enlarged Arial. Lines crowd each other and the heavy punctuation doesn't match. In Azerbaijani, every "Ə" in a heading has the same problem.
2. **AI debriefs show internal identifiers to users (WEB-002, P1).** Every AI debrief, in all three languages, shows `compliance_rate`, `fines_azn`, `not_ready`, `minors`, `'stop_sign'` and similar keys in the Progress and Readiness sections. This is the product's core page.
3. **Russian and Azerbaijani visitors see English-only product screenshots on the landing page (WEB-006, P2).**
4. **Switching language on the login page is undone after login (WEB-004, P2).** You land back in the original language.

**Release readiness:** Not ready for a Russian or Azerbaijani audience until WEB-001 and WEB-002 are fixed. Each fix is small and has one root cause (see §8). Separately, the download link has to be configured in production (WEB-016).

## 2. Scope and coverage

- **URL:** `http://localhost:3000` (local `next dev`, Next 16.4.0). Not deployed yet (PLAN 7.3 blocked). Tested on branch `ai-pages` at commit `58d33d1`, 2026-10-09 around 17:00 Baku time.
- **Languages:** EN, RU, AZ. Identified from the language switcher (`nav[aria-label]` with EN/RU/AZ links), the URL prefix `/{en|ru|az}`, `<html lang>`, the redirect logic in `proxy.ts`, and `messages/{en,ru,az}.json`. Default `en`. No language is right-to-left.
- **Routes and journeys:** landing, download, login, signup, profile (empty and populated), drive debrief, quiz, device link, 404 and invalid locale. Journeys covered: sign-up, log-in with a return address, log-out, quiz, regenerating a debrief in the page language, building a practice plan, the device-link code page, switching language and using Back.
- **Viewports:** desktop at 1440×900 (real viewport about 1512×724 and 1440×724). Chrome's minimum window gives 500 px. Phone width was 390×844, tested with a same-origin iframe, since a Chrome window can't go below about 500 px. **Tablet 768 px: not tested.**
- **Tools:** Claude in Chrome (navigation, screenshots, DOM and JS inspection, console, network). `curl` for redirects and metadata. Source reading. `sqlite3` on the local dev database.
- **Setup changes (local only):** the dev database had only migration `0001` applied, so every logged-in page would have failed. I ran `npm run db:migrate` and `npm run seed:demo`; the seed called OpenRouter for its debriefs. A test account was created for the empty-state test and then deleted. The demo account now also has one quiz attempt, one practice plan and one regenerated AZ debrief.
- **Excluded or blocked:** downloading the game (`NEXT_PUBLIC_DOWNLOAD_URL` is unset locally). Approving a device (I stopped before "Authorise"). Revoking a device and saving the debrief language. Rate limits. Colour contrast was not measured. The game itself and the API contracts were out of scope.

## 3. Coverage matrix

Status meanings: **PASS** means all planned checks ran and none failed. **FAIL** means at least one check failed (IDs given). **PARTIAL** means only some checks ran, and those passed. **NOT TESTED** and **BLOCKED** mean what they say.
WEB-001 (fonts) affects every RU and AZ page and is not repeated in each cell.

| Route / journey | EN | RU | AZ |
|---|---|---|---|
| `/` landing | PASS | FAIL (006) | FAIL (006, 009) |
| `/download` | PARTIAL (016) | PARTIAL (016) | FAIL (009) |
| `/login` | FAIL (011) | NOT TESTED | PASS (login with return address) |
| `/signup` | NOT TESTED | PARTIAL (validation only) | PASS (validation, Unicode name, account created) |
| `/profile`, no drives | NOT TESTED | NOT TESTED | PASS |
| `/profile`, 7 drives | PARTIAL (phone width only) | FAIL (010) | FAIL (013, 014) |
| `/drives/[id]` | FAIL (002) | FAIL (002, 007) | FAIL (002, 003, 007, 008) |
| `/quiz` | PARTIAL (phone width only) | PARTIAL (phone width only) | FAIL (015) |
| `/link` | PARTIAL (empty form) | PARTIAL (unknown code) | PARTIAL (valid code, not approved) |
| 404 and invalid locale | FAIL (005) | FAIL (005) | FAIL (005) |
| Language switch and persistence | FAIL (004) | FAIL (004) | FAIL (004) |

## 4. Findings by severity

### P1

**WEB-001: Display font can't render Cyrillic or "Ə": Russian headings use thin, enlarged Arial; Azerbaijani "Ə" does the same**
- Category: localization / visual design. Languages: RU (all headings, buttons, tiles), AZ ("Ə"/"ə" only). Routes: all. Viewports: all.
- Steps: open `/ru`, then `/ru/download`, then `/az`.
- Expected: headings in the heavy display face in every language.
- Actual: RU headings render in a thin regular face, and heavy Archivo punctuation sits next to it ("«ЧТО».", "ПОЕЗДКЕ?"). "СКАЧАТЬ **ROADWISE**" mixes two weights. The RU hero's tall lines crowd each other: the "Ё" dots touch the line above. On AZ pages, every "Ə" in a heading ("NECƏ İŞLƏYİR", "TƏHLİL") is visibly thinner than the letters around it. RU date and distance tiles mix thin Cyrillic with heavy digits ("7 окт. 2026 г.").
- Evidence: canvas glyph test on `/az`. Archivo Black lacks Ə, ə, Ж, Ы, Щ, я. Archivo (body) lacks Cyrillic. Computed stack: `"Archivo Black", "Archivo Black Fallback", "Inter Tight", …`. The `@font-face "Archivo Black Fallback"` is `src: local("Arial"); size-adjust: 124.05%; ascent-override: 70.78%`. Screenshot: `screenshot-1791550708760-0.png` ("СКАЧАТЬ ROADWISE").
- Root cause: the fallback faces that `next/font` generates are local Arial with no `unicode-range`. They sit before Inter Tight in both stacks (`lib/fonts.ts`), so Arial supplies Cyrillic and Ə and Inter Tight is never used. Inter Tight is also loaded with `cyrillic` subsets only, so it wouldn't cover Ə anyway.
- Impact: every RU page, and AZ headings, look broken or unfinished. RU readers form half of the target audience.
- Suggested fix: put the Inter Tight variable before the generated fallback (or set `adjustFontFallback: false` on Archivo and Archivo Black). Add `latin-ext` to Inter Tight so it covers Ə. Alternatively, pick a display face with Cyrillic and Ə. Re-check the hero `line-height` in RU afterwards.
- Confidence: high.

**WEB-002: AI debriefs show internal keys and enum values to users**
- Category: localization / content (AI). Languages: ALL. Route: `/{l}/drives/[id]` (every AI debrief). The RU practice plan on `/ru/profile` shows it too.
- Steps: open `/az/drives/528b15e1-…` or `/ru/drives/c98725c9-…` and read Progress and Readiness.
- Expected: localized labels ("Qaydalara riayət", "Соблюдение правил", "Exam ready").
- Actual:
  - Progress list: `compliance_rate`, `fines_azn`, `overspeed_time_share`, `harsh_per_10min`, `composure_index`, `speeding`, `stop_sign`, `pedestrian_crossing`, `red_light`.
  - Readiness text: RU "(категория almost) … компоненты minors (-13.4 очка) и compliance". AZ "'not_ready' kateqoriyasındadır … majors (-25), minors (-11.3) və compliance". EN "result in a not_ready assessment".
  - Drills: AZ "'stop_sign' və piyada keçidi nəzarəti", "'give_way' qaydasına uyğun".
- Evidence: page text from 4 debriefs (EN, RU, AZ ×2, including a freshly regenerated AZ one). `components/drive/DriveExplorer.tsx:384-400` renders `d.progress.*` strings from the model as they are. The template fallback (`lib/instructor/fallback.ts:90`) maps keys through `dict.history.keys`, so only the AI path is affected. `lib/instructor/grounding.ts` doesn't reject snake_case identifiers.
- Impact: the core feature reads like debug output, and RU and AZ users get English jargon.
- Suggested fix: build the Progress list in code from `history` with dictionary labels, and let the model write prose only. Add a grounding check that rejects `/\b[a-z]+_[a-z_]+\b/` and the band and component enum values in any text field, then retry or fall back. Pass localized band and component names into the prompt instead of keys.
- Confidence: high.

### P2

**WEB-004: Switching language on the login page is undone after login**
- Category: localization / functionality. Languages: ALL. Route: `/{l}/login?next=…`.
- Steps: log out, open `/az/profile` (you are redirected to `/az/login?next=/az/profile`), click **EN**, then log in.
- Expected: land on `/en/profile`.
- Actual: you land on `/az/profile`. The switcher link is `/en/login?next=%2Faz%2Fprofile`, and `safeNext()` redirects to it unchanged (`app/actions/auth.ts:72-84`).
- Impact: the visitor's explicit language choice is lost at the most common entry point.
- Suggested fix: when switching locale, or in `safeNext`, replace the leading `/{locale}/` of `next` with the page's locale.
- Confidence: high (reproduced end to end).

**WEB-006: Landing-page product screenshots are English-only in RU and AZ**
- Category: localization. Languages: RU, AZ. Route: `/ru`, `/az`.
- Actual: the hero image and all four "What you get" images show English UI ("EXAM READINESS", "ROUTE", "PROGRESS PER DRIVE", "Running a red light on …"). Captions and `alt` text are localized; the images are not.
- Impact: the first impression contradicts the language the visitor chose, and the images promise an English product.
- Suggested fix: capture RU and AZ versions of each screenshot, or pick by locale; the seeded demo account can produce them.
- Confidence: high.

**WEB-016: Download link not configured, so the main "Download the game" button leads nowhere**
- Category: functionality / configuration. Languages: ALL. Route: `/{l}/download`.
- Actual: "The download link is not configured yet." `NEXT_PUBLIC_DOWNLOAD_URL` is unset in `.env.local` (`app/[locale]/download/page.tsx:16`).
- Impact: if it stays unset in production, the main call to action is a dead end. This becomes P1 at that point.
- Suggested fix: set `NEXT_PUBLIC_DOWNLOAD_URL` (and `NEXT_PUBLIC_GAME_VERSION`) in Vercel before launch.
- Confidence: high locally; production status unknown.

### P3

**WEB-003: Debrief card marks its own headings with the debrief's language**
- Languages: AZ, RU, or EN when the debrief language differs from the page. Route: `/az/drives/5e052c29-…` (EN debrief).
- Actual: `<article lang={debrief.locale}>` (`DriveExplorer.tsx:299`) wraps the localized section headings. With `text-transform: uppercase`, AZ headings uppercase with English rules: "DÜZƏLDILMƏLI OLANLAR", "İRƏLILƏYIŞ", "NÖVBƏTI SÜRÜŞ". They should be "…DİLMƏLİ…", "İRƏLİLƏYİŞ", "NÖVBƏTİ". Screen readers also announce them with the English voice.
- Suggested fix: put `lang={debrief.locale}` only on the model-written text nodes, not on the article.

**WEB-005: 404 and invalid-locale pages are English-only dead ends**
- Steps: open `/ru/nope`, `/fr` or `/EN`.
- Actual: the Next.js default "404: This page could not be found." in English. There's no `<html lang>`, header, nav, language switcher or way back. `/fr` redirects to `/{cookie-locale}/fr`, which is a 404.
- Suggested fix: add `app/[locale]/not-found.tsx` with the site layout. Optionally redirect unknown locale prefixes to `/{locale}{rest}`.

**WEB-007: Units are hard-coded in English and mixed on one page**
- Actual: RU drive page shows "1,8 km", "41,7 km/h", "74 / 60 km/h" next to "+11 км/ч" and AI text "74 км/ч". AZ shows "km/h" next to "km/saat" (legend, quiz). AI text in AZ writes "60 kmh".
- Source: `components/drive/MetricGroups.tsx:12`, `app/[locale]/drives/[id]/page.tsx:45`, `lib/i18n/format.ts:14`.
- Suggested fix: move the units into the dictionaries and give the model the localized unit.

**WEB-008: District slug shown raw in the drive title**
- Actual: "SƏRBƏST SÜRÜŞ · BAKU-CENTER" and "СВОБОДНАЯ ЕЗДА · BAKU-CENTER". `drive.district` is printed as stored (`page.tsx:71`), so EN shows the slug too (from source, not checked on screen).
- Suggested fix: add a district name map to the dictionaries.

**WEB-009: Brand name uppercased as "ROADWİSE" on AZ pages**
- Actual: the logo and "ROADWİSE-I YÜKLƏ" use a dotted İ, because `text-transform: uppercase` follows `lang="az"`.
- Suggested fix: wrap the brand in `<span lang="en">` or write it in capitals in the source.

**WEB-010: Model output ignores locale formatting and terminology**
- Actual: RU and AZ use point decimals ("-9.7 xal", "-13.4 очка") where the UI uses commas ("−9,7 bal"). AZ uses "xal" where the UI says "bal", and "yürüş" where it says "sürüş". The RU plan puts ISO dates in prose ("в последний раз 2026-10-07"). The RU plan also changes the STOP drill to "паузы в две секунды" where the catalog says one second. Numbers written as words get past the number check.
- Suggested fix: pass pre-formatted localized numbers and dates and a glossary to the prompt. Extend the grounding check to number words.
- Confidence: medium (REVIEW NEEDED for wording).

**WEB-011: Empty login says "Email or password is incorrect."**
- Route: `/en/login`. Submitting with both fields empty shows the credentials error. Sign-up handles empty fields with "Enter your name." and similar messages.
- Suggested fix: validate required fields first and reuse the sign-up field errors.

**WEB-012: Focus isn't moved after a failed form submission**
- Route: `/ru/signup` after an empty submit. `document.activeElement` is `BODY`. Field errors are linked correctly (`aria-invalid`, `aria-describedby`); only focus management is missing.
- Suggested fix: focus the first invalid field.

**WEB-013: Badges and values wrap in narrow table cells**
- AZ exam history: the "×" and "KEÇMƏDİ" split onto two lines. RU timeline: "74 / 60 km/h" wraps "km/h".
- Suggested fix: add `white-space: nowrap` on badges and values.

**WEB-014: The AZ "Aç" link is 18 px wide**
- Route: `/az/profile` drive table. The link is 18×44 px, below the 24 px minimum target size.
- Suggested fix: give it a minimum width or padding.

**WEB-015: Quiz question templates read awkwardly; page heading repeats**
- Actual: "İmtahanda bu səhv necə qiymətləndirilir: Toqquşma?", "Bu ərazidə sürət həddi nə qədərdir: yaşayış zonası?", EN "What is the fine for this fault: Collision?". Capitalization is inconsistent: rule names are capitalized, zone names aren't. The quiz page shows the eyebrow and title as the same word ("TEST / TEST").
- Suggested fix: write one sentence per rule in the bank rather than using templates. Drop or rename the eyebrow. REVIEW NEEDED by a native speaker.

**WEB-017: No `hreflang`, canonical or Open Graph tags**
- Every page per locale reuses the same `meta description`. The 404 page has no description.
- Suggested fix: use `generateMetadata` with `alternates.languages` and `canonical`, and per-page descriptions.

**WEB-018: Translation consistency items (REVIEW NEEDED)**
- AZ `learn.planAi` says "Süni intellektli **instruktor** yazıb"; everywhere else uses "təlimatçı".
- RU `profile.points` gives "−9,7 балл.", an unusual abbreviation that ignores plural forms.
- EN mixes "Sign in to the game" and "Log in". EN has "time(s)" and "fault(s)" with no plural handling (`plan.why`, `learn.compareFaults`).
- AZ `landing.problemBody` switches person mid-sentence ("onlara … biləcəyinizi"). The EN source does the same.
- AZ `download.unsignedBody` quotes "«Hər halda işə sal»". Check it matches the real Windows AZ label.

## 5. Language-by-language review

- **EN:** complete. British spelling is used consistently. Issues: raw keys in AI text (002), "Log in" vs "Sign in" (018), unhandled plurals (018). The layout is clean at 1440 px and 390 px.
- **RU:** all 387 keys present, no placeholder mismatches, no leftover English UI text. The translation reads naturally (dates "7 окт. 2026 г.", decimal comma). Issues: the font (001), English screenshots (006), "km" and "km/h" units (007), AI text with keys and point decimals (002, 010), "балл." (018). Long strings fit: CTA buttons stack at desktop width, which is acceptable.
- **AZ:** all keys present. Dotted İ and dotless ı are handled correctly when `lang="az"`. Dates "9 okt 2026". Issues: the "Ə" glyph (001), "ROADWİSE" (009), English uppercasing inside the debrief card (003), "km/h" vs "km/saat" vs "kmh" (007), "xal" vs "bal" and "yürüş" (010), "instruktor" vs "təlimatçı" (018), awkward quiz templates (015). Long AZ strings fit everywhere except the narrow exam-history badge (013).
- **Static check of `messages/*.json`:** key sets are identical (the only extra key is `_review` in RU and AZ). Placeholders match in every string. No RU or AZ value was left in English, apart from intentional brand, STOP and AZN.

## 6. Design and responsive review

- **Desktop:** strong, consistent bold system: borders, offset shadows, mono eyebrows. Hierarchy is clear on the profile and drive pages, and deterministic numbers are clearly separated from AI text.
- **Phone width (390 px):** no page-level horizontal scroll on any tested route in any language. Wide tables scroll inside their own box but show no hint that more columns exist (subjective). The header wraps to two rows with the language switcher still visible.
- **Subjective recommendations, not defects:**
  - "What you get" grid: the tall Route image next to the short readiness image leaves a large empty area.
  - The landing caption "select one to see it in the timeline" sits on a static image.
  - The quiz column is narrower than the header grid.
  - "↓Improving" has no space after the arrow, and a down arrow meaning "better" can confuse.

## 7. Accessibility and technical health

**Checks run (all passed unless an ID is given):**
- `<html lang>` per locale (fails on 404 pages: 005; debrief card: 003).
- On the AZ landing page: landmarks (header, labelled main and language navs, main, footer), one `h1` with ordered `h2`/`h3`, no duplicate IDs, no unnamed controls.
- A skip link that appears on focus (from source).
- Localized `alt` on landing images.
- Labelled inputs, `aria-invalid` with `aria-describedby` on field errors, `role="alert"` on form errors.
- Visible 3 px focus ring and logical Tab order on the landing header.
- `aria-current` on the active language.
- Target size at 390 px (014).

**Not run:** colour-contrast measurement, 200% zoom and text resizing, full keyboard pass through the quiz and map, and testing with a real screen reader. This is not a WCAG conformance claim.

**Runtime:**
- No console errors or exceptions on profile, drive, quiz, link and download. Landing pages were only loaded in the iframe, where console output wasn't captured.
- The API calls I captured (regenerate, debrief polling) returned 200. The quiz and plan actions finished without errors.
- Regenerate shows a localized pending state and finishes in about 15 s.
- Redirects: `/` goes to cookie, then Accept-Language, then `en` (az, ru, en, de→en, tr+az→az all correct). `/en/` returns 308 to `/en`. Protected routes return 307 to the login page with a return address.

## 8. Recommended fix order

1. **WEB-001 (fonts):** one change in `lib/fonts.ts` fixes every RU page and all AZ headings. It's the biggest visible gain for the least work.
2. **WEB-002, then WEB-010:** build the Progress list in code, reject identifiers in grounding, and pass localized labels, numbers and units to the prompt. This fixes the core page in all languages, and both changes touch the same prompt and validator.
3. **WEB-016:** set the download URL in Vercel. It's config only, and it blocks the main call to action.
4. **WEB-004:** rewrite the locale of `next` in one place. It keeps the language people choose.
5. **WEB-006:** localized screenshots, taken after 1 and 2 so they show the fixed UI.
6. **WEB-007, WEB-008, WEB-003, WEB-009:** dictionary units and district names, and `lang` placement. These are small and touch the same pages.
7. **WEB-005, WEB-017:** localized not-found page and metadata.
8. **WEB-011 to WEB-015, WEB-018:** form polish, target size, wrapping, quiz copy, and a native-speaker pass on the REVIEW NEEDED items.

## 9. Test summary

- **Coverage cells:** 33. 4 PASS, 16 FAIL, 9 PARTIAL, 4 NOT TESTED, 0 BLOCKED. WEB-001 also affects every RU and AZ cell.
- **Findings:** 18 (2 P1, 3 P2, 13 P3), plus subjective design notes in §6.
- **Known limitations:**
  - Local dev server only, not a production build.
  - No 768 px tablet run.
  - Phone width was tested in an iframe, not with device emulation.
  - AI output was sampled from 4 debriefs and 1 plan.
  - Translation judgements marked REVIEW NEEDED need a native speaker.
- **Regression checks after fixes:**
  - Glyph test (Archivo Black, Ə and Cyrillic) and visual check of `/ru` hero and `/ru/download` heading.
  - Regenerate one debrief per locale and grep the page for `_` identifiers and `not_ready|almost|minors|majors`.
  - Login journey: `/az/profile`, switch to EN, log in, expect `/en/profile`.
  - Visit `/ru/nope`.
  - Check units on `/ru/drives/<id>`.
  - At 390 px, check horizontal overflow on all routes in all locales.
