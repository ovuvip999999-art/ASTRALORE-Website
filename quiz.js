const questionBank=[
{category:"space",q:"Which planet has a day that lasts longer than its year?",a:["Mars","Venus","Mercury","Jupiter"],correct:1,why:"Venus takes about 243 Earth days to rotate once, but about 225 Earth days to orbit the Sun."},
{category:"space",q:"What is the boundary around a black hole beyond which light cannot escape called?",a:["The photosphere","The asteroid belt","The event horizon","The corona"],correct:2,why:"The event horizon is the boundary beyond which escape is not possible."},
{category:"space",q:"Which star is at the centre of our Solar System?",a:["Sirius","Polaris","The Sun","Proxima Centauri"],correct:2,why:"The Sun is the star at the centre of our Solar System."},
{category:"biology",q:"Which molecule stores hereditary information in most living organisms?",a:["Glucose","DNA","Starch","Water"],correct:1,why:"DNA stores genetic information used in inheritance and cell activity."},
{category:"biology",q:"Which organelle is often called the powerhouse of the cell?",a:["Ribosome","Nucleus","Mitochondrion","Golgi apparatus"],correct:2,why:"Mitochondria are major sites of ATP production during cellular respiration."},
{category:"biology",q:"How many hearts does an octopus have?",a:["One","Two","Three","Four"],correct:2,why:"An octopus has three hearts: two pump blood through the gills and one to the body."},
{category:"physics",q:"What is the SI unit of force?",a:["Joule","Watt","Newton","Pascal"],correct:2,why:"Force is measured in newtons (N), named after Isaac Newton."},
{category:"physics",q:"Which type of energy is associated with the motion of an object?",a:["Potential","Kinetic","Chemical","Nuclear"],correct:1,why:"Kinetic energy is the energy an object has because it is moving."},
{category:"earth",q:"Why does Earth's sky appear blue during the day?",a:["Reflection from oceans","Rayleigh scattering","Cloud colour","Earth's magnetic field"],correct:1,why:"Air molecules scatter shorter blue wavelengths more strongly than longer red wavelengths."},
{category:"earth",q:"Which layer of Earth is the outermost solid layer?",a:["Inner core","Outer core","Mantle","Crust"],correct:3,why:"The crust is Earth's thin, outermost solid layer."},
{category:"space",q:"Which planet is famous for its prominent ring system?",a:["Saturn","Earth","Neptune","Mars"],correct:0,why:"Saturn's bright, extensive rings are made mostly of countless icy and rocky particles."},
{category:"biology",q:"Which cell structure controls most activities of a typical eukaryotic cell?",a:["Cell wall","Nucleus","Vacuole","Lysosome"],correct:1,why:"The nucleus contains most of the cell's genetic material and helps regulate cell activities."},
{category:"physics",q:"What happens to the frequency of a wave if its period decreases?",a:["It decreases","It increases","It becomes zero","It stays unchanged"],correct:1,why:"Frequency and period are inversely related: f = 1/T."},
{category:"earth",q:"What is the name of the process by which liquid water becomes water vapour?",a:["Condensation","Precipitation","Evaporation","Freezing"],correct:2,why:"Evaporation changes liquid water into water vapour."}
,{category:"space",q:"Which planet has the largest volcano in the Solar System? ",a:["Earth","Mars","Venus","Mercury"],correct:1,why:"Olympus Mons on Mars is the largest known volcano in the Solar System."},
{category:"space",q:"What is the name of the galaxy that contains our Solar System?",a:["Andromeda","Whirlpool","Milky Way","Sombrero"],correct:2,why:"Our Solar System is located in the Milky Way galaxy."},
{category:"space",q:"What mainly causes the seasons on Earth?",a:["Changing distance from the Sun","Earth's axial tilt","The Moon's gravity","Solar flares"],correct:1,why:"Earth's tilted axis changes the angle and duration of sunlight during the year."},
{category:"space",q:"Which planet rotates in the opposite direction to most planets?",a:["Venus","Mars","Jupiter","Neptune"],correct:0,why:"Venus has retrograde rotation, meaning it spins in the opposite direction to most planets."},
{category:"space",q:"What is a light-year a measure of?",a:["Time","Brightness","Distance","Mass"],correct:2,why:"A light-year is the distance light travels in one year."},
{category:"space",q:"Which object is at the centre of our Milky Way?",a:["A giant star","A supermassive black hole","A neutron star","A nebula"],correct:1,why:"The Milky Way's centre contains the supermassive black hole Sagittarius A*."},
{category:"space",q:"What is the main source of the Sun's energy?",a:["Chemical burning","Nuclear fission","Nuclear fusion","Gravitational friction"],correct:2,why:"The Sun releases energy by fusing hydrogen into helium in its core."},
{category:"space",q:"Which planet is the hottest on average?",a:["Mercury","Venus","Mars","Jupiter"],correct:1,why:"Venus is hottest because its dense carbon-dioxide atmosphere creates an intense greenhouse effect."},
{category:"biology",q:"Which organelle is the main site of protein synthesis?",a:["Lysosome","Ribosome","Vacuole","Centriole"],correct:1,why:"Ribosomes translate messenger RNA to build proteins."},
{category:"biology",q:"What is the basic structural and functional unit of life?",a:["Tissue","Organ","Cell","Molecule"],correct:2,why:"The cell is the basic structural and functional unit of living organisms."},
{category:"biology",q:"Which blood cells help defend the body against pathogens?",a:["Red blood cells","Platelets","White blood cells","Plasma cells only"],correct:2,why:"White blood cells are key components of the immune system."},
{category:"biology",q:"Which pigment captures light for photosynthesis in plants?",a:["Haemoglobin","Chlorophyll","Melanin","Keratin"],correct:1,why:"Chlorophyll absorbs light energy used in photosynthesis."},
{category:"biology",q:"Where does photosynthesis mainly occur in plant cells?",a:["Mitochondria","Chloroplasts","Nucleus","Ribosomes"],correct:1,why:"Chloroplasts contain chlorophyll and are the main sites of photosynthesis."},
{category:"biology",q:"What is the full form of ATP?",a:["Adenosine triphosphate","Amino transfer protein","Active transport particle","Adenine total phosphate"],correct:0,why:"ATP stands for adenosine triphosphate and acts as an energy-transfer molecule in cells."},
{category:"biology",q:"Which molecule carries amino acids to the ribosome during translation?",a:["mRNA","tRNA","rRNA","DNA"],correct:1,why:"Transfer RNA carries specific amino acids to the ribosome during protein synthesis."},
{category:"biology",q:"What is the name of cell division that produces two genetically similar daughter cells?",a:["Meiosis","Mitosis","Fertilisation","Budding"],correct:1,why:"Mitosis generally produces two daughter cells with the same chromosome number as the parent cell."},
{category:"physics",q:"What is the SI unit of electric current?",a:["Volt","Ampere","Ohm","Coulomb"],correct:1,why:"Electric current is measured in amperes (A)."},
{category:"physics",q:"Which instrument measures potential difference?",a:["Ammeter","Voltmeter","Galvanometer only","Barometer"],correct:1,why:"A voltmeter measures potential difference and is connected in parallel across a component."},
{category:"physics",q:"What is the approximate speed of light in vacuum?",a:["3 × 10⁶ m/s","3 × 10⁸ m/s","3 × 10¹⁰ m/s","300 m/s"],correct:1,why:"Light travels at approximately 3 × 10⁸ metres per second in vacuum."},
{category:"physics",q:"Which law states that pressure and volume are inversely related at constant temperature?",a:["Charles's law","Boyle's law","Ohm's law","Faraday's law"],correct:1,why:"Boyle's law states that pressure is inversely proportional to volume for a fixed amount of gas at constant temperature."},
{category:"physics",q:"What is the SI unit of power?",a:["Joule","Newton","Watt","Pascal"],correct:2,why:"Power is the rate of transfer or conversion of energy and is measured in watts."},
{category:"physics",q:"Which type of lens is thicker at the centre than at the edges?",a:["Concave","Convex","Plane glass","Cylindrical only"],correct:1,why:"A convex lens is generally thicker at the centre and converges parallel rays of light."},
{category:"physics",q:"What happens to the resistance of an ideal metallic wire when its temperature rises?",a:["It usually increases","It becomes zero","It always halves","It does not change"],correct:0,why:"For most metals, resistance increases as temperature rises because lattice vibrations increase."},
{category:"earth",q:"Which gas makes up the largest fraction of Earth's atmosphere?",a:["Oxygen","Carbon dioxide","Nitrogen","Argon"],correct:2,why:"Nitrogen makes up about 78% of Earth's atmosphere."},
{category:"earth",q:"What is molten rock beneath Earth's surface called?",a:["Lava","Magma","Basalt","Ash"],correct:1,why:"Molten rock below the surface is magma; when it erupts, it is called lava."},
{category:"earth",q:"Which layer of the atmosphere contains most weather phenomena?",a:["Stratosphere","Mesosphere","Troposphere","Thermosphere"],correct:2,why:"Most clouds and weather occur in the troposphere, the lowest atmospheric layer."},
{category:"earth",q:"What is the continuous movement of water between Earth's surface and atmosphere called?",a:["Carbon cycle","Rock cycle","Water cycle","Nitrogen cycle"],correct:2,why:"The water cycle includes evaporation, condensation, precipitation and collection."},
{category:"earth",q:"Which natural event is measured using the moment magnitude scale?",a:["Tornado","Earthquake","Flood","Cyclone"],correct:1,why:"The moment magnitude scale measures the size of earthquakes."},
{category:"earth",q:"What causes ocean tides on Earth primarily?",a:["Wind","The Moon's gravitational pull","Ocean temperature","Earth's magnetic field"],correct:1,why:"The Moon's gravity is the main influence on Earth's tides, with the Sun also contributing."},
{category:"earth",q:"Which rock type forms when magma or lava cools and solidifies?",a:["Sedimentary","Metamorphic","Igneous","Organic"],correct:2,why:"Igneous rocks form from cooled and solidified molten rock."}
];
const $=id=>document.getElementById(id);
let selectedCategory="all",questions=[],index=0,score=0,locked=false;
const categoryNames={all:"ALL KNOWLEDGE ZONES",space:"SPACE",biology:"BIOLOGY",physics:"PHYSICS",earth:"EARTH"};
$("categoryPicker").addEventListener("click",e=>{const b=e.target.closest("[data-category]");if(!b)return;selectedCategory=b.dataset.category;document.querySelectorAll(".category-choice").forEach(x=>x.classList.toggle("selected",x===b));});
function shuffle(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
$("startButton").addEventListener("click",startQuiz);
function startQuiz(){
 const pool=questionBank.filter(q=>selectedCategory==="all"||q.category===selectedCategory);
 const storageKey="astralore-quiz-seen-v2-"+selectedCategory;
 let seen=[];
 try{seen=JSON.parse(localStorage.getItem(storageKey)||"[]");}catch(e){seen=[];}
 let fresh=pool.filter((q,i)=>!seen.includes(i));
 if(fresh.length===0){seen=[];fresh=pool.slice();}
 questions=shuffle(fresh).slice(0,Math.min(10,fresh.length));
 const selectedIndices=questions.map(q=>pool.indexOf(q));
 seen=[...seen,...selectedIndices];
 if(seen.length>=pool.length){seen=[];}
 try{localStorage.setItem(storageKey,JSON.stringify(seen));}catch(e){}
 index=0;score=0;$("startScreen").hidden=true;$("resultScreen").hidden=true;$("questionScreen").hidden=false;$("quizCategory").textContent=categoryNames[selectedCategory];renderQuestion();
}
function renderQuestion(){locked=false;const q=questions[index];$("questionCounter").textContent=(index+1)+" / "+questions.length;$("questionNumber").textContent="QUESTION "+String(index+1).padStart(2,"0");$("questionText").textContent=q.q;$("progressBar").style.width=(index/questions.length*100)+"%";$("feedback").hidden=true;$("feedback").textContent="";$("nextButton").disabled=true;$("nextButton").textContent=index===questions.length-1?"VIEW RESULTS ↗":"NEXT QUESTION ↗";$("answerList").replaceChildren();q.a.forEach((answer,i)=>{const b=document.createElement("button");b.type="button";b.className="answer-option";const letter=document.createElement("span");letter.className="letter";letter.textContent=String.fromCharCode(65+i);const label=document.createElement("span");label.textContent=answer;b.append(letter,label);b.addEventListener("click",()=>chooseAnswer(i));$("answerList").append(b);});}
function chooseAnswer(choice){if(locked)return;locked=true;const q=questions[index];const buttons=[...$("answerList").querySelectorAll("button")];buttons.forEach((b,i)=>{b.disabled=true;if(i===q.correct)b.classList.add("correct");else if(i===choice)b.classList.add("wrong");});const correct=choice===q.correct;if(correct)score++;$("feedback").textContent=(correct?"CORRECT. ":"NOT QUITE. ")+q.why;$("feedback").hidden=false;$("nextButton").disabled=false;$("progressBar").style.width=((index+1)/questions.length*100)+"%";}
$("nextButton").addEventListener("click",()=>{if(!locked)return;if(index<questions.length-1){index++;renderQuestion();}else showResults();});
function showResults(){$("questionScreen").hidden=true;$("resultScreen").hidden=false;$("questionCounter").textContent="COMPLETED";$("finalScore").textContent=score+"/"+questions.length;$("scorePercent").textContent=Math.round(score/questions.length*100)+"%";$("resultTitle").textContent=score===questions.length?"PERFECT EXPLORATION.":score>=7?"EXCELLENT WORK.":score>=4?"KEEP EXPLORING.":"EVERY ANSWER IS A START."; $("resultMessage").textContent=score>=7?"Your curiosity is taking you far. Keep challenging what you know.":"Review the explanations and come back for another round.";$("resultSymbol").textContent=score>=7?"✦":"◇";$("progressBar").style.width="100%";}
$("retryButton").addEventListener("click",()=>{$("resultScreen").hidden=true;$("questionScreen").hidden=true;$("startScreen").hidden=false;$("quizCategory").textContent="GENERAL KNOWLEDGE";$("questionCounter").textContent="READY WHEN YOU ARE";$("progressBar").style.width="0%";});
