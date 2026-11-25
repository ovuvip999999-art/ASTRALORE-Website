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
