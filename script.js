const facts = {
  venus: {category:"SPACE / PLANETARY SCIENCE", index:"FILE // 001", title:"A Day Longer Than a Year", text:"Venus rotates very slowly. One rotation takes about 243 Earth days, while one orbit around the Sun takes about 225 Earth days. That means a Venusian sidereal day is longer than its year."},
  octopus: {category:"SCIENCE / OCEAN LIFE", index:"FILE // 002", title:"Three Hearts, Blue Blood", text:"An octopus has three hearts. Two move blood through the gills, while the third pumps it to the rest of the body. Its blood appears blue because it uses a copper-containing oxygen-carrying protein called hemocyanin."},
  ocean: {category:"MYSTERIES / DEEP OCEAN", index:"FILE // 003", title:"Worlds Beneath the Waves", text:"The deep ocean is challenging to study because of darkness, pressure and distance. Scientists continue to discover unfamiliar species and ecosystems, so the seafloor still holds many open questions."},
  anime: {category:"ANIME WORLD / STORYTELLING", index:"FILE // 004", title:"Worlds Beyond Reality", text:"Great fictional worlds often begin with a question: what if gravity worked differently, memories could be stored, or a civilisation lived among the stars? ASTRALORE explores the real ideas that can inspire extraordinary stories."},
  blackhole: {category:"SPACE / COSMOLOGY", index:"FILE // 005", title:"Where Light Cannot Escape", text:"A black hole is a region of spacetime whose gravity is so strong that nothing can escape from inside its event horizon—not even light. The event horizon is a boundary, not a solid surface."},
  dna: {category:"BIOLOGY / GENETICS", index:"FILE // 006", title:"The Code Inside Cells", text:"DNA stores hereditary information in living organisms. Its familiar double-helix structure is built from two strands, with specific base pairs connecting them. Cells use genetic information to help make the molecules needed for life."},
  lightning: {category:"PHYSICS / ELECTRICITY", index:"FILE // 007", title:"A Spark Across the Sky", text:"Lightning is an electrical discharge caused by the separation and buildup of electric charges, commonly inside storm clouds or between clouds and the ground. The bright flash heats nearby air very rapidly, producing the sound we hear as thunder."},
  bluesky: {category:"EARTH / ATMOSPHERE", index:"FILE // 008", title:"Why the Sky Looks Blue", text:"Sunlight contains many colours. Molecules in Earth's atmosphere scatter shorter blue wavelengths more strongly than longer red wavelengths. This process is called Rayleigh scattering."}
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
document.querySelectorAll("[data-v12-filter]").forEach(button=>button.addEventListener("click",()=>{
  activeFilter=button.dataset.v12Filter;
  filters.forEach(b=>b.classList.toggle("active",b.dataset.filter===activeFilter));
  updateArchive();
  document.getElementById("explore").scrollIntoView({behavior:"smooth",block:"start"});
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


/* ASTRALORE ambient comet field — lightweight canvas effect */
(()=>{
  const backdrop=document.querySelector('.cosmic-backdrop');
  if(!backdrop || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas=document.createElement('canvas');
  canvas.className='comet-canvas';
  canvas.setAttribute('aria-hidden','true');
  backdrop.appendChild(canvas);
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx) return;
  let width=0,height=0,dpr=1,raf=0,last=0;
  const comets=[];
  const count=9;
  const rand=(a,b)=>a+Math.random()*(b-a);
  function resize(){
    const rect=backdrop.getBoundingClientRect();
    width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    dpr=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.style.width=width+'px';canvas.style.height=height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function reset(c,initial=false){
    c.x=rand(-width*.15,width*1.05);
    c.y=initial?rand(-height*.1,height):rand(-height*.35,-20);
    c.length=rand(24,66);c.speed=rand(35,85);
    c.size=rand(.7,1.45);c.alpha=rand(.38,.82);
    c.phase=rand(0,Math.PI*2);
  }
  function init(){resize();comets.length=0;for(let i=0;i<count;i++){const c={};reset(c,true);comets.push(c);}}
  function draw(now){
    raf=requestAnimationFrame(draw);
    const dt=Math.min(.04,(now-last)/1000||0);last=now;
    ctx.clearRect(0,0,width,height);
    for(const c of comets){
      c.x+=c.speed*dt;c.y+=c.speed*.48*dt;c.phase+=dt*2;
      const shimmer=.72+.28*Math.sin(c.phase);
      const grad=ctx.createLinearGradient(c.x-c.length,c.y-c.length*.48,c.x,c.y);
      grad.addColorStop(0,'rgba(154,135,255,0)');
      grad.addColorStop(.65,'rgba(170,185,255,'+(c.alpha*.35*shimmer)+')');
      grad.addColorStop(1,'rgba(255,255,255,'+(c.alpha*shimmer)+')');
      ctx.save();ctx.lineCap='round';ctx.strokeStyle=grad;
      ctx.shadowBlur=12;ctx.shadowColor='rgba(151,133,255,.9)';
      ctx.lineWidth=c.size;ctx.beginPath();
      ctx.moveTo(c.x-c.length,c.y-c.length*.48);ctx.lineTo(c.x,c.y);ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,'+(c.alpha*shimmer)+')';
      ctx.shadowBlur=9;ctx.beginPath();ctx.arc(c.x,c.y,c.size*1.15,0,Math.PI*2);ctx.fill();
      ctx.restore();
      if(c.x>width+90||c.y>height+90) reset(c);
    }
  }
  init();
  const observer=new ResizeObserver(resize);observer.observe(backdrop);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){cancelAnimationFrame(raf);raf=0;}
    else if(!raf){last=0;raf=requestAnimationFrame(draw);}
  });
  raf=requestAnimationFrame(draw);
})();
