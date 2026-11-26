import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MODEL_DATA, buildModel, MODEL_COUNT } from './3d-models.js';

const $ = id => document.getElementById(id);
const host = $('viewer');
const status = $('modelStatus');
let activeSubject = 'All';
let activeModel = MODEL_DATA[0];
let modelGroup = null;
let controls;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101225);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 1.25, 5.3);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
host.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc8d5ff, 0x25203c, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(4, 6, 5); scene.add(key);
const fill = new THREE.PointLight(0x9275ff, 28, 18); fill.position.set(-4, 1, 3); scene.add(fill);
const rim = new THREE.PointLight(0x62bfff, 18, 16); rim.position.set(3, -1, -4); scene.add(rim);
controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .065;
controls.minDistance = 2.2; controls.maxDistance = 9;
controls.autoRotate = true; controls.autoRotateSpeed = .65;
const resize = () => {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
};
new ResizeObserver(resize).observe(host); resize();

const subjectColor = { Physics: '#75baff', Chemistry: '#ffb66e', Biology: '#76dfb0' };
function disposeGroup(group) {
  if (!group) return;
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
  scene.remove(group);
}
function renderModel(record) {
  disposeGroup(modelGroup);
  modelGroup = buildModel(THREE, record);
  scene.add(modelGroup);
  controls.target.set(0, -.05, 0);
  camera.position.set(0, 1.2, 5.1);
  controls.update();
  activeModel = record;
  $('detailSubject').textContent = record.subject.toUpperCase();
  $('detailSubject').style.color = subjectColor[record.subject];
  $('detailTitle').textContent = record.title;
  $('detailChapter').textContent = record.chapter;
  $('detailDescription').textContent = record.description;
  const index = MODEL_DATA.findIndex(m => m.id === record.id) + 1;
  $('detailIndex').textContent = 'MODEL ' + String(index).padStart(2, '0') + ' / ' + MODEL_COUNT;
  status.textContent = record.subject.toUpperCase() + ' · ' + record.id;
  document.querySelectorAll('.model-item').forEach(button => button.classList.toggle('active', button.dataset.id === record.id));
}
function filteredModels() {
  const query = $('modelSearch').value.trim().toLowerCase();
  const chapter = $('chapterFilter').value;
  return MODEL_DATA.filter(m =>
    (activeSubject === 'All' || m.subject === activeSubject) &&
    (chapter === 'All' || m.chapter === chapter) &&
    (!query || (m.title + ' ' + m.chapter + ' ' + m.description + ' ' + m.subject).toLowerCase().includes(query))
  );
}
function updateChapters() {
  const select = $('chapterFilter');
  const previous = select.value;
  const chapters = [...new Set(MODEL_DATA.filter(m => activeSubject === 'All' || m.subject === activeSubject).map(m => m.chapter))].sort();
  select.innerHTML = '<option value="All">All chapters</option>' + chapters.map(c => '<option value="' + c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') + '">' + c + '</option>').join('');
  if (chapters.includes(previous)) select.value = previous;
}
function drawList() {
  const items = filteredModels();
  $('modelList').innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((record, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'model-item' + (record.id === activeModel.id ? ' active' : '');
    button.dataset.id = record.id;
    const number = document.createElement('span'); number.className = 'model-number'; number.textContent = String(MODEL_DATA.indexOf(record) + 1).padStart(2, '0');
    const text = document.createElement('span'); text.className = 'model-item-copy';
    const title = document.createElement('strong'); title.textContent = record.title;
    const meta = document.createElement('small'); meta.textContent = record.chapter;
    text.append(title, meta); button.append(number, text);
    button.style.setProperty('--subject-color', subjectColor[record.subject]);
    button.addEventListener('click', () => renderModel(record));
    fragment.append(button);
  });
  $('modelList').append(fragment);
  $('emptyState').hidden = items.length !== 0;
  $('visibleCount').textContent = items.length + ' / ' + MODEL_COUNT;
  $('resultCount').textContent = items.length + (items.length === 1 ? ' model' : ' models');
  if (items.length && !items.some(m => m.id === activeModel.id)) renderModel(items[0]);
}
function setSubject(subject) {
  activeSubject = subject;
  document.querySelectorAll('.subject-tab').forEach(b => {
    const active = b.dataset.subject === subject;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  updateChapters(); drawList();
}
document.querySelectorAll('.subject-tab').forEach(button => button.addEventListener('click', () => setSubject(button.dataset.subject)));
$('modelSearch').addEventListener('input', drawList);
$('chapterFilter').addEventListener('change', drawList);
$('resetView').addEventListener('click', () => {
  camera.position.set(0, 1.2, 5.1); controls.target.set(0, -.05, 0); controls.update();
});
const rotateButton = $('autoRotate');
rotateButton.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  rotateButton.classList.toggle('selected', controls.autoRotate);
  rotateButton.textContent = 'AUTO ROTATE: ' + (controls.autoRotate ? 'ON' : 'OFF');
});
$('totalModels').textContent = MODEL_COUNT;
$('allCount').textContent = MODEL_DATA.length;
$('physicsCount').textContent = MODEL_DATA.filter(m => m.subject === 'Physics').length;
$('chemistryCount').textContent = MODEL_DATA.filter(m => m.subject === 'Chemistry').length;
$('biologyCount').textContent = MODEL_DATA.filter(m => m.subject === 'Biology').length;
$('modelSearch').setAttribute('aria-label', 'Search 100 Class 12 models');
if (MODEL_COUNT !== 100) status.textContent = 'CATALOGUE COUNT ERROR: ' + MODEL_COUNT;
else status.textContent = '100 MODELS READY';
document.querySelector('.loading')?.remove();
updateChapters(); drawList(); renderModel(MODEL_DATA[0]);
function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();
