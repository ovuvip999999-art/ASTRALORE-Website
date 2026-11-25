const facts = {
  venus: {category:"SPACE / PLANETARY SCIENCE", index:"FILE // 001", title:"A Day Longer Than a Year", text:"Venus rotates very slowly. One rotation takes about 243 Earth days, while one orbit around the Sun takes about 225 Earth days. That means a Venusian sidereal day is longer than its year."},
  octopus: {category:"SCIENCE / OCEAN LIFE", index:"FILE // 002", title:"Three Hearts, Blue Blood", text:"An octopus has three hearts. Two move blood through the gills, while the third pumps it to the rest of the body. Its blood appears blue because it uses a copper-containing oxygen-carrying protein called hemocyanin."},
  ocean: {category:"MYSTERIES / DEEP OCEAN", index:"FILE // 003", title:"Worlds Beneath the Waves", text:"The deep ocean is challenging to study because of darkness, pressure and distance. Scientists continue to discover unfamiliar species and ecosystems, so the seafloor still holds many open questions."},
  anime: {category:"ANIME WORLD / STORYTELLING", index:"FILE // 004", title:"Worlds Beyond Reality", text:"Great fictional worlds often begin with a question: what if gravity worked differently, memories could be stored, or a civilisation lived among the stars? ASTRALORE explores the real ideas that can inspire extraordinary stories."}
};
const search = document.getElementById("searchInput");
const cards = [...document.querySelectorAll(".fact-card")];
const filters = [...document.querySelectorAll(".filter[data-filter]")];
const count = document.getElementById("resultCount");
const empty = document.getElementById("emptyState");
let activeFilter = "all";
function updateArchive(){
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  cards.forEach(card=>{
    const category = card.dataset.category;
    const matchCategory = activeFilter === "all" || category === activeFilter;
    const matchText = !q || (card.dataset.search + " " + card.innerText).toLowerCase().includes(q);
    const visible = matchCategory && matchText;
    card.hidden = !visible;
    if(visible) shown++;
  });
  count.textContent = String(shown).padStart(2,"0")+" DISCOVER"+(shown===1?"Y":"IES");
  empty.hidden = shown !== 0;
}
filters.forEach(btn=>btn.addEventListener("click",()=>{
  activeFilter=btn.dataset.filter;
  filters.forEach(b=>b.classList.toggle("active",b===btn));
  updateArchive();
}));
search.addEventListener("input",updateArchive);
search.addEventListener("keydown",e=>{if(e.key==="Enter") document.getElementById("factGrid").scrollIntoView({behavior:"smooth",block:"start"});});
document.getElementById("clearSearch").addEventListener("click",()=>{search.value="";updateArchive();search.focus();});
document.getElementById("resetFilters").addEventListener("click",()=>{activeFilter="all";search.value="";filters.forEach(b=>b.classList.toggle("active",b.dataset.filter==="all"));updateArchive();});
const modal=document.getElementById("modal");
function openFact(key){
  const fact=facts[key]; if(!fact)return;
  document.getElementById("modalCategory").textContent=fact.category;
  document.getElementById("modalIndex").textContent=fact.index;
  document.getElementById("modalTitle").textContent=fact.title;
  document.getElementById("modalText").textContent=fact.text;
  modal.hidden=false; document.body.style.overflow="hidden"; document.getElementById("modalClose").focus();
}
function closeFact(){modal.hidden=true;document.body.style.overflow="";}
document.querySelectorAll("[data-open]").forEach(btn=>btn.addEventListener("click",()=>openFact(btn.dataset.open)));
document.getElementById("modalClose").addEventListener("click",closeFact);
modal.addEventListener("click",e=>{if(e.target===modal)closeFact();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!modal.hidden)closeFact();});
const menuToggle=document.getElementById("menuToggle"), nav=document.getElementById("nav");
menuToggle.addEventListener("click",()=>{const open=nav.classList.toggle("open");menuToggle.setAttribute("aria-expanded",String(open));});
nav.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{nav.classList.remove("open");menuToggle.setAttribute("aria-expanded","false");}));
const sections=[...document.querySelectorAll("main section[id]")];
if("IntersectionObserver" in window){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){document.querySelectorAll(".nav-link").forEach(a=>a.classList.toggle("active",a.getAttribute("href")==="#"+entry.target.id));}}),{rootMargin:"-35% 0px -55% 0px"});
  sections.forEach(section=>observer.observe(section));
}
updateArchive();

