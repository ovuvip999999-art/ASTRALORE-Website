import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const sceneHost=document.getElementById('scene');
const data={
 sun:{name:'THE SUN',type:"THE STAR AT OUR SYSTEM'S CENTRE",description:'The Sun is the star at the centre of our Solar System. Its gravity holds the system together, and its energy supports life on Earth.',facts:['G-type star','About 4.6 billion years','Central star'],color:0xffbd62,size:1.12,orbit:0,period:0},
 mercury:{name:'MERCURY',type:'THE SMALLEST PLANET',description:'Mercury is the smallest planet and the closest to the Sun. It has a heavily cratered surface and experiences extreme temperature changes.',facts:['Terrestrial planet','88 Earth days','Closest to Sun'],color:0xa9a6a3,size:.16,orbit:1.75,period:88},
 venus:{name:'VENUS',type:'THE HOTTEST PLANET',description:'Venus has a dense atmosphere rich in carbon dioxide and clouds of sulfuric acid. Its surface is hot enough to melt lead.',facts:['Terrestrial planet','225 Earth days','Thick CO₂ atmosphere'],color:0xe4b878,size:.23,orbit:2.35,period:225},
 earth:{name:'EARTH',type:'OUR HOME WORLD',description:'Earth is the only world currently known to support life. Liquid water covers most of its surface, and its atmosphere helps regulate the climate.',facts:['Terrestrial planet','365.25 days','Liquid surface water'],color:0x438ee8,size:.25,orbit:3.05,period:365.25},
 mars:{name:'MARS',type:'THE RED PLANET',description:'Mars is a cold desert world with a thin atmosphere. Evidence preserved in its rocks and landscape shows that liquid water existed there in the past.',facts:['Terrestrial planet','687 Earth days','Two small moons'],color:0xc96e4d,size:.2,orbit:3.85,period:687},
 jupiter:{name:'JUPITER',type:'THE GIANT PLANET',description:'Jupiter is the largest planet in our Solar System. It is a gas giant with powerful storms, including the long-lived Great Red Spot.',facts:['Gas giant','About 11.9 years','Largest planet'],color:0xd6ad83,size:.62,orbit:5.05,period:4333},
 saturn:{name:'SATURN',type:'THE RINGED GIANT',description:'Saturn is a gas giant best known for its broad and bright ring system, made mostly of countless pieces of ice and rocky material.',facts:['Gas giant','About 29.4 years','Prominent ring system'],color:0xe5d2a1,size:.52,orbit:6.45,period:10759},
 uranus:{name:'URANUS',type:'THE ICE GIANT',description:'Uranus is an ice giant that rotates on its side relative to its orbit. Its blue-green colour comes from methane in its atmosphere.',facts:['Ice giant','About 84 years','Extreme axial tilt'],color:0x83d8d8,size:.38,orbit:7.75,period:30687},
 neptune:{name:'NEPTUNE',type:'THE DISTANT ICE GIANT',description:'Neptune is the most distant recognised planet from the Sun. It is a cold, dark world with some of the fastest winds measured on a planet.',facts:['Ice giant','About 165 years','Very fast winds'],color:0x426ee6,size:.37,orbit:9.0,period:60190}
};
let renderer,threeScene,camera,root,clock,paused=false,raf=0;
const planetMeshes={};let pointer=null,rotationY=.55,rotationX=.28,zoom=1;
function fallback(message){sceneHost.innerHTML='<div class="loading" style="padding:24px;text-align:center;line-height:2">'+message+'</div>';}
try{
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
 renderer.setSize(sceneHost.clientWidth,sceneHost.clientHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 sceneHost.innerHTML='';sceneHost.appendChild(renderer.domElement);
 threeScene=new THREE.Scene();threeScene.fog=new THREE.FogExp2(0x080914,.012);
 camera=new THREE.PerspectiveCamera(45,sceneHost.clientWidth/sceneHost.clientHeight,.1,1000);
 camera.position.set(0,9,18);
 root=new THREE.Group();threeScene.add(root);
 threeScene.add(new THREE.AmbientLight(0x8995d8,1.25));
 const sunLight=new THREE.PointLight(0xffd49a,3.2,80);threeScene.add(sunLight);
 const starGeometry=new THREE.BufferGeometry(),starPositions=[];
 for(let i=0;i<1800;i++){const radius=35+Math.random()*100,theta=Math.random()*Math.PI*2,phi=Math.acos(2*Math.random()-1);starPositions.push(radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta));}
 starGeometry.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));
 const stars=new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xd8d2ff,size:.12,transparent:true,opacity:.85}));threeScene.add(stars);
 const sun=new THREE.Mesh(new THREE.SphereGeometry(data.sun.size,48,32),new THREE.MeshBasicMaterial({color:data.sun.color}));root.add(sun);planetMeshes.sun=sun;
 const glow=new THREE.Mesh(new THREE.SphereGeometry(1.38,32,24),new THREE.MeshBasicMaterial({color:0xffa94f,transparent:true,opacity:.11,side:THREE.BackSide}));root.add(glow);
 const ray=new THREE.Mesh(new THREE.SphereGeometry(1.8,32,24),new THREE.MeshBasicMaterial({color:0xff7c35,transparent:true,opacity:.035,side:THREE.BackSide}));root.add(ray);
 Object.entries(data).filter(([key])=>key!=='sun').forEach(([key,p],i)=>{
  const orbit=new THREE.Mesh(new THREE.TorusGeometry(p.orbit,.006,4,180),new THREE.MeshBasicMaterial({color:0x8474bd,transparent:true,opacity:.26}));orbit.rotation.x=Math.PI/2;root.add(orbit);
  const material=new THREE.MeshStandardMaterial({color:p.color,roughness:.88,metalness:.02});
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(p.size,40,28),material);
  mesh.position.set(p.orbit,0,0);mesh.userData={key,angle:i*1.4};root.add(mesh);planetMeshes[key]=mesh;
  if(key==='saturn'){const ring=new THREE.Mesh(new THREE.RingGeometry(.68,.98,64),new THREE.MeshBasicMaterial({color:0xc9b58f,side:THREE.DoubleSide,transparent:true,opacity:.72}));ring.rotation.x=Math.PI/2.25;mesh.add(ring);}
  if(key==='earth'){const moon=new THREE.Mesh(new THREE.SphereGeometry(.055,16,12),new THREE.MeshStandardMaterial({color:0xc8cbd6}));moon.position.set(.42,.04,0);mesh.add(moon);}
 });
 clock=new THREE.Clock();
 const target=new THREE.Vector3(0,0,0);
 function render(){raf=requestAnimationFrame(render);const dt=Math.min(clock.getDelta(),.04);if(!paused){Object.entries(planetMeshes).forEach(([key,mesh])=>{if(key==='sun')return;const p=data[key],speed=.22/Math.sqrt(p.orbit);mesh.userData.angle+=dt*speed;mesh.position.set(Math.cos(mesh.userData.angle)*p.orbit,0,Math.sin(mesh.userData.angle)*p.orbit);mesh.rotation.y+=dt*.25;});planetMeshes.sun.rotation.y+=dt*.08;}
 root.rotation.y=rotationY;root.rotation.x=rotationX;
 camera.position.set(Math.sin(rotationY)*18/zoom,7.5/zoom+rotationX*5,Math.cos(rotationY)*18/zoom);camera.lookAt(target);renderer.render(threeScene,camera);}
 render();
 const resize=()=>{const w=sceneHost.clientWidth,h=sceneHost.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe(sceneHost);
 renderer.domElement.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);});
 renderer.domElement.addEventListener('pointermove',e=>{if(!pointer)return;rotationY+=(e.clientX-pointer.x)*.006;rotationX=Math.max(-.65,Math.min(.85,rotationX+(e.clientY-pointer.y)*.004));pointer={x:e.clientX,y:e.clientY};});
 renderer.domElement.addEventListener('pointerup',()=>pointer=null);renderer.domElement.addEventListener('pointercancel',()=>pointer=null);
 renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.65,Math.min(1.8,zoom*(e.deltaY>0?.93:1.07)));},{passive:false});
}catch(error){fallback('3D GRAPHICS ARE NOT AVAILABLE IN THIS BROWSER OR DEVICE. Try an updated Chrome browser with hardware acceleration enabled.');}
function selectPlanet(key){const p=data[key];if(!p)return;document.querySelectorAll('.planet-tab').forEach(b=>b.classList.toggle('active',b.dataset.planet===key));document.getElementById('planetType').textContent=p.type;document.getElementById('planetIndex').textContent=String(Object.keys(data).indexOf(key)+1).padStart(2,'0')+' / 09';document.getElementById('planetName').textContent=p.name;document.getElementById('planetDescription').textContent=p.description;document.getElementById('planetFacts').innerHTML=p.facts.map((f,i)=>'<div><small>'+['CLASS','ORBIT / YEAR','DETAIL'][i]+'</small><strong>'+f+'</strong></div>').join('');}
document.querySelectorAll('.planet-tab').forEach(b=>b.addEventListener('click',()=>selectPlanet(b.dataset.planet)));
document.getElementById('pauseBtn').addEventListener('click',e=>{paused=!paused;e.currentTarget.textContent=paused?'▶ PLAY':'Ⅱ PAUSE';});
document.getElementById('resetBtn').addEventListener('click',()=>{rotationY=.55;rotationX=.28;zoom=1;});
window.addEventListener('beforeunload',()=>{cancelAnimationFrame(raf);if(renderer)renderer.dispose();});
