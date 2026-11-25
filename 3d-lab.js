import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const host=document.getElementById('viewer'),status=document.getElementById('modelStatus');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x101225);
const camera=new THREE.PerspectiveCamera(38,1,.1,1000);camera.position.set(0,1.2,5);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;host.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc8d5ff,0x25203c,2.1));
const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(4,6,5);scene.add(key);
const fill=new THREE.PointLight(0x9275ff,35,18);fill.position.set(-4,1,3);scene.add(fill);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=1.5;controls.maxDistance=12;controls.autoRotate=true;controls.autoRotateSpeed=.7;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let model=null,meshList=[],selectedMeshes=[],originalMaterials=new Map(),activeKey='membrane';
const data={
 membrane:{title:'Cell membrane',desc:'A selectively permeable boundary that regulates the movement of substances into and out of the cell.',terms:['membrane','plasma_membrane','cellmembrane']},
 nucleus:{title:'Nucleus',desc:'The nucleus contains most of the cell’s DNA and helps coordinate activities such as growth, metabolism and cell division.',terms:['nucleus','nucleolus']},
 mitochondria:{title:'Mitochondria',desc:'Mitochondria are the main sites of aerobic respiration and produce much of the ATP used by the cell.',terms:['mitochond','mito']},
 er:{title:'Endoplasmic reticulum',desc:'The rough ER has ribosomes and helps make proteins; the smooth ER is involved in lipid synthesis and other functions.',terms:['endoplasmic','reticulum','rough_er','smooth_er']},
 golgi:{title:'Golgi apparatus',desc:'The Golgi apparatus modifies, sorts and packages proteins and lipids for transport to their destinations.',terms:['golgi'] }
};
function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}
new ResizeObserver(resize).observe(host);resize();

function restoreHighlight(){for(const mesh of selectedMeshes){const original=originalMaterials.get(mesh);if(original)mesh.material=original;}selectedMeshes=[];originalMaterials.clear();}
function highlightMeshes(key){
 restoreHighlight();
 const terms=data[key].terms;
 const matches=meshList.filter(m=>{const n=(m.name+' '+m.parent?.name).toLowerCase().replace(/[ -]/g,'_');return terms.some(t=>n.includes(t));});
 for(const mesh of matches){originalMaterials.set(mesh,mesh.material);const mats=Array.isArray(mesh.material)?mesh.material: [mesh.material];mesh.material=mats.map(mat=>{const clone=mat.clone();if(clone.emissive){clone.emissive=new THREE.Color(0x8e6bff);clone.emissiveIntensity=.85;}return clone;});if(!Array.isArray(mesh.material))mesh.material=mesh.material[0];selectedMeshes.push(mesh);}
 return matches.length;
}
function choose(key,fromCanvas=false,meshName=''){
 activeKey=key;const item=data[key];
 document.querySelectorAll('[data-organelle]').forEach(b=>b.classList.toggle('active',b.dataset.organelle===key));
 document.getElementById('organelleDetail').innerHTML='<span>SELECTED STRUCTURE</span><strong>'+item.title+'</strong><p>'+item.desc+'</p>';
 const count=highlightMeshes(key);
 const hint=document.getElementById('selectionHint');
 if(fromCanvas){hint.textContent='Selected model part: '+(meshName||'unnamed mesh')+'. '+item.title+' is the closest matching topic.';}
 else if(count){hint.textContent='Matching model part highlighted. Drag to inspect it from different angles.';}
 else{hint.textContent='This model file does not expose a separately named mesh for '+item.title+'. The learning card is active; click the model to inspect its available parts.';}
}
document.querySelectorAll('[data-organelle]').forEach(btn=>btn.addEventListener('click',()=>choose(btn.dataset.organelle)));

new GLTFLoader().load('assets/models/animal-cell.glb',gltf=>{
 model=gltf.scene;const box=new THREE.Box3().setFromObject(model);const size=box.getSize(new THREE.Vector3());const center=box.getCenter(new THREE.Vector3());model.position.sub(center);
 const max=Math.max(size.x,size.y,size.z)||1;model.scale.setScalar(3.2/max);scene.add(model);
 model.traverse(o=>{if(o.isMesh){meshList.push(o);o.userData.originalName=o.name||'Unnamed surface';}});
 controls.target.set(0,0,0);camera.position.set(0,1.2,5);camera.near=.01;camera.far=1000;camera.updateProjectionMatrix();controls.update();
 document.querySelector('.loading')?.remove();status.textContent='MODEL LOADED · CLICK TO INSPECT';window.cellModel=model;
 choose('membrane');
},xhr=>{if(xhr.total)status.textContent=Math.round(xhr.loaded/xhr.total*100)+'%'},err=>{console.error(err);status.textContent='LOAD FAILED';const l=document.querySelector('.loading');if(l)l.innerHTML='<strong>MODEL COULD NOT LOAD</strong><span>Check the model file path and refresh.</span>'});

renderer.domElement.addEventListener('pointerdown',event=>{
 if(!model)return;const rect=renderer.domElement.getBoundingClientRect();
 pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
 raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(meshList,false);
 if(!hits.length)return;
 const hit=hits[0].object;const name=(hit.name||'').toLowerCase();
 let key='membrane';
 if(/nucleus|nucleolus/.test(name))key='nucleus';
 else if(/mitochond|mito/.test(name))key='mitochondria';
 else if(/golgi/.test(name))key='golgi';
 else if(/endoplasmic|reticulum|rough_er|smooth_er/.test(name))key='er';
 else if(/membrane/.test(name))key='membrane';
 if(/nucleus|nucleolus|mitochond|mito|golgi|endoplasmic|reticulum|rough_er|smooth_er|membrane/.test(name)){
  choose(key,true,hit.userData.originalName);
 }else{
  restoreHighlight();const original=hit.material;originalMaterials.set(hit,original);
  const mats=Array.isArray(original)?original:[original];
  const clones=mats.map(mat=>{const clone=mat.clone();if(clone.emissive){clone.emissive=new THREE.Color(0x8e6bff);clone.emissiveIntensity=.85;}return clone;});
  hit.material=Array.isArray(original)?clones:clones[0];selectedMeshes=[hit];
  document.getElementById('selectionHint').textContent='Selected model mesh: '+hit.userData.originalName+'. This model file does not label this surface as a specific organelle, so we will not guess its identity.';
 }
});
document.getElementById('resetView').addEventListener('click',()=>{camera.position.set(0,1.2,5);controls.target.set(0,0,0);controls.update();});
const toggle=document.getElementById('autoRotate');toggle.addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;toggle.classList.toggle('selected',controls.autoRotate);toggle.textContent='AUTO ROTATE: '+(controls.autoRotate?'ON':'OFF')});
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}animate();
