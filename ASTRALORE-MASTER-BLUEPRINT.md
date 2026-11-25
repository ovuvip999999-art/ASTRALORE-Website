# ASTRALORE — Master Blueprint

**Project vision:** A cinematic, anime-inspired interactive knowledge universe where people can discover science, space, history, mythology, technology and fictional worlds through trustworthy content, visual explanations and hands-on exploration.

**Product principle:** ASTRALORE should feel like an interactive digital museum and learning playground—not a page full of empty cards. Every visible feature must work, teach something, or clearly indicate that it is coming soon.

---

## 1. Product pillars

### A. Universe Explorer
- Solar System overview and interactive 3D planet models
- Individual planet, moon, star, galaxy and black-hole profiles
- Space missions, spacecraft, telescopes and exploration history
- Cosmic phenomena explainers
- Scale comparisons and space timelines

### B. Science Laboratory
- Physics explainers and safe visual simulations
- Chemistry: elements, periodic table, molecules and reactions
- Biology: cells, genetics, DNA and evolution
- Human-body learning models: heart, brain, lungs, skeleton and organs
- Earth science, weather, oceans and natural processes
- Scientific instruments, inventions and discoveries

### C. History, Mythology & Civilizations
- Ancient civilizations and historical timelines
- Indian history, architecture and cultural heritage
- World mythology and legends, clearly distinguished from historical evidence
- Archaeology, monuments and historical mysteries
- 3D reconstructions where sources and accuracy allow

### D. Anime & Fiction Lab
- Science behind fictional abilities and worlds
- Fiction-versus-reality explainers
- Original ASTRALORE stories and characters
- Anime-inspired visual storytelling
- Clearly label fictional material and real-world science

### E. Interactive Learning Zone
- Daily quizzes and topic-based quizzes
- Brain teasers, puzzles and knowledge challenges
- Flashcards and revision mode
- Progress, achievements and optional streaks
- Explain-the-answer feedback, not just scores

### F. Knowledge Library
- Searchable articles and explainers
- Topic collections, glossary and beginner guides
- Related-topic recommendations
- Bookmarks and recently viewed items
- Sources and further reading for factual articles

### G. ASTRA AI
- Ask questions across the knowledge library
- Explain concepts at beginner or advanced levels
- Summarize articles and define terms
- Help users understand 3D models and simulations
- Suggest related topics and quizzes
- Clearly communicate uncertainty and avoid inventing sources

### H. Community & Channel
- ASTRALORE YouTube Shorts and video archive
- Featured episodes and topic playlists
- Suggestions for future topics
- Community participation only where moderation and privacy can be handled responsibly

---

## 2. 3D and simulation programme

3D should be introduced progressively and loaded only when requested.

**Initial experiences**
1. Solar System: inspect and rotate planet models; show factual profiles and comparisons.
2. Human anatomy: labelled educational organ models.
3. Molecular world: DNA, atoms and molecular structures.
4. Ancient architecture: selected monuments and reconstructions.

**Later experiences**
- Interactive Earth layers and geography
- Moon phases and eclipses
- Orbits and gravity demonstrations
- Cell and plant-cell models
- Physics visualizations
- Historical site walkthroughs

**Implementation principles**
- Prefer lightweight, optimized assets and lazy loading.
- Provide a 2D fallback or explanation if 3D is unsupported.
- Support mouse, keyboard and touch controls.
- Include labels, descriptions and accessible controls.
- Avoid autoplaying heavy scenes.
- Explain when a model is simplified and not to scale.
- Use licensed, public-domain or original assets; record attribution where required.

Potential technology: Three.js for custom interactive scenes; model-viewer for straightforward 3D model viewing. Choose per feature rather than loading a large 3D framework everywhere.

---

## 3. Website information architecture

### Main navigation
- Home
- Explore
- 3D Lab
- Learn
- Quizzes
- Videos
- ASTRA