/* V7 — instant category filtering for the video archive */
(() => {
  const filterBar = document.getElementById("videoCategoryFilters");
  const videoCards = [...document.querySelectorAll(".video-card[data-video-category]")];
  const status = document.getElementById("videoFilterStatus");
  if (!filterBar || !status || !videoCards.length) return;
  const buttons = [...filterBar.querySelectorAll("[data-video-filter]")];
  function applyVideoFilter(category) {
    let visible = 0;
    videoCards.forEach(card => {
      const show = category === "all" || card.dataset.videoCategory === category;
      card.hidden = !show;
      if (show) visible++;
    });
    buttons.forEach(button => {
      const active = button.dataset.videoFilter === category;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const label = category === "all" ? "ALL" : category.toUpperCase();
    status.textContent = "SHOWING " + label + " — " + visible + " VIDEO" + (visible === 1 ? "" : "S");
  }
  buttons.forEach(button => button.addEventListener("click", () => applyVideoFilter(button.dataset.videoFilter)));
  applyVideoFilter("all");
})();

/* V4 — lightweight pointer particles and scroll reveal */
(() => {
  const finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (finePointer && !reducedMotion) {
    const glow = document.createElement("div");
    glow.id = "astralore-cursor-glow";
    document.body.appendChild(glow);
    const dots = [];
    for (let i = 0; i < 12; i++) {
      const dot = document.createElement("span");
      dot.className = "astralore-cursor-dot";
      dot.style.setProperty("--dot-opacity", String(0.55 - i * 0.032));
      document.body.appendChild(dot);
      dots.push({ el: dot, x: innerWidth / 2, y: innerHeight / 2, ease: 0.22 + i * 0.045 });
    }
    let pointerX = innerWidth / 2, pointerY = innerHeight / 2, raf = 0;
    const move = event => {
      pointerX = event.clientX; pointerY = event.clientY;
      document.body.classList.add("astralore-cursor-active");
      glow.style.transform = `translate3d(${pointerX}px,${pointerY}px,0) translate(-50%,-50%)`;
      if (!raf) raf = requestAnimationFrame(animate);
    };
    function animate() {
      raf = 0;
      let x = pointerX, y = pointerY;
      dots.forEach((dot, index) => {
        dot.x += (x - dot.x) * dot.ease;
        dot.y += (y - dot.y) * dot.ease;
        dot.el.style.transform = `translate3d(${dot.x}px,${dot.y}px,0) translate(-50%,-50%) scale(${1 - index * 0.045})`;
        x = dot.x; y = dot.y;
      });
      if (dots.some(dot => Math.abs(pointerX - dot.x) > 0.5 || Math.abs(pointerY - dot.y) > 0.5)) raf = requestAnimationFrame(animate);
    }
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("blur", () => document.body.classList.remove("astralore-cursor-active"));
    document.addEventListener("visibilitychange", () => { if (document.hidden) document.body.classList.remove("astralore-cursor-active"); });
  }
  const targets = [...document.querySelectorAll(".section-top, .search-panel, .results-line, .fact-card, .videos-heading, .video-card, .video-archive-foot, .episode-visual, .episode-copy, .about-section > *, .footer > *")];
  targets.forEach((el, i) => {
    el.classList.add("js-reveal");
    if (el.classList.contains("fact-card")) el.style.transitionDelay = (i % 4) * 75 + "ms";
  });
  if ("IntersectionObserver" in window && !reducedMotion) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -35px 0px" });
    targets.forEach(el => observer.observe(el));
  } else targets.forEach(el => el.classList.add("is-visible"));
})();
