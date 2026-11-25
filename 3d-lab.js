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
function resize(){const w=host.clientWidth,h=host.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}
new ResizeObserver(resize).observe(host);resize();
new GLTFLoader().load('assets/models/animal-cell.glb',gltf=>{
 const model=gltf.scene;const box=new THREE.Box3().setFromObject(model);const size=box.getSize(new THREE.Vector3());const center=box.getCenter(new THREE.Vector3());model.position.sub(center);
 const max=Math.max(size.x,size.y,size.z)||1;model.scale.setScalar(3.2/max);scene.add(model);controls.target.set(0,0,0);camera.position.set(0,max*.95,Math.max(4,max*2.3));camera.near=.01;camera.far=1000;camera.updateProjectionMatrix();controls.update();
 document.querySelector('.loading')?.remove();status.textContent='MODEL LOADED';window.cellModel=model;
},xhr=>{if(xhr.total)status.textContent=Math.round(xhr.loaded/xhr.total*100)+'%'},err=>{console.error(err);status.textContent='LOAD FAILED';const l=document.querySelector('.loading');if(l)l.innerHTML='<strong>MODEL COULD NOT LOAD</strong><span>Check the model file path and refresh.</span>'});
document.getElementById('resetView').addEventListener('click',()=>{camera.position.set(0,1.2,5);controls.target.set(0,0,0);controls.update()});
const toggle=document.getElementById('autoRotate');toggle.addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;toggle.classList.toggle('selected',controls.autoRotate);toggle.textContent='AUTO ROTATE: '+(controls.autoRotate?'ON':'OFF')});
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}animate();