### Home page sections
1. Cinematic hero and clear introduction
2. Daily Discovery / Fact of the Day
3. Explore the Knowledge Universe
4. Featured interactive experience
5. Trending and recently added discoveries
6. Science and space highlights
7. Featured videos / Shorts
8. Quiz of the day
9. ASTRA introduction
10. About ASTRALORE and footer

### Explore hub
A searchable, filterable directory of all knowledge categories and collections.

### 3D Lab
A dedicated gallery of interactive models and simulations with clear device/performance notes.

### Learn hub
Articles, explainers, glossaries, topic paths and curated collections.

### Quizzes hub
Daily quiz, category quizzes, challenge modes and explanations.

### Video hub
Existing Shorts archive plus future long-form episodes.

### ASTRA page
Keep the existing dedicated assistant page and connect it to the wider library over time.

---

## 4. Feature requirements

- Global search should return useful results across facts, articles, models, quizzes and videos as those collections are added.
- Filters must show accurate results and never hide content accidentally.
- Every card must open a real detail view or a clearly labelled coming-soon page.
- Each factual entry should have a concise explanation, category and trustworthy references where appropriate.
- Interactive experiences must have instructions and a reset control.
- Save/bookmark features should be added only with a clear, privacy-conscious storage approach.
- No fake statistics, fake user counts, fake leaderboards or fabricated community activity.
- No broken links, dead buttons or placeholder content presented as complete.
- Respect reduced-motion preferences and provide readable contrast.
- Keep the site usable on mobile and modest laptops.

---

## 5. Delivery roadmap

### V12 — Content Universe
- Expand the homepage with meaningful discovery areas.
- Add the Explore hub and category structure.
- Add real starter content and topic detail pages.
- Improve search and navigation without breaking existing features.

### V13 — 3D Explorer
- Add the 3D Lab landing page.
- Launch the first optimized Solar System experience.
- Add model information, controls, loading states and 2D fallback.
- Measure performance before adding more models.

### V14 — Interactive Learning
- Add quizzes, explanations, flashcards and brain challenges.
- Add progress tracking with privacy-conscious defaults.

### V15 — Knowledge Library
- Add article pages, glossary, collections, related topics and references.
- Expand search across the library.

### V16 — ASTRA Integration
- Connect ASTRA to verified ASTRALORE content.
- Add topic-aware explanations and model assistance.
- Make citations and uncertainty visible where relevant.

### V17 — Personal Discovery & Community
- Add optional bookmarks and learning preferences.
- Add moderated topic suggestions and community features only when ready.

### V18 — Quality & Expansion
- Accessibility, mobile, browser and performance audit.
- Content accuracy and source audit.
- Improve reliability, security and maintainability.
- Expand 3D and simulation catalogue based on actual performance.

---

## 6. Technical guardrails

- Preserve the working V11 website as the baseline.
- Keep the existing fact modal, search, filters, video archive and ASTRA launcher working.
- Avoid unnecessary rewrites of the existing JavaScript.
- Add features in small, testable changes.
- Keep the GitHub Pages frontend and Cloudflare Worker backend independently deployable.
- Never put private credentials or secrets in frontend files or Git history.
- Test desktop and mobile layouts after each meaningful release.
- Test on modest integrated graphics; load heavy assets only on demand.
- Keep a changelog and document new routes, files and dependencies.

---

## 7. Definition of done

A release is not complete merely because it looks attractive. It must:
- Load without console-breaking errors.
- Work on desktop and mobile.
- Have functioning navigation and controls.
- Preserve all previously working features.
- Use real content rather than empty placeholders.
- Have appropriate source attribution and asset rights.
- Offer sensible loading, error and empty states.
- Be checked on the live GitHub Pages site after deployment.

---

## 8. First implementation task

Start V12 by auditing the current V11 HTML, CSS and JavaScript. Map the existing sections and IDs, then add the Explore hub and content architecture while preserving all current working interactions. Do not add every planned feature at once. Build the foundation first, then populate it with verified content and working experiences.

**North star:** Make ASTRALORE a place where curiosity turns into exploration—and exploration turns into understanding.
